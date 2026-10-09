import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  AccountKind,
  AccountStatus,
  AccountType,
  BeneficiaryKind,
  EntryDirection,
  NotificationKind,
  Role,
  TransactionStatus,
  TransactionType,
  UserStatus,
} from "@/lib/domain";
import type { CurrencyCode } from "@/lib/money";

/**
 * Typed view of the schema for the query builder. The authoritative DDL —
 * including CHECK constraints and the triggers that make the ledger and audit
 * log append-only — lives in `./migrations.ts`.
 */

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

const money = (name: string) => bigint(name, { mode: "bigint" });

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<Role>().notNull(),
  status: text("status").$type<UserStatus>().notNull().default("active"),
  phone: text("phone"),
  company: text("company"),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  notifyTransfers: boolean("notify_transfers").notNull().default(true),
  notifySecurity: boolean("notify_security").notNull().default(true),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  lastLoginAt: timestamptz("last_login_at"),
});

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    /** Null for the bank's own system accounts. */
    ownerId: text("owner_id").references(() => users.id),
    kind: text("kind").$type<AccountKind>().notNull(),
    type: text("type").$type<AccountType>().notNull(),
    name: text("name").notNull(),
    number: text("number").notNull().unique(),
    currency: text("currency").$type<CurrencyCode>().notNull(),
    status: text("status").$type<AccountStatus>().notNull().default("active"),
    /** Running balance of posted ledger entries (credits − debits). */
    postedMinor: money("posted_minor").notNull().default(0n),
    /** Funds reserved by transactions that are pending review. */
    heldMinor: money("held_minor").notNull().default(0n),
    /** System accounts may run negative; customer accounts may not. */
    allowNegative: boolean("allow_negative").notNull().default(false),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [index("accounts_owner_idx").on(t.ownerId)],
);

export const beneficiaries = pgTable(
  "beneficiaries",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").$type<BeneficiaryKind>().notNull(),
    name: text("name").notNull(),
    nickname: text("nickname"),
    email: text("email"),
    bankName: text("bank_name").notNull(),
    accountNumber: text("account_number").notNull(),
    routingCode: text("routing_code"),
    country: text("country").notNull(),
    currency: text("currency").$type<CurrencyCode>().notNull(),
    /** Set when the beneficiary holds an account on this platform. */
    internalAccountId: text("internal_account_id").references(
      () => accounts.id,
    ),
    archivedAt: timestamptz("archived_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    lastUsedAt: timestamptz("last_used_at"),
  },
  (t) => [index("beneficiaries_owner_idx").on(t.ownerId)],
);

export type TransactionMetadata = {
  channel?: "web" | "api" | "system";
  ip?: string;
  userAgent?: string;
  route?: "instant" | "network" | "review";
  [key: string]: unknown;
};

export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    reference: text("reference").notNull().unique(),
    /** Who the idempotency key belongs to: a user id, or "system". */
    idempotencyScope: text("idempotency_scope").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    /** Fingerprint of the original request, to detect key reuse. */
    requestHash: text("request_hash").notNull(),
    initiatedBy: text("initiated_by").references(() => users.id),
    type: text("type").$type<TransactionType>().notNull(),
    status: text("status").$type<TransactionStatus>().notNull(),
    amountMinor: money("amount_minor").notNull(),
    currency: text("currency").$type<CurrencyCode>().notNull(),
    sourceAccountId: text("source_account_id").references(() => accounts.id),
    destinationAccountId: text("destination_account_id").references(
      () => accounts.id,
    ),
    beneficiaryId: text("beneficiary_id").references(() => beneficiaries.id),
    counterpartyName: text("counterparty_name"),
    description: text("description").notNull(),
    category: text("category"),
    failureReason: text("failure_reason"),
    reversalOf: text("reversal_of"),
    metadata: jsonb("metadata")
      .$type<TransactionMetadata>()
      .notNull()
      .default({}),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    completedAt: timestamptz("completed_at"),
  },
  (t) => [
    uniqueIndex("transactions_idempotency_idx").on(
      t.idempotencyScope,
      t.idempotencyKey,
    ),
    index("transactions_source_idx").on(t.sourceAccountId, t.createdAt),
    index("transactions_destination_idx").on(
      t.destinationAccountId,
      t.createdAt,
    ),
    index("transactions_status_idx").on(t.status, t.createdAt),
    index("transactions_created_idx").on(t.createdAt),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    seq: bigint("seq", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    direction: text("direction").$type<EntryDirection>().notNull(),
    amountMinor: money("amount_minor").notNull(),
    currency: text("currency").$type<CurrencyCode>().notNull(),
    /** Account balance immediately after this entry was posted. */
    balanceAfterMinor: money("balance_after_minor").notNull(),
    memo: text("memo"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ledger_entries_account_idx").on(t.accountId, t.seq),
    index("ledger_entries_transaction_idx").on(t.transactionId),
  ],
);

export const transactionEvents = pgTable(
  "transaction_events",
  {
    seq: bigint("seq", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id),
    fromStatus: text("from_status").$type<TransactionStatus>(),
    toStatus: text("to_status").$type<TransactionStatus>().notNull(),
    actorId: text("actor_id").references(() => users.id),
    actorLabel: text("actor_label").notNull(),
    note: text("note"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [index("transaction_events_tx_idx").on(t.transactionId, t.seq)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    seq: bigint("seq", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    id: text("id").notNull().unique(),
    actorId: text("actor_id"),
    actorLabel: text("actor_label").notNull(),
    actorRole: text("actor_role").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ip: text("ip"),
    userAgent: text("user_agent"),
    /** Hash of the previous record; links the log into a tamper-evident chain. */
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_created_idx").on(t.createdAt),
    index("audit_logs_actor_idx").on(t.actorId, t.seq),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").$type<NotificationKind>().notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href"),
    readAt: timestamptz("read_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Beneficiary = typeof beneficiaries.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type TransactionEvent = typeof transactionEvents.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
