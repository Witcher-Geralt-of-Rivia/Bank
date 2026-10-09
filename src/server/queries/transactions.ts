import "server-only";
import { type SQL, and, asc, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbOrTx } from "@/db/client";
import {
  type Transaction,
  accounts,
  beneficiaries,
  ledgerEntries,
  transactionEvents,
  transactions,
  users,
} from "@/db/schema";
import {
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  type TransactionStatus,
  type TransactionType,
} from "@/lib/domain";

const source = alias(accounts, "source_account");
const destination = alias(accounts, "destination_account");
const sourceOwner = alias(users, "source_owner");
const destinationOwner = alias(users, "destination_owner");

export type AccountRef = {
  id: string;
  name: string;
  number: string;
  ownerId: string | null;
  ownerName: string | null;
};

/** How a transaction relates to the person looking at it. */
export type Direction = "in" | "out" | "internal";

export type TransactionView = Pick<
  Transaction,
  | "id"
  | "reference"
  | "type"
  | "status"
  | "amountMinor"
  | "currency"
  | "description"
  | "counterpartyName"
  | "category"
  | "failureReason"
  | "createdAt"
  | "completedAt"
  | "reversalOf"
  | "beneficiaryId"
  | "initiatedBy"
> & {
  source: AccountRef | null;
  destination: AccountRef | null;
  direction: Direction;
  /** The other party, from the viewer's point of view. */
  counterparty: string;
  /** The viewer's own account involved in the movement. */
  ownAccount: AccountRef | null;
};

const selection = {
  transaction: transactions,
  sourceId: source.id,
  sourceName: source.name,
  sourceNumber: source.number,
  sourceOwnerId: source.ownerId,
  sourceOwnerName: sourceOwner.name,
  destinationId: destination.id,
  destinationName: destination.name,
  destinationNumber: destination.number,
  destinationOwnerId: destination.ownerId,
  destinationOwnerName: destinationOwner.name,
};

function baseQuery(db: DbOrTx) {
  return db
    .select(selection)
    .from(transactions)
    .leftJoin(source, eq(source.id, transactions.sourceAccountId))
    .leftJoin(destination, eq(destination.id, transactions.destinationAccountId))
    .leftJoin(sourceOwner, eq(sourceOwner.id, source.ownerId))
    .leftJoin(destinationOwner, eq(destinationOwner.id, destination.ownerId));
}

type Row = Awaited<ReturnType<typeof baseQuery>>[number];

/**
 * Shapes a row for display. `viewerId` is the customer looking at it, or null
 * for staff, who see every movement from the bank's neutral point of view.
 */
function toView(row: Row, viewerId: string | null): TransactionView {
  const t = row.transaction;
  const src: AccountRef | null = row.sourceId
    ? { id: row.sourceId, name: row.sourceName!, number: row.sourceNumber!, ownerId: row.sourceOwnerId, ownerName: row.sourceOwnerName }
    : null;
  const dst: AccountRef | null = row.destinationId
    ? { id: row.destinationId, name: row.destinationName!, number: row.destinationNumber!, ownerId: row.destinationOwnerId, ownerName: row.destinationOwnerName }
    : null;

  const ownsSource = viewerId !== null && src?.ownerId === viewerId;
  const ownsDestination = viewerId !== null && dst?.ownerId === viewerId;

  let direction: Direction;
  if (viewerId === null) direction = src && dst ? "internal" : src ? "out" : "in";
  else if (ownsSource && ownsDestination) direction = "internal";
  else direction = ownsSource ? "out" : "in";

  let counterparty: string;
  if (direction === "internal" && viewerId !== null) {
    counterparty = `${src!.name} → ${dst!.name}`;
  } else if (direction === "out") {
    counterparty = t.counterpartyName ?? dst?.ownerName ?? dst?.name ?? "External account";
  } else {
    counterparty =
      viewerId !== null && src?.ownerName ? src.ownerName : (t.counterpartyName ?? src?.ownerName ?? "External account");
  }

  return {
    id: t.id,
    reference: t.reference,
    type: t.type,
    status: t.status,
    amountMinor: t.amountMinor,
    currency: t.currency,
    description: t.description,
    counterpartyName: t.counterpartyName,
    category: t.category,
    failureReason: t.failureReason,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
    reversalOf: t.reversalOf,
    beneficiaryId: t.beneficiaryId,
    initiatedBy: t.initiatedBy,
    source: src,
    destination: dst,
    direction,
    counterparty,
    ownAccount: direction === "in" ? dst : src,
  };
}

