import "server-only";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { type Account, accounts, ledgerEntries, transactions } from "@/db/schema";
import type { EntryDirection, TransactionStatus, TransactionType } from "@/lib/domain";
import { type CurrencyCode, toBaseCurrency } from "@/lib/money";

export type AccountView = Pick<
  Account,
  "id" | "name" | "type" | "number" | "currency" | "status" | "postedMinor" | "heldMinor" | "createdAt"
> & { availableMinor: bigint };

function toView(account: Account): AccountView {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    number: account.number,
    currency: account.currency,
    status: account.status,
    postedMinor: account.postedMinor,
    heldMinor: account.heldMinor,
    availableMinor: account.postedMinor - account.heldMinor,
    createdAt: account.createdAt,
  };
}

export async function listAccountsForUser(db: DbOrTx, userId: string): Promise<AccountView[]> {
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.ownerId, userId))
    .orderBy(asc(accounts.createdAt));
  return rows.map(toView);
}

/** An account as seen by its owner; null if it belongs to anyone else. */
export async function getAccountForUser(
  db: DbOrTx,
  userId: string,
  accountId: string,
): Promise<AccountView | null> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.ownerId, userId)))
    .limit(1);
  return row ? toView(row) : null;
}

export type BalanceSummary = {
  /** Total and available across all currencies, expressed in the base currency. */
  totalBaseMinor: bigint;
  availableBaseMinor: bigint;
  heldBaseMinor: bigint;
  byCurrency: { currency: CurrencyCode; postedMinor: bigint; availableMinor: bigint; accounts: number }[];
};

export function summariseBalances(list: AccountView[]): BalanceSummary {
  const byCurrency = new Map<CurrencyCode, { postedMinor: bigint; availableMinor: bigint; accounts: number }>();
  let totalBaseMinor = 0n;
  let availableBaseMinor = 0n;

  for (const account of list) {
    if (account.status === "closed") continue;
    const bucket = byCurrency.get(account.currency) ?? { postedMinor: 0n, availableMinor: 0n, accounts: 0 };
    bucket.postedMinor += account.postedMinor;
    bucket.availableMinor += account.availableMinor;
    bucket.accounts += 1;
    byCurrency.set(account.currency, bucket);
    totalBaseMinor += toBaseCurrency(account.postedMinor, account.currency);
    availableBaseMinor += toBaseCurrency(account.availableMinor, account.currency);
  }

  return {
    totalBaseMinor,
    availableBaseMinor,
    heldBaseMinor: totalBaseMinor - availableBaseMinor,
    byCurrency: [...byCurrency].map(([currency, value]) => ({ currency, ...value })),
  };
}

export type StatementLine = {
  seq: number;
  createdAt: Date;
  direction: EntryDirection;
  amountMinor: bigint;
  balanceAfterMinor: bigint;
  memo: string | null;
  transactionId: string;
  reference: string;
  type: TransactionType;
  status: TransactionStatus;
  description: string;
  counterpartyName: string | null;
};

/**
 * The account's statement, read straight from the ledger: one line per entry,
 * each carrying the balance it produced. Ownership must be checked first.
 */
export async function listStatementLines(
  db: DbOrTx,
  accountId: string,
  options: { page?: number; pageSize?: number } = {},
): Promise<{ lines: StatementLine[]; total: number; page: number; pageCount: number }> {
  const pageSize = options.pageSize ?? 15;
  const [{ count }] = await db
    .select({ count: sql<string>`count(*)::text` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.accountId, accountId));
  const total = Number(count);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(options.page ?? 1, 1), pageCount);

  const rows = await db
    .select({
      seq: ledgerEntries.seq,
      createdAt: ledgerEntries.createdAt,
      direction: ledgerEntries.direction,
      amountMinor: ledgerEntries.amountMinor,
      balanceAfterMinor: ledgerEntries.balanceAfterMinor,
      memo: ledgerEntries.memo,
      transactionId: transactions.id,
      reference: transactions.reference,
      type: transactions.type,
      status: transactions.status,
      description: transactions.description,
      counterpartyName: transactions.counterpartyName,
    })
    .from(ledgerEntries)
    .innerJoin(transactions, eq(transactions.id, ledgerEntries.transactionId))
    .where(eq(ledgerEntries.accountId, accountId))
    .orderBy(desc(ledgerEntries.seq))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { lines: rows, total, page, pageCount };
}

/** Money in and out of one account over a period, from posted entries. */
export async function accountFlow(
  db: DbOrTx,
  accountId: string,
  since: Date,
): Promise<{ inMinor: bigint; outMinor: bigint; entries: number }> {
  const [row] = await db
    .select({
      credit: sql<string>`COALESCE(SUM(${ledgerEntries.amountMinor}) FILTER (WHERE ${ledgerEntries.direction} = 'credit'), 0)::text`,
      debit: sql<string>`COALESCE(SUM(${ledgerEntries.amountMinor}) FILTER (WHERE ${ledgerEntries.direction} = 'debit'), 0)::text`,
      entries: sql<string>`count(*)::text`,
    })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.accountId, accountId), gte(ledgerEntries.createdAt, since)));
  return { inMinor: BigInt(row.credit), outMinor: BigInt(row.debit), entries: Number(row.entries) };
}
