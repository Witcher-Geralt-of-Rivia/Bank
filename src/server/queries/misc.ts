import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  type Beneficiary,
  type Notification,
  auditLogs,
  beneficiaries,
  notifications,
  transactions,
} from "@/db/schema";
import type { CurrencyCode } from "@/lib/money";

// --- beneficiaries ---------------------------------------------------------

export type BeneficiaryView = Beneficiary & {
  transferCount: number;
  totalSentMinor: bigint;
};

export async function listBeneficiaries(db: DbOrTx, userId: string): Promise<BeneficiaryView[]> {
  const rows = await db
    .select({
      beneficiary: beneficiaries,
      transferCount: sql<string>`count(${transactions.id}) FILTER (WHERE ${transactions.status} IN ('completed', 'processing'))::text`,
      totalSent: sql<string>`COALESCE(SUM(${transactions.amountMinor}) FILTER (WHERE ${transactions.status} IN ('completed', 'processing')), 0)::text`,
    })
    .from(beneficiaries)
    .leftJoin(transactions, eq(transactions.beneficiaryId, beneficiaries.id))
    .where(and(eq(beneficiaries.ownerId, userId), isNull(beneficiaries.archivedAt)))
    .groupBy(beneficiaries.id)
    .orderBy(sql`${beneficiaries.lastUsedAt} DESC NULLS LAST`, beneficiaries.name);

  return rows.map((row) => ({
    ...row.beneficiary,
    transferCount: Number(row.transferCount),
    totalSentMinor: BigInt(row.totalSent),
  }));
}

/** A beneficiary as seen by its owner; null if it belongs to anyone else. */
export async function getBeneficiary(
  db: DbOrTx,
  userId: string,
  id: string,
): Promise<BeneficiaryView | null> {
  const all = await listBeneficiaries(db, userId);
  return all.find((b) => b.id === id) ?? null;
}

// --- notifications ---------------------------------------------------------

export async function listNotifications(
  db: DbOrTx,
  userId: string,
  limit = 60,
): Promise<Notification[]> {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function countUnreadNotifications(db: DbOrTx, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<string>`count(*)::text` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(row?.count ?? 0);
}

export async function markNotificationRead(db: DbOrTx, userId: string, id: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)));
}

export async function markAllNotificationsRead(db: DbOrTx, userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

// --- activity --------------------------------------------------------------

export type SignInRecord = {
  at: Date;
  success: boolean;
  ip: string | null;
  userAgent: string | null;
};

/** Recent sign-in attempts for a user, taken from the audit log. */
export async function listSignInActivity(
  db: DbOrTx,
  userId: string,
  limit = 8,
): Promise<SignInRecord[]> {
  const rows = await db
    .select({ at: auditLogs.createdAt, action: auditLogs.action, ip: auditLogs.ip, userAgent: auditLogs.userAgent })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityId, userId), sql`${auditLogs.action} IN ('auth.login', 'auth.login_failed')`))
    .orderBy(desc(auditLogs.seq))
    .limit(limit);
  return rows.map((row) => ({ at: row.at, success: row.action === "auth.login", ip: row.ip, userAgent: row.userAgent }));
}

/** Pending and in-flight totals for a customer, per currency. */
export async function getOpenTransferCounts(
  db: DbOrTx,
  accountIds: string[],
): Promise<{ pending: number; processing: number; pendingByCurrency: Map<CurrencyCode, bigint> }> {
  const result = { pending: 0, processing: 0, pendingByCurrency: new Map<CurrencyCode, bigint>() };
  if (accountIds.length === 0) return result;

  const mine = sql`(${sql.join(accountIds.map((id) => sql`${id}`), sql`, `)})`;
  const rows = await db
    .select({
      status: transactions.status,
      currency: transactions.currency,
      count: sql<string>`count(*)::text`,
      total: sql<string>`SUM(${transactions.amountMinor})::text`,
    })
    .from(transactions)
    .where(sql`${transactions.sourceAccountId} IN ${mine} AND ${transactions.status} IN ('pending', 'processing')`)
    .groupBy(transactions.status, transactions.currency);

  for (const row of rows) {
    if (row.status === "pending") {
      result.pending += Number(row.count);
      result.pendingByCurrency.set(row.currency, BigInt(row.total));
    } else {
      result.processing += Number(row.count);
    }
  }
  return result;
}