export type TransactionFilters = {
  q?: string;
  type?: TransactionType;
  status?: TransactionStatus;
  accountId?: string;
  from?: Date;
  /** Exclusive upper bound. */
  to?: Date;
  page?: number;
  pageSize?: number;
};

export type TransactionPage = {
  rows: TransactionView[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

function filterConditions(filters: TransactionFilters): SQL[] {
  const conditions: SQL[] = [];
  if (filters.type) conditions.push(eq(transactions.type, filters.type));
  if (filters.status) conditions.push(eq(transactions.status, filters.status));
  if (filters.from) conditions.push(gte(transactions.createdAt, filters.from));
  if (filters.to) conditions.push(lt(transactions.createdAt, filters.to));
  if (filters.accountId) {
    conditions.push(
      or(
        eq(transactions.sourceAccountId, filters.accountId),
        eq(transactions.destinationAccountId, filters.accountId),
      )!,
    );
  }
  const q = filters.q?.trim();
  if (q) {
    // Escape LIKE wildcards so user input is always matched literally.
    const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(
      or(
        ilike(transactions.description, pattern),
        ilike(transactions.counterpartyName, pattern),
        ilike(transactions.reference, pattern),
        ilike(transactions.id, pattern),
      )!,
    );
  }
  return conditions;
}

async function paginate(
  db: DbOrTx,
  scope: SQL | undefined,
  filters: TransactionFilters,
  viewerId: string | null,
): Promise<TransactionPage> {
  const pageSize = Math.min(Math.max(filters.pageSize ?? 20, 1), 100);
  const where = and(scope, ...filterConditions(filters));

  const [{ count }] = await db
    .select({ count: sql<string>`count(*)::text` })
    .from(transactions)
    .where(where);
  const total = Number(count);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(filters.page ?? 1, 1), pageCount);

  const rows = await baseQuery(db)
    .where(where)
    .orderBy(desc(transactions.createdAt), desc(transactions.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { rows: rows.map((row) => toView(row, viewerId)), total, page, pageSize, pageCount };
}

/** Ids of the accounts a customer owns: the boundary of what they may see. */
export async function accountIdsOf(db: DbOrTx, userId: string): Promise<string[]> {
  const rows = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.ownerId, userId));
  return rows.map((row) => row.id);
}

function ownedBy(accountIds: string[]): SQL {
  return or(
    inArray(transactions.sourceAccountId, accountIds),
    inArray(transactions.destinationAccountId, accountIds),
  )!;
}

/** Transactions that touch one of the customer's accounts — and no others. */
export async function listTransactionsForUser(
  db: DbOrTx,
  userId: string,
  filters: TransactionFilters = {},
): Promise<TransactionPage> {
  const accountIds = await accountIdsOf(db, userId);
  if (accountIds.length === 0) {
    return { rows: [], total: 0, page: 1, pageSize: filters.pageSize ?? 20, pageCount: 1 };
  }
  // A filter on an account the customer does not own matches nothing.
  if (filters.accountId && !accountIds.includes(filters.accountId)) {
    return { rows: [], total: 0, page: 1, pageSize: filters.pageSize ?? 20, pageCount: 1 };
  }
  return paginate(db, ownedBy(accountIds), filters, userId);
}

/** Every transaction on the platform. Callers must have verified a staff role. */
export function listAllTransactions(
  db: DbOrTx,
  filters: TransactionFilters = {},
): Promise<TransactionPage> {
  return paginate(db, undefined, filters, null);
}

export type TransactionDetail = {
  transaction: TransactionView;
  beneficiary: typeof beneficiaries.$inferSelect | null;
  events: (typeof transactionEvents.$inferSelect)[];
  entries: {
    seq: number;
    accountId: string;
    accountName: string;
    accountNumber: string;
    accountKind: "customer" | "system";
    direction: "debit" | "credit";
    amountMinor: bigint;
    balanceAfterMinor: bigint;
    memo: string | null;
    createdAt: Date;
  }[];
  /** The transaction this one reverses, or the one that reversed it. */
  related: { id: string; reference: string; relation: "reverses" | "reversed_by" } | null;
  initiatedByName: string | null;
  metadata: Transaction["metadata"];
};

async function loadDetail(
  db: DbOrTx,
  id: string,
  viewerId: string | null,
): Promise<TransactionDetail | null> {
  const [row] = await baseQuery(db).where(eq(transactions.id, id)).limit(1);
  if (!row) return null;

  if (viewerId !== null && row.sourceOwnerId !== viewerId && row.destinationOwnerId !== viewerId) {
    return null;
  }

  const t = row.transaction;
  const [events, entryRows, beneficiaryRows, reversedBy, reverses, initiator] = await Promise.all([
    db.select().from(transactionEvents).where(eq(transactionEvents.transactionId, id)).orderBy(asc(transactionEvents.seq)),
    db
      .select({ entry: ledgerEntries, account: accounts })
      .from(ledgerEntries)
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .where(eq(ledgerEntries.transactionId, id))
      .orderBy(asc(ledgerEntries.seq)),
    t.beneficiaryId ? db.select().from(beneficiaries).where(eq(beneficiaries.id, t.beneficiaryId)).limit(1) : Promise.resolve([]),
    db.select({ id: transactions.id, reference: transactions.reference }).from(transactions).where(eq(transactions.reversalOf, id)).limit(1),
    t.reversalOf ? db.select({ id: transactions.id, reference: transactions.reference }).from(transactions).where(eq(transactions.id, t.reversalOf)).limit(1) : Promise.resolve([]),
    t.initiatedBy ? db.select({ name: users.name }).from(users).where(eq(users.id, t.initiatedBy)).limit(1) : Promise.resolve([]),
  ]);

  // Customers see the legs on their own accounts; the bank-side legs are
  // operational detail reserved for staff.
  const entries = entryRows
    .filter(({ account }) => viewerId === null || account.ownerId === viewerId)
    .map(({ entry, account }) => ({
      seq: entry.seq,
      accountId: account.id,
      accountName: account.name,
      accountNumber: account.number,
      accountKind: account.kind,
      direction: entry.direction,
      amountMinor: entry.amountMinor,
      balanceAfterMinor: entry.balanceAfterMinor,
      memo: entry.memo,
      createdAt: entry.createdAt,
    }));

  const related = reverses[0]
    ? { ...reverses[0], relation: "reverses" as const }
    : reversedBy[0]
      ? { ...reversedBy[0], relation: "reversed_by" as const }
      : null;

  const beneficiary = beneficiaryRows[0] ?? null;

  return {
    transaction: toView(row, viewerId),
    // A beneficiary belongs to the sender; the recipient must not see it.
    beneficiary: beneficiary && (viewerId === null || beneficiary.ownerId === viewerId) ? beneficiary : null,
    events,
    entries,
    related,
    initiatedByName: initiator[0]?.name ?? null,
    metadata: viewerId === null ? t.metadata : {},
  };
}

/** A transaction as seen by a customer; null unless it touches their accounts. */
export function getTransactionForUser(db: DbOrTx, userId: string, id: string) {
  return loadDetail(db, id, userId);
}

/** Full detail for staff. Callers must have verified a staff role. */
export function getTransactionForStaff(db: DbOrTx, id: string) {
  return loadDetail(db, id, null);
}

export async function recentTransactionsForUser(
  db: DbOrTx,
  userId: string,
  limit: number,
): Promise<TransactionView[]> {
  return (await listTransactionsForUser(db, userId, { pageSize: limit })).rows;
}

/** Parses untrusted URL search parameters into typed filters. */
export function parseTransactionFilters(
  params: Record<string, string | string[] | undefined>,
): TransactionFilters {
  const get = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  };
  const date = (value: string | undefined) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  };

  const type = get("type");
  const status = get("status");
  const to = date(get("to"));
  const page = Number(get("page"));

  return {
    q: get("q")?.slice(0, 80),
    type: (TRANSACTION_TYPES as readonly string[]).includes(type ?? "") ? (type as TransactionType) : undefined,
    status: (TRANSACTION_STATUSES as readonly string[]).includes(status ?? "") ? (status as TransactionStatus) : undefined,
    accountId: get("account"),
    from: date(get("from")),
    // The "to" date is inclusive in the UI.
    to: to ? new Date(to.getTime() + 24 * 60 * 60 * 1000) : undefined,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}
