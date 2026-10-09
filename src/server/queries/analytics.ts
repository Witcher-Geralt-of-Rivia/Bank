import "server-only";
import { type SQL, and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { accounts, ledgerEntries, transactions } from "@/db/schema";
import { BASE_CURRENCY, type CurrencyCode, toBaseCurrency } from "@/lib/money";
import { accountIdsOf } from "./transactions";

/**
 * Cash-flow analytics.
 *
 * "Money in" and "money out" count movements that cross the boundary of the
 * customer's own accounts; transfers between their accounts are neither. Only
 * settled or in-transit movements count: pending, failed and reversed
 * transactions (and the reversals themselves) are excluded. Amounts in other
 * currencies are expressed in the base currency at an indicative rate.
 */

const DAY = 24 * 60 * 60 * 1000;

function idList(ids: string[]): SQL {
  return sql`(${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;
}

function flowExpressions(ids: string[]) {
  const mine = idList(ids);
  const inflow = sql`${transactions.destinationAccountId} IN ${mine} AND (${transactions.sourceAccountId} IS NULL OR ${transactions.sourceAccountId} NOT IN ${mine})`;
  const outflow = sql`${transactions.sourceAccountId} IN ${mine} AND (${transactions.destinationAccountId} IS NULL OR ${transactions.destinationAccountId} NOT IN ${mine})`;
  const counted = sql`${transactions.status} IN ('completed', 'processing') AND ${transactions.type} <> 'reversal'`;
  const touches = sql`(${transactions.sourceAccountId} IN ${mine} OR ${transactions.destinationAccountId} IN ${mine})`;
  return { inflow, outflow, counted, touches };
}

export type PeriodFlow = {
  inMinor: bigint;
  outMinor: bigint;
  /** Number of movements in the period, including internal ones. */
  count: number;
  /** Gross value moved (in + out), base currency. */
  volumeMinor: bigint;
};

export type FlowComparison = { current: PeriodFlow; previous: PeriodFlow; days: number };

const emptyFlow = (): PeriodFlow => ({ inMinor: 0n, outMinor: 0n, count: 0, volumeMinor: 0n });

/** The last `days` days against the `days` before them. */
export async function getFlowComparison(
  db: DbOrTx,
  userId: string,
  days = 30,
  now: Date = new Date(),
): Promise<FlowComparison> {
  const ids = await accountIdsOf(db, userId);
  const result: FlowComparison = { current: emptyFlow(), previous: emptyFlow(), days };
  if (ids.length === 0) return result;

  const { inflow, outflow, counted, touches } = flowExpressions(ids);
  const split = new Date(now.getTime() - days * DAY);
  const start = new Date(now.getTime() - 2 * days * DAY);

  const rows = await db
    .select({
      currency: transactions.currency,
      recent: sql<boolean>`${transactions.createdAt} >= ${split.toISOString()}::timestamptz`,
      inflow: sql<string>`COALESCE(SUM(${transactions.amountMinor}) FILTER (WHERE ${inflow}), 0)::text`,
      outflow: sql<string>`COALESCE(SUM(${transactions.amountMinor}) FILTER (WHERE ${outflow}), 0)::text`,
      count: sql<string>`count(*)::text`,
    })
    .from(transactions)
    .where(and(touches, counted, gte(transactions.createdAt, start)))
    // Grouped by position: the expression carries a bind parameter.
    .groupBy(sql`1, 2`);

  for (const row of rows) {
    const bucket = row.recent ? result.current : result.previous;
    const inMinor = toBaseCurrency(BigInt(row.inflow), row.currency);
    const outMinor = toBaseCurrency(BigInt(row.outflow), row.currency);
    bucket.inMinor += inMinor;
    bucket.outMinor += outMinor;
    bucket.volumeMinor += inMinor + outMinor;
    bucket.count += Number(row.count);
  }
  return result;
}

export type MonthlyFlow = {
  /** First day of the month, UTC. */
  month: Date;
  inMinor: bigint;
  outMinor: bigint;
  isCurrent: boolean;
};

/** Money in and out per calendar month, oldest first, in the base currency. */
export async function getMonthlyCashFlow(
  db: DbOrTx,
  userId: string,
  months = 6,
  now: Date = new Date(),
): Promise<MonthlyFlow[]> {
  const ids = await accountIdsOf(db, userId);
  const buckets: MonthlyFlow[] = [];
  for (let i = months - 1; i >= 0; i--) {
    buckets.push({
      month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)),
      inMinor: 0n,
      outMinor: 0n,
      isCurrent: i === 0,
    });
  }
  if (ids.length === 0) return buckets;

  const { inflow, outflow, counted, touches } = flowExpressions(ids);
  const month = sql`to_char(date_trunc('month', ${transactions.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM')`;

  const rows = await db
    .select({
      month: sql<string>`${month}`,
      currency: transactions.currency,
      inflow: sql<string>`COALESCE(SUM(${transactions.amountMinor}) FILTER (WHERE ${inflow}), 0)::text`,
      outflow: sql<string>`COALESCE(SUM(${transactions.amountMinor}) FILTER (WHERE ${outflow}), 0)::text`,
    })
    .from(transactions)
    .where(and(touches, counted, gte(transactions.createdAt, buckets[0].month)))
    .groupBy(month, transactions.currency);

  const index = new Map(buckets.map((bucket) => [bucket.month.toISOString().slice(0, 7), bucket]));
  for (const row of rows) {
    const bucket = index.get(row.month);
    if (!bucket) continue;
    bucket.inMinor += toBaseCurrency(BigInt(row.inflow), row.currency);
    bucket.outMinor += toBaseCurrency(BigInt(row.outflow), row.currency);
  }
  return buckets;
}

export type CategoryTotal = { category: string; totalMinor: bigint; count: number };

/** Outgoing money by category over the period, largest first, base currency. */
export async function getSpendingByCategory(
  db: DbOrTx,
  userId: string,
  days = 90,
  now: Date = new Date(),
): Promise<CategoryTotal[]> {
  const ids = await accountIdsOf(db, userId);
  if (ids.length === 0) return [];
  const { outflow, counted } = flowExpressions(ids);
  const category = sql<string>`COALESCE(${transactions.category}, 'other')`;

  const rows = await db
    .select({
      category,
      currency: transactions.currency,
      total: sql<string>`SUM(${transactions.amountMinor})::text`,
      count: sql<string>`count(*)::text`,
    })
    .from(transactions)
    .where(and(outflow, counted, gte(transactions.createdAt, new Date(now.getTime() - days * DAY))))
    .groupBy(category, transactions.currency);

  const totals = new Map<string, CategoryTotal>();
  for (const row of rows) {
    const entry = totals.get(row.category) ?? { category: row.category, totalMinor: 0n, count: 0 };
    entry.totalMinor += toBaseCurrency(BigInt(row.total), row.currency);
    entry.count += Number(row.count);
    totals.set(row.category, entry);
  }
  return [...totals.values()].sort((a, b) => (a.totalMinor < b.totalMinor ? 1 : a.totalMinor > b.totalMinor ? -1 : 0));
}

export type CounterpartyTotal = {
  name: string;
  totalMinor: bigint;
  count: number;
  lastAt: Date;
};

/** The parties the customer pays, or is paid by, the most. Base currency. */
export async function getTopCounterparties(
  db: DbOrTx,
  userId: string,
  direction: "in" | "out",
  days = 90,
  limit = 6,
  now: Date = new Date(),
): Promise<CounterpartyTotal[]> {
  const ids = await accountIdsOf(db, userId);
  if (ids.length === 0) return [];
  const { inflow, outflow, counted } = flowExpressions(ids);

  const rows = await db
    .select({
      name: transactions.counterpartyName,
      currency: transactions.currency,
      total: sql<string>`SUM(${transactions.amountMinor})::text`,
      count: sql<string>`count(*)::text`,
      lastAt: sql<string>`to_char(MAX(${transactions.createdAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    })
    .from(transactions)
    .where(
      and(
        direction === "in" ? inflow : outflow,
        counted,
        sql`${transactions.counterpartyName} IS NOT NULL`,
        sql`${transactions.type} NOT IN ('fee', 'interest')`,
        gte(transactions.createdAt, new Date(now.getTime() - days * DAY)),
      ),
    )
    .groupBy(transactions.counterpartyName, transactions.currency);

  const totals = new Map<string, CounterpartyTotal>();
  for (const row of rows) {
    const name = row.name!;
    const lastAt = new Date(row.lastAt);
    const entry = totals.get(name) ?? { name, totalMinor: 0n, count: 0, lastAt };
    entry.totalMinor += toBaseCurrency(BigInt(row.total), row.currency);
    entry.count += Number(row.count);
    if (lastAt > entry.lastAt) entry.lastAt = lastAt;
    totals.set(name, entry);
  }
  return [...totals.values()]
    .sort((a, b) => (a.totalMinor < b.totalMinor ? 1 : a.totalMinor > b.totalMinor ? -1 : 0))
    .slice(0, limit);
}

export type BalancePoint = { date: string; balanceMinor: bigint };

/**
 * End-of-day combined balance in the base currency for each of the last
 * `days` days, rebuilt from ledger entries: every entry records the balance
 * it produced, so the series is exact rather than estimated.
 */
export async function getBalanceTrend(
  db: DbOrTx,
  userId: string,
  days = 90,
  now: Date = new Date(),
): Promise<BalancePoint[]> {
  const owned = await db
    .select({ id: accounts.id, currency: accounts.currency, postedMinor: accounts.postedMinor })
    .from(accounts)
    .where(eq(accounts.ownerId, userId));
  if (owned.length === 0) return [];

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = new Date(today - (days - 1) * DAY);

  const entries = await db
    .select({
      accountId: ledgerEntries.accountId,
      createdAt: ledgerEntries.createdAt,
      direction: ledgerEntries.direction,
      amountMinor: ledgerEntries.amountMinor,
      balanceAfterMinor: ledgerEntries.balanceAfterMinor,
    })
    .from(ledgerEntries)
    .where(and(inArray(ledgerEntries.accountId, owned.map((a) => a.id)), gte(ledgerEntries.createdAt, start)))
    .orderBy(asc(ledgerEntries.seq));

  // Balance of each account just before the window opens.
  const running = new Map<string, bigint>();
  const currencyOf = new Map<string, CurrencyCode>(owned.map((a) => [a.id, a.currency]));
  for (const account of owned) running.set(account.id, account.postedMinor);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.accountId)) continue;
    seen.add(entry.accountId);
    running.set(
      entry.accountId,
      entry.direction === "credit"
        ? entry.balanceAfterMinor - entry.amountMinor
        : entry.balanceAfterMinor + entry.amountMinor,
    );
  }

  const points: BalancePoint[] = [];
  let cursor = 0;
  for (let i = 0; i < days; i++) {
    const dayEnd = start.getTime() + (i + 1) * DAY;
    while (cursor < entries.length && entries[cursor].createdAt.getTime() < dayEnd) {
      running.set(entries[cursor].accountId, entries[cursor].balanceAfterMinor);
      cursor++;
    }
    let total = 0n;
    for (const [accountId, balance] of running) {
      total += toBaseCurrency(balance, currencyOf.get(accountId) ?? BASE_CURRENCY);
    }
    points.push({ date: new Date(start.getTime() + i * DAY).toISOString().slice(0, 10), balanceMinor: total });
  }
  return points;
}
