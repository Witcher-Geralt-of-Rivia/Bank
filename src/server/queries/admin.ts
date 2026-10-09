import "server-only";
import { type SQL, and, asc, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { type AuditLog, accounts, auditLogs, transactions, users } from "@/db/schema";
import {
  type AccountStatus,
  type AccountType,
  type Role,
  TRANSACTION_STATUSES,
  type TransactionStatus,
  type UserStatus,
} from "@/lib/domain";
import { type CurrencyCode, toBaseCurrency } from "@/lib/money";

/**
 * Platform-wide read models for the operations console. Nothing here checks
 * the caller: every function must only be reached after a staff role has been
 * verified.
 */

const DAY = 24 * 60 * 60 * 1000;

export type OperationsOverview = {
  customers: number;
  suspendedUsers: number;
  activeAccounts: number;
  frozenAccounts: number;
  /** Customer deposits held, base currency. */
  depositsBaseMinor: bigint;
  statusCounts: Record<TransactionStatus, number>;
  last24h: { count: number; volumeBaseMinor: bigint; failed: number };
  previous24h: { count: number; volumeBaseMinor: bigint };
  awaitingReview: { count: number; valueBaseMinor: bigint; oldestAt: Date | null };
  inTransit: { count: number; valueBaseMinor: bigint };
  /** Transactions per day for the last 14 days, oldest first. */
  daily: { date: string; count: number; failed: number }[];
};

export async function getOperationsOverview(
  db: DbOrTx,
  now: Date = new Date(),
): Promise<OperationsOverview> {
  const since24 = new Date(now.getTime() - DAY);
  const since48 = new Date(now.getTime() - 2 * DAY);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const since14 = new Date(today - 13 * DAY);

  const [userRows, accountRows, statusRows, recentRows, openRows, dailyRows] = await Promise.all([
    db
      .select({ role: users.role, status: users.status, count: sql<string>`count(*)::text` })
      .from(users)
      .groupBy(users.role, users.status),
    db
      .select({
        status: accounts.status,
        currency: accounts.currency,
        count: sql<string>`count(*)::text`,
        total: sql<string>`COALESCE(SUM(${accounts.postedMinor}), 0)::text`,
      })
      .from(accounts)
      .where(eq(accounts.kind, "customer"))
      .groupBy(accounts.status, accounts.currency),
    db
      .select({ status: transactions.status, count: sql<string>`count(*)::text` })
      .from(transactions)
      .groupBy(transactions.status),
    db
      .select({
        recent: sql<boolean>`${transactions.createdAt} >= ${since24.toISOString()}::timestamptz`,
        currency: transactions.currency,
        count: sql<string>`count(*)::text`,
        failed: sql<string>`count(*) FILTER (WHERE ${transactions.status} = 'failed')::text`,
        volume: sql<string>`COALESCE(SUM(${transactions.amountMinor}) FILTER (WHERE ${transactions.status} IN ('completed', 'processing')), 0)::text`,
      })
      .from(transactions)
      .where(gte(transactions.createdAt, since48))
      .groupBy(sql`1, 2`),
    db
      .select({
        status: transactions.status,
        currency: transactions.currency,
        count: sql<string>`count(*)::text`,
        total: sql<string>`COALESCE(SUM(${transactions.amountMinor}), 0)::text`,
        oldest: sql<string | null>`to_char(MIN(${transactions.createdAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      })
      .from(transactions)
      .where(sql`${transactions.status} IN ('pending', 'processing')`)
      .groupBy(transactions.status, transactions.currency),
    db
      .select({
        date: sql<string>`to_char(${transactions.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
        count: sql<string>`count(*)::text`,
        failed: sql<string>`count(*) FILTER (WHERE ${transactions.status} = 'failed')::text`,
      })
      .from(transactions)
      .where(gte(transactions.createdAt, since14))
      .groupBy(sql`1`),
  ]);

  const overview: OperationsOverview = {
    customers: 0,
    suspendedUsers: 0,
    activeAccounts: 0,
    frozenAccounts: 0,
    depositsBaseMinor: 0n,
    statusCounts: Object.fromEntries(TRANSACTION_STATUSES.map((s) => [s, 0])) as Record<TransactionStatus, number>,
    last24h: { count: 0, volumeBaseMinor: 0n, failed: 0 },
    previous24h: { count: 0, volumeBaseMinor: 0n },
    awaitingReview: { count: 0, valueBaseMinor: 0n, oldestAt: null },
    inTransit: { count: 0, valueBaseMinor: 0n },
    daily: [],
  };

  for (const row of userRows) {
    if (row.role === "customer") overview.customers += Number(row.count);
    if (row.status === "suspended") overview.suspendedUsers += Number(row.count);
  }
  for (const row of accountRows) {
    if (row.status === "active") overview.activeAccounts += Number(row.count);
    if (row.status === "frozen") overview.frozenAccounts += Number(row.count);
    overview.depositsBaseMinor += toBaseCurrency(BigInt(row.total), row.currency);
  }
  for (const row of statusRows) overview.statusCounts[row.status] = Number(row.count);
  for (const row of recentRows) {
    const volume = toBaseCurrency(BigInt(row.volume), row.currency);
    if (row.recent) {
      overview.last24h.count += Number(row.count);
      overview.last24h.failed += Number(row.failed);
      overview.last24h.volumeBaseMinor += volume;
    } else {
      overview.previous24h.count += Number(row.count);
      overview.previous24h.volumeBaseMinor += volume;
    }
  }
  for (const row of openRows) {
    const value = toBaseCurrency(BigInt(row.total), row.currency);
    if (row.status === "pending") {
      overview.awaitingReview.count += Number(row.count);
      overview.awaitingReview.valueBaseMinor += value;
      const oldest = row.oldest ? new Date(row.oldest) : null;
      if (oldest && (!overview.awaitingReview.oldestAt || oldest < overview.awaitingReview.oldestAt)) {
        overview.awaitingReview.oldestAt = oldest;
      }
    } else {
      overview.inTransit.count += Number(row.count);
      overview.inTransit.valueBaseMinor += value;
    }
  }

  const byDate = new Map(dailyRows.map((row) => [row.date, row]));
  for (let i = 0; i < 14; i++) {
    const date = new Date(since14.getTime() + i * DAY).toISOString().slice(0, 10);
    const row = byDate.get(date);
    overview.daily.push({ date, count: Number(row?.count ?? 0), failed: Number(row?.failed ?? 0) });
  }
  return overview;
}

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  company: string | null;
  twoFactorEnabled: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  accountCount: number;
  /** Combined balance in the base currency. */
  balanceBaseMinor: bigint;
};

export async function listUsers(db: DbOrTx, q?: string): Promise<AdminUserRow[]> {
  const term = q?.trim();
  const pattern = term ? `%${term.replace(/[\\%_]/g, "\\$&")}%` : null;

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      company: users.company,
      twoFactorEnabled: users.twoFactorEnabled,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(pattern ? or(ilike(users.name, pattern), ilike(users.email, pattern), ilike(users.company, pattern)) : undefined)
    .orderBy(asc(users.role), asc(users.name));

  const balances = await db
    .select({
      ownerId: accounts.ownerId,
      currency: accounts.currency,
      count: sql<string>`count(*)::text`,
      total: sql<string>`COALESCE(SUM(${accounts.postedMinor}), 0)::text`,
    })
    .from(accounts)
    .where(eq(accounts.kind, "customer"))
    .groupBy(accounts.ownerId, accounts.currency);

  const byOwner = new Map<string, { count: number; total: bigint }>();
  for (const row of balances) {
    if (!row.ownerId) continue;
    const entry = byOwner.get(row.ownerId) ?? { count: 0, total: 0n };
    entry.count += Number(row.count);
    entry.total += toBaseCurrency(BigInt(row.total), row.currency);
    byOwner.set(row.ownerId, entry);
  }

  return rows.map((row) => ({
    ...row,
    accountCount: byOwner.get(row.id)?.count ?? 0,
    balanceBaseMinor: byOwner.get(row.id)?.total ?? 0n,
  }));
}

export type AdminAccountRow = {
  id: string;
  name: string;
  number: string;
  type: AccountType;
  kind: "customer" | "system";
  currency: CurrencyCode;
  status: AccountStatus;
  postedMinor: bigint;
  heldMinor: bigint;
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  createdAt: Date;
};

export async function listAllAccounts(db: DbOrTx): Promise<AdminAccountRow[]> {
  return db
    .select({
      id: accounts.id,
      name: accounts.name,
      number: accounts.number,
      type: accounts.type,
      kind: accounts.kind,
      currency: accounts.currency,
      status: accounts.status,
      postedMinor: accounts.postedMinor,
      heldMinor: accounts.heldMinor,
      ownerId: accounts.ownerId,
      ownerName: users.name,
      ownerEmail: users.email,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .leftJoin(users, eq(users.id, accounts.ownerId))
    .orderBy(asc(accounts.kind), asc(users.name), asc(accounts.createdAt));
}

export type AuditFilters = { area?: string; q?: string; page?: number; pageSize?: number };

export async function listAuditLogs(
  db: DbOrTx,
  filters: AuditFilters = {},
): Promise<{ rows: AuditLog[]; total: number; page: number; pageCount: number }> {
  const pageSize = filters.pageSize ?? 25;
  const conditions: SQL[] = [];
  if (filters.area && /^[a-z_]+$/.test(filters.area)) {
    conditions.push(sql`${auditLogs.action} LIKE ${`${filters.area}.%`}`);
  }
  const term = filters.q?.trim();
  if (term) {
    const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(
      or(ilike(auditLogs.actorLabel, pattern), ilike(auditLogs.summary, pattern), ilike(auditLogs.entityId, pattern))!,
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [{ count }] = await db.select({ count: sql<string>`count(*)::text` }).from(auditLogs).where(where);
  const total = Number(count);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(filters.page ?? 1, 1), pageCount);

  const rows = await db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.seq))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { rows, total, page, pageCount };
}

export async function recentAuditLogs(db: DbOrTx, limit = 8): Promise<AuditLog[]> {
  return db.select().from(auditLogs).orderBy(desc(auditLogs.seq)).limit(limit);
}
