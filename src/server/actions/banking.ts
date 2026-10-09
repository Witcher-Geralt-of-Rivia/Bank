"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db/client";
import { accounts, transactions } from "@/db/schema";
import type { TransactionStatus } from "@/lib/domain";
import { env } from "@/lib/env";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { MoneyError, parseAmount } from "@/lib/money";
import {
  beneficiarySchema,
  changePasswordSchema,
  fundingSchema,
  profileSchema,
  transferSchema,
} from "@/lib/validation";
import { archiveBeneficiary, createBeneficiary } from "../beneficiaries/service";
import { systemContext } from "../context";
import { createTransfer, deposit, settleTransfer, withdraw } from "../ledger/service";
import { markAllNotificationsRead, markNotificationRead } from "../queries/misc";
import { getTransactionForUser } from "../queries/transactions";
import { limiters } from "../rate-limit";
import { changePassword, setTwoFactor, updatePreferences, updateProfile } from "../users/service";
import { defineAction } from "./define";

const CUSTOMER = ["customer"] as const;

export type MovementReceipt = {
  id: string;
  reference: string;
  status: TransactionStatus;
  /** True when this request repeated one that had already been processed. */
  replayed: boolean;
};

/**
 * Turns the decimal string typed by the user into minor units, using the
 * currency of the account being debited or credited. No floats are involved.
 */
function toMinor(amount: string, currency: "USD" | "EUR"): bigint {
  try {
    return parseAmount(amount, currency);
  } catch (error) {
    if (error instanceof MoneyError) {
      throw new ValidationError(error.message, { amount: error.message });
    }
    throw error;
  }
}

async function currencyOfOwnAccount(
  db: Database,
  userId: string,
  accountId: string,
) {
  const [account] = await db
    .select({ currency: accounts.currency, ownerId: accounts.ownerId })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account || account.ownerId !== userId) throw new NotFoundError("Account");
  return account.currency;
}

export const submitTransferAction = defineAction(
  { roles: CUSTOMER, schema: transferSchema, limiter: limiters.movement },
  async (input, { db, user, ctx }): Promise<MovementReceipt> => {
    const currency = await currencyOfOwnAccount(db, user.id, input.sourceAccountId);
    const { transaction, replayed } = await createTransfer(db, ctx, {
      idempotencyKey: input.idempotencyKey,
      sourceAccountId: input.sourceAccountId,
      destination: input.destination,
      amountMinor: toMinor(input.amount, currency),
      description: input.description,
      category: input.category,
      autoSettle: env.demoMode,
    });
    return { id: transaction.id, reference: transaction.reference, status: transaction.status, replayed };
  },
);

export const depositAction = defineAction(
  { roles: CUSTOMER, schema: fundingSchema, limiter: limiters.movement },
  async (input, { db, user, ctx }): Promise<MovementReceipt> => {
    const currency = await currencyOfOwnAccount(db, user.id, input.accountId);
    const { transaction, replayed } = await deposit(db, ctx, {
      idempotencyKey: input.idempotencyKey,
      accountId: input.accountId,
      amountMinor: toMinor(input.amount, currency),
      description: input.description ?? "",
    });
    return { id: transaction.id, reference: transaction.reference, status: transaction.status, replayed };
  },
);

export const withdrawAction = defineAction(
  { roles: CUSTOMER, schema: fundingSchema, limiter: limiters.movement },
  async (input, { db, user, ctx }): Promise<MovementReceipt> => {
    const currency = await currencyOfOwnAccount(db, user.id, input.accountId);
    const { transaction, replayed } = await withdraw(db, ctx, {
      idempotencyKey: input.idempotencyKey,
      accountId: input.accountId,
      amountMinor: toMinor(input.amount, currency),
      description: input.description ?? "",
    });
    return { id: transaction.id, reference: transaction.reference, status: transaction.status, replayed };
  },
);

/**
 * Demo settlement simulator. A real deployment receives settlement
 * confirmations from the payment network; here, a transfer the customer just
 * sent is confirmed a few seconds later when its receipt asks for an update.
 * Only transfers flagged at creation are eligible, and only their owner can
 * trigger it.
 */
const SIMULATED_SETTLEMENT_DELAY_MS = 6_000;

export const refreshTransferStatusAction = defineAction(
  { roles: CUSTOMER, schema: z.object({ id: z.string().min(4).max(64) }) },
  async ({ id }, { db, user }): Promise<{ status: TransactionStatus }> => {
    const detail = await getTransactionForUser(db, user.id, id);
    if (!detail) throw new NotFoundError("Transaction");

    const [row] = await db
      .select({ status: transactions.status, metadata: transactions.metadata, createdAt: transactions.createdAt })
      .from(transactions)
      .where(eq(transactions.id, id))
      .limit(1);

    const eligible =
      env.demoMode &&
      row.status === "processing" &&
      row.metadata.autoSettle === true &&
      detail.transaction.direction === "out" &&
      Date.now() - row.createdAt.getTime() >= SIMULATED_SETTLEMENT_DELAY_MS;

    if (!eligible) return { status: row.status };

    try {
      const settled = await settleTransfer(db, systemContext(), id, "Settlement confirmed by the receiving bank (simulated network).");
      return { status: settled.status };
    } catch {
      // Another request settled it first; report whatever is now true.
      const [current] = await db.select({ status: transactions.status }).from(transactions).where(eq(transactions.id, id)).limit(1);
      return { status: current.status };
    }
  },
);

export const createBeneficiaryAction = defineAction(
  { roles: CUSTOMER, schema: beneficiarySchema },
  async (input, { db, ctx }) => {
    const created = await createBeneficiary(db, ctx, input);
    return { id: created.id, name: created.name };
  },
);

export const archiveBeneficiaryAction = defineAction(
  { roles: CUSTOMER, schema: z.object({ id: z.string().min(4).max(64) }) },
  async ({ id }, { db, ctx }) => {
    await archiveBeneficiary(db, ctx, id);
  },
);

export const updateProfileAction = defineAction({ schema: profileSchema }, async (input, { db, ctx }) => {
  await updateProfile(db, ctx, input);
});

export const changePasswordAction = defineAction({ schema: changePasswordSchema }, async (input, { db, ctx }) => {
  await changePassword(db, ctx, input);
});

export const setTwoFactorAction = defineAction(
  { schema: z.object({ enabled: z.boolean() }) },
  async ({ enabled }, { db, ctx }) => {
    await setTwoFactor(db, ctx, enabled);
  },
);

export const updatePreferencesAction = defineAction(
  { schema: z.object({ notifyTransfers: z.boolean(), notifySecurity: z.boolean() }) },
  async (input, { db, ctx }) => {
    await updatePreferences(db, ctx, input);
  },
);

export const markNotificationReadAction = defineAction(
  { schema: z.object({ id: z.string().min(4).max(64) }) },
  async ({ id }, { db, user }) => {
    await markNotificationRead(db, user.id, id);
  },
);

export const markAllNotificationsReadAction = defineAction({ schema: z.object({}) }, async (_input, { db, user }) => {
  await markAllNotificationsRead(db, user.id);
});
