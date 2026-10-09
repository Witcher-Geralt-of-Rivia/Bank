import "server-only";
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { type Account, accounts, ledgerEntries } from "@/db/schema";
import type { AccountType, EntryDirection } from "@/lib/domain";
import {
  AccountUnavailableError,
  CurrencyMismatchError,
  DomainError,
  InsufficientFundsError,
  NotFoundError,
} from "@/lib/errors";
import type { CurrencyCode } from "@/lib/money";

export type Leg = {
  accountId: string;
  direction: EntryDirection;
  amountMinor: bigint;
  memo?: string;
};

/** Id of the bank-side account of a given type and currency. */
export function systemAccountId(
  type: Extract<AccountType, "clearing" | "transit" | "fees" | "interest">,
  currency: CurrencyCode,
): string {
  return `acc_sys_${type}_${currency.toLowerCase()}`;
}

/**
 * Locks the given accounts for the rest of the transaction.
 *
 * Rows are always locked in ascending id order. Two transfers touching the
 * same pair of accounts in opposite directions therefore queue behind each
 * other instead of deadlocking.
 */
export async function lockAccounts(
  tx: Tx,
  ids: string[],
): Promise<Map<string, Account>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(accounts)
    .where(inArray(accounts.id, unique))
    .orderBy(asc(accounts.id))
    .for("update");
  return new Map(rows.map((row) => [row.id, row]));
}

export function availableMinor(
  account: Pick<Account, "postedMinor" | "heldMinor">,
): bigint {
  return account.postedMinor - account.heldMinor;
}

/**
 * Posts a balanced set of ledger entries and updates the running balance of
 * every account involved — the only way money moves in the system.
 *
 * Guarantees, all within the caller's database transaction:
 *   - debits equal credits (also enforced by a deferred database trigger);
 *   - every account is in the posting currency;
 *   - no customer account is taken below its available balance;
 *   - each entry records the account balance it produced.
 */
export async function postEntries(
  tx: Tx,
  params: {
    transactionId: string;
    currency: CurrencyCode;
    legs: Leg[];
    at: Date;
  },
): Promise<void> {
  const { transactionId, currency, legs, at } = params;

  if (legs.length < 2) {
    throw new DomainError("validation_failed", "A posting needs at least two legs.");
  }

  let debits = 0n;
  let credits = 0n;
  for (const leg of legs) {
    if (leg.amountMinor <= 0n) {
      throw new DomainError("validation_failed", "Entry amounts must be positive.");
    }
    if (leg.direction === "debit") debits += leg.amountMinor;
    else credits += leg.amountMinor;
  }
  if (debits !== credits) {
    throw new DomainError(
      "validation_failed",
      "Posting is unbalanced: total debits must equal total credits.",
    );
  }

  const locked = await lockAccounts(
    tx,
    legs.map((leg) => leg.accountId),
  );
  const running = new Map<string, bigint>();
  const rows: (typeof ledgerEntries.$inferInsert)[] = [];

  for (const leg of legs) {
    const account = locked.get(leg.accountId);
    if (!account) throw new NotFoundError("Account");
    if (account.currency !== currency) throw new CurrencyMismatchError();
    if (account.status === "closed") {
      throw new AccountUnavailableError(`${account.name} is closed.`);
    }

    const before = running.get(account.id) ?? account.postedMinor;
    const after =
      leg.direction === "credit"
        ? before + leg.amountMinor
        : before - leg.amountMinor;

    if (
      leg.direction === "debit" &&
      !account.allowNegative &&
      after - account.heldMinor < 0n
    ) {
      throw new InsufficientFundsError();
    }

    running.set(account.id, after);
    rows.push({
      transactionId,
      accountId: account.id,
      direction: leg.direction,
      amountMinor: leg.amountMinor,
      currency,
      balanceAfterMinor: after,
      memo: leg.memo ?? null,
      createdAt: at,
    });
  }

  await tx.insert(ledgerEntries).values(rows);
  for (const [accountId, balance] of running) {
    await tx
      .update(accounts)
      .set({ postedMinor: balance })
      .where(eq(accounts.id, accountId));
  }
}

/** Reserves funds on an account without moving them. */
export async function placeHold(
  tx: Tx,
  accountId: string,
  amountMinor: bigint,
): Promise<void> {
  const account = (await lockAccounts(tx, [accountId])).get(accountId);
  if (!account) throw new NotFoundError("Account");
  if (availableMinor(account) < amountMinor) throw new InsufficientFundsError();
  await tx
    .update(accounts)
    .set({ heldMinor: sql`${accounts.heldMinor} + ${amountMinor}` })
    .where(eq(accounts.id, accountId));
}

/** Releases a previously placed hold. */
export async function releaseHold(
  tx: Tx,
  accountId: string,
  amountMinor: bigint,
): Promise<void> {
  await lockAccounts(tx, [accountId]);
  await tx
    .update(accounts)
    .set({ heldMinor: sql`${accounts.heldMinor} - ${amountMinor}` })
    .where(eq(accounts.id, accountId));
}
