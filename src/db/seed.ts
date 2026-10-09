import "server-only";
import { sql } from "drizzle-orm";
import {
  type Category,
  type Role,
  type TransactionStatus,
  type TransactionType,
  TRANSFER_POLICY,
  type UserStatus,
  maskAccountNumber,
} from "@/lib/domain";
import { type CurrencyCode, formatMoney } from "@/lib/money";
import { type AuditHashFields, GENESIS_HASH, hashAuditRecord } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import { seededId, seededReference, sha256 } from "@/server/ids";
import type { DbOrTx } from "./client";
import {
  accounts,
  auditLogs,
  beneficiaries,
  ledgerEntries,
  notifications,
  transactionEvents,
  transactions,
  users,
} from "./schema";

/**
 * Deterministic demo dataset.
 *
 * Six months of activity are planned in memory, in chronological order, by a
 * small simulator that applies the same posting rules as the ledger service
 * (balanced legs, no overdrafts, holds for transfers under review, reversals
 * as compensating transactions). The result is bulk-loaded in a handful of
 * statements so a cold start stays fast.
 *
 * The load is not taken on trust: the database's own constraints and
 * commit-time triggers validate every row, and `tests/seed.test.ts` runs the
 * full integrity report and audit-chain verification against the output.
 *
 * Identifiers and amounts are derived from stable keys rather than a counter
 * or random source, so two processes booting on the same day produce the same
 * records with the same ids.
 */

export const DEMO_PASSWORD = "Aldera-Demo-2026";

export const DEMO_ACCOUNTS: {
  role: Role;
  email: string;
  name: string;
  description: string;
}[] = [
  {
    role: "customer",
    email: "elena@aldera.example",
    name: "Elena Vargas",
    description: "Business owner with four accounts and six months of activity.",
  },
  {
    role: "operator",
    email: "ops@aldera.example",
    name: "Marcus Lee",
    description: "Reviews held transfers and monitors payment settlement.",
  },
  {
    role: "admin",
    email: "admin@aldera.example",
    name: "Priya Raman",
    description: "Full oversight: users, accounts, reversals and the audit trail.",
  },
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const HISTORY_DAYS = 196;

const UA = {
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
};

/** Stable pseudo-random integer in [0, modulo) derived from a key. */
function hashInt(key: string, modulo: number): number {
  return parseInt(sha256(key).slice(0, 8), 16) % modulo;
}

/** Stable amount between `min` and `max` minor units, in multiples of `step`. */
function amountBetween(key: string, min: number, max: number, step = 100): bigint {
  const slots = Math.floor((max - min) / step) + 1;
  return BigInt(min + hashInt(key, slots) * step);
}

// --- reference data --------------------------------------------------------

type Person = { id: string; label: string; role: Role | "system" };
type Client = { ip: string; userAgent: string };

const U = {
  elena: seededId("usr", "elena"),
  daniel: seededId("usr", "daniel"),
  mateo: seededId("usr", "mateo"),
  hannah: seededId("usr", "hannah"),
  lucas: seededId("usr", "lucas"),
  marcus: seededId("usr", "marcus"),
  camila: seededId("usr", "camila"),
  priya: seededId("usr", "priya"),
};

type SeedUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  company?: string;
  phone?: string;
  twoFactorEnabled?: boolean;
  joinedDaysAgo: number;
};

const SEED_USERS: SeedUser[] = [
  { id: U.elena, email: "elena@aldera.example", name: "Elena Vargas", role: "customer", company: "Vargas Studio LLC", phone: "+1 (415) 555-0142", joinedDaysAgo: 412 },
  { id: U.daniel, email: "daniel.okafor@aldera.example", name: "Daniel Okafor", role: "customer", company: "Okafor Consulting", phone: "+1 (312) 555-0178", twoFactorEnabled: true, joinedDaysAgo: 301 },
  { id: U.mateo, email: "mateo.rivas@aldera.example", name: "Mateo Rivas", role: "customer", company: "Rivas Import & Export", phone: "+1 (305) 555-0116", joinedDaysAgo: 188 },
  { id: U.hannah, email: "hannah.schmidt@aldera.example", name: "Hannah Schmidt", role: "customer", company: "Schmidt Architektur", phone: "+49 30 5550 0134", twoFactorEnabled: true, joinedDaysAgo: 97 },
  { id: U.lucas, email: "lucas.pereira@aldera.example", name: "Lucas Pereira", role: "customer", phone: "+1 (646) 555-0191", joinedDaysAgo: 64 },
  { id: U.marcus, email: "ops@aldera.example", name: "Marcus Lee", role: "operator", twoFactorEnabled: true, joinedDaysAgo: 520 },
  { id: U.camila, email: "camila.duarte@aldera.example", name: "Camila Duarte", role: "operator", twoFactorEnabled: true, joinedDaysAgo: 233 },
  { id: U.priya, email: "admin@aldera.example", name: "Priya Raman", role: "admin", twoFactorEnabled: true, joinedDaysAgo: 610 },
];

const person = (id: string): Person => {
  const user = SEED_USERS.find((u) => u.id === id)!;
  return { id: user.id, label: user.name, role: user.role };
};

const P = {
  elena: person(U.elena),
  daniel: person(U.daniel),
  mateo: person(U.mateo),
  hannah: person(U.hannah),
  marcus: person(U.marcus),
  camila: person(U.camila),
  priya: person(U.priya),
};

const A = {
  operating: seededId("acc", "elena-operating"),
  taxReserve: seededId("acc", "elena-tax"),
  payroll: seededId("acc", "elena-payroll"),
  euro: seededId("acc", "elena-eur"),
  danielChecking: seededId("acc", "daniel-checking"),
  danielSavings: seededId("acc", "daniel-savings"),
  mateoBusiness: seededId("acc", "mateo-business"),
  hannahGiro: seededId("acc", "hannah-giro"),
  lucasChecking: seededId("acc", "lucas-checking"),
};

type SeedAccount = {
  id: string;
  ownerId: string;
  name: string;
  type: "checking" | "savings" | "reserve";
  number: string;
  currency: CurrencyCode;
  openedDaysAgo: number;
};

const SEED_ACCOUNTS: SeedAccount[] = [
  { id: A.operating, ownerId: U.elena, name: "Operating Account", type: "checking", number: "4410 0286 4821", currency: "USD", openedDaysAgo: 412 },
  { id: A.taxReserve, ownerId: U.elena, name: "Tax Reserve", type: "reserve", number: "4410 0286 7730", currency: "USD", openedDaysAgo: 398 },
  { id: A.payroll, ownerId: U.elena, name: "Payroll Account", type: "checking", number: "4410 0286 1094", currency: "USD", openedDaysAgo: 365 },
  { id: A.euro, ownerId: U.elena, name: "Euro Operations", type: "checking", number: "ES12 9044 0001 2300 4455 5567", currency: "EUR", openedDaysAgo: 240 },
  { id: A.danielChecking, ownerId: U.daniel, name: "Everyday Checking", type: "checking", number: "4410 0731 2260", currency: "USD", openedDaysAgo: 301 },
  { id: A.danielSavings, ownerId: U.daniel, name: "Savings", type: "savings", number: "4410 0731 9015", currency: "USD", openedDaysAgo: 290 },
  { id: A.mateoBusiness, ownerId: U.mateo, name: "Business Checking", type: "checking", number: "4410 1147 3382", currency: "USD", openedDaysAgo: 188 },
  { id: A.hannahGiro, ownerId: U.hannah, name: "Geschäftskonto", type: "checking", number: "DE44 9044 0002 0071 3306 18", currency: "EUR", openedDaysAgo: 97 },
  { id: A.lucasChecking, ownerId: U.lucas, name: "Everyday Checking", type: "checking", number: "4410 1502 6647", currency: "USD", openedDaysAgo: 64 },
];

const B = {
  tomas: seededId("ben", "elena-tomas"),
  lucia: seededId("ben", "elena-lucia"),
  greenfield: seededId("ben", "elena-greenfield"),
  harborPoint: seededId("ben", "elena-harbor"),
  atlas: seededId("ben", "elena-atlas"),
  daniel: seededId("ben", "elena-daniel"),
  revenue: seededId("ben", "elena-revenue"),
  northgate: seededId("ben", "elena-northgate"),
  coastal: seededId("ben", "daniel-coastal"),
  andes: seededId("ben", "mateo-andes"),
  werkraum: seededId("ben", "hannah-werkraum"),
};

type SeedBeneficiary = {
  id: string;
  ownerId: string;
  kind: "internal" | "external";
  name: string;
  nickname?: string;
  email?: string;
  bankName: string;
  accountNumber: string;
  routingCode?: string;
  country: string;
  currency: CurrencyCode;
  internalAccountId?: string;
  addedDaysAgo: number;
};

const SEED_BENEFICIARIES: SeedBeneficiary[] = [
  { id: B.tomas, ownerId: U.elena, kind: "external", name: "Tomás Herrera", nickname: "Frontend contractor", email: "tomas@herrera.example", bankName: "Pinecrest National Bank", accountNumber: "7730 4418 2096", routingCode: "091 555 017", country: "US", currency: "USD", addedDaysAgo: 330 },
  { id: B.lucia, ownerId: U.elena, kind: "external", name: "Lucía Fernández", nickname: "Illustration", email: "lucia@estudiofernandez.example", bankName: "Litoral Banca", accountNumber: "ES81 9120 0044 7100 3382 9041", routingCode: "LITOESMM", country: "ES", currency: "EUR", addedDaysAgo: 210 },
  { id: B.greenfield, ownerId: U.elena, kind: "external", name: "Greenfield Print Co.", nickname: "Print vendor", email: "billing@greenfieldprint.example", bankName: "Harborview Trust", accountNumber: "5521 9003 6674", routingCode: "071 555 242", country: "US", currency: "USD", addedDaysAgo: 280 },
  { id: B.harborPoint, ownerId: U.elena, kind: "external", name: "Harbor Point Properties", nickname: "Studio rent", bankName: "Pinecrest National Bank", accountNumber: "7730 1150 8823", routingCode: "091 555 017", country: "US", currency: "USD", addedDaysAgo: 400 },
  { id: B.atlas, ownerId: U.elena, kind: "external", name: "Atlas Payroll Services", nickname: "Payroll funding", email: "funding@atlaspayroll.example", bankName: "Union Harbor Bank", accountNumber: "3308 7741 5520", routingCode: "021 555 906", country: "US", currency: "USD", addedDaysAgo: 360 },
  { id: B.daniel, ownerId: U.elena, kind: "internal", name: "Daniel Okafor", nickname: "Strategy consultant", email: "daniel.okafor@aldera.example", bankName: "Aldera", accountNumber: "4410 0731 2260", country: "US", currency: "USD", internalAccountId: A.danielChecking, addedDaysAgo: 250 },
  { id: B.revenue, ownerId: U.elena, kind: "external", name: "State Revenue Office", nickname: "Estimated taxes", bankName: "Capitol Reserve Bank", accountNumber: "9001 0000 4417", routingCode: "051 555 730", country: "US", currency: "USD", addedDaysAgo: 380 },
  { id: B.northgate, ownerId: U.elena, kind: "external", name: "Northgate Logistics", nickname: "Freight", bankName: "Sierra Azul Bank", accountNumber: "6120 3377 0458", routingCode: "121 555 388", country: "US", currency: "USD", addedDaysAgo: 45 },
  { id: B.coastal, ownerId: U.daniel, kind: "external", name: "Coastal Auto Group", bankName: "Union Harbor Bank", accountNumber: "3308 2209 7761", routingCode: "021 555 906", country: "US", currency: "USD", addedDaysAgo: 5 },
  { id: B.andes, ownerId: U.mateo, kind: "external", name: "Andes Supply Co.", bankName: "Sierra Azul Bank", accountNumber: "6120 8841 0093", routingCode: "121 555 388", country: "US", currency: "USD", addedDaysAgo: 120 },
  { id: B.werkraum, ownerId: U.hannah, kind: "external", name: "Werkraum Modellbau GmbH", bankName: "Nordlicht Bank AG", accountNumber: "DE07 9330 0010 0456 7781 02", routingCode: "NOLIDEBB", country: "DE", currency: "EUR", addedDaysAgo: 60 },
];

// --- in-memory ledger simulator -------------------------------------------

type TransactionRow = typeof transactions.$inferInsert & {
  id: string;
  reference: string;
  amountMinor: bigint;
  currency: CurrencyCode;
  status: TransactionStatus;
  createdAt: Date;
};

type AccountState = {
  id: string;
  name: string;
  number: string;
  ownerId: string | null;
  currency: CurrencyCode;
  posted: bigint;
  held: bigint;
  status: "active" | "frozen";
};

type Moment = { key: string; at: Date; actor: Person; client?: Client };
type PlanLeg = [accountId: string, direction: "debit" | "credit", amountMinor: bigint, memo?: string];

const SYSTEM: Person = { id: "", label: "System", role: "system" };
const SYSTEM_TYPES = ["clearing", "transit", "fees", "interest"] as const;
const systemAccount = (type: (typeof SYSTEM_TYPES)[number], currency: CurrencyCode) =>
  `acc_sys_${type}_${currency.toLowerCase()}`;

class Planner {
  readonly transactions: TransactionRow[] = [];
  readonly entries: (typeof ledgerEntries.$inferInsert)[] = [];
  readonly events: (typeof transactionEvents.$inferInsert)[] = [];
  readonly audits: (typeof auditLogs.$inferInsert)[] = [];
  readonly notifications: (typeof notifications.$inferInsert)[] = [];
  readonly accounts = new Map<string, AccountState>();
  readonly beneficiaryLastUsed = new Map<string, Date>();
  readonly lastLogin = new Map<string, Date>();
  readonly userStatus = new Map<string, UserStatus>();
  private lastHash = GENESIS_HASH;
  private counters = new Map<string, number>();

  constructor() {
    for (const account of SEED_ACCOUNTS) {
      this.accounts.set(account.id, { id: account.id, name: account.name, number: account.number, ownerId: account.ownerId, currency: account.currency, posted: 0n, held: 0n, status: "active" });
    }
    for (const currency of ["USD", "EUR"] as const) {
      for (const type of SYSTEM_TYPES) {
        const id = systemAccount(type, currency);
        this.accounts.set(id, { id, name: id, number: id, ownerId: null, currency, posted: 0n, held: 0n, status: "active" });
      }
    }
  }

  private nextId(key: string, prefix: "txn" | "aud" | "ntf"): string {
    const n = this.counters.get(key) ?? 0;
    this.counters.set(key, n + 1);
    return seededId(prefix, `${key}#${n}`);
  }

  private account(id: string): AccountState {
    const account = this.accounts.get(id);
    if (!account) throw new Error(`seed: unknown account ${id}`);
    return account;
  }

  private available(id: string): bigint {
    const account = this.account(id);
    return account.posted - account.held;
  }

  /** Mirrors `postEntries`: balanced legs, one currency, no customer overdraft. */
  private post(
    transactionId: string,
    currency: CurrencyCode,
    at: Date,
    legs: PlanLeg[],
  ): void {
    let net = 0n;
    for (const [accountId, direction, amountMinor, memo] of legs) {
      const account = this.account(accountId);
      if (account.currency !== currency) throw new Error(`seed: currency mismatch on ${account.name}`);
      account.posted += direction === "credit" ? amountMinor : -amountMinor;
      if (account.ownerId && account.posted - account.held < 0n) {
        throw new Error(`seed: ${account.name} would be overdrawn at ${at.toISOString()}`);
      }
      net += direction === "debit" ? amountMinor : -amountMinor;
      this.entries.push({ transactionId, accountId, direction, amountMinor, currency, balanceAfterMinor: account.posted, memo: memo ?? null, createdAt: at });
    }
    if (net !== 0n) throw new Error(`seed: unbalanced posting for ${transactionId}`);
  }

  private event(m: Moment, tx: TransactionRow, from: TransactionStatus | null, to: TransactionStatus, note: string): void {
    this.events.push({ transactionId: tx.id, fromStatus: from, toStatus: to, actorId: m.actor.id || null, actorLabel: m.actor.label, note, createdAt: m.at });
    if (from) {
      tx.status = to;
      tx.updatedAt = m.at;
      if (to === "completed") tx.completedAt = m.at;
    }
  }

  audit(
    m: Moment,
    entry: { action: string; entityType: string; entityId: string | null; summary: string; metadata?: Record<string, unknown>; actorLabel?: string },
  ): void {
    const record: AuditHashFields = {
      id: this.nextId(m.key, "aud"),
      actorId: m.actor.id || null,
      actorLabel: entry.actorLabel ?? m.actor.label,
      actorRole: m.actor.role,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      summary: entry.summary,
      metadata: entry.metadata ?? {},
      ip: m.client?.ip ?? null,
      userAgent: m.client?.userAgent ?? null,
      prevHash: this.lastHash,
      createdAt: m.at,
    };
    const hash = hashAuditRecord(record);
    this.audits.push({ ...record, hash });
    this.lastHash = hash;
  }

  private auditTransaction(m: Moment, action: string, tx: TransactionRow, summary: string, extra: Record<string, unknown> = {}): void {
    this.audit(m, {
      action,
      entityType: "transaction",
      entityId: tx.id,
      summary,
      metadata: { reference: tx.reference, type: tx.type, status: tx.status, amountMinor: tx.amountMinor.toString(), currency: tx.currency, ...extra },
    });
  }

  notify(m: Moment, userId: string | null | undefined, kind: "transaction" | "security" | "account" | "system", title: string, body: string, href: string): void {
    if (!userId) return;
    this.notifications.push({ id: this.nextId(m.key, "ntf"), userId, kind, title, body, href, createdAt: m.at });
  }

  private create(
    m: Moment,
    values: {
      type: TransactionType;
      status: TransactionStatus;
      amountMinor: bigint;
      currency: CurrencyCode;
      sourceAccountId?: string;
      destinationAccountId?: string;
      beneficiaryId?: string;
      counterpartyName?: string;
      description: string;
      category: Category;
      reversalOf?: string;
      metadata?: Record<string, unknown>;
    },
  ): TransactionRow {
    const row: TransactionRow = {
      id: this.nextId(m.key, "txn"),
      reference: seededReference(m.key),
      idempotencyScope: m.actor.role === "customer" ? m.actor.id : "system",
      idempotencyKey: `seed:${m.key}`,
      requestHash: sha256(`seed:${m.key}`),
      initiatedBy: m.actor.id || null,
      type: values.type,
      status: values.status,
      amountMinor: values.amountMinor,
      currency: values.currency,
      sourceAccountId: values.sourceAccountId ?? null,
      destinationAccountId: values.destinationAccountId ?? null,
      beneficiaryId: values.beneficiaryId ?? null,
      counterpartyName: values.counterpartyName ?? null,
      description: values.description,
      category: values.category,
      reversalOf: values.reversalOf ?? null,
      metadata: {
        channel: m.actor.role === "system" ? "system" : "web",
        ...(m.client ? { ip: m.client.ip, userAgent: m.client.userAgent } : {}),
        ...values.metadata,
      },
      createdAt: m.at,
      updatedAt: m.at,
      completedAt: values.status === "completed" ? m.at : null,
    };
    this.transactions.push(row);
    return row;
  }

  /** Card settlements, incoming payments, fees and interest. */
  activity(
    m: Moment,
    type: "card_payment" | "fee" | "interest" | "transfer_in",
    accountId: string,
    amountMinor: bigint,
    counterpartyName: string,
    description: string,
    category: Category,
  ): TransactionRow | null {
    const account = this.account(accountId);
    const incoming = type === "transfer_in" || type === "interest";
    if (!incoming && this.available(accountId) < amountMinor) return null;

    const counter = systemAccount(type === "fee" ? "fees" : type === "interest" ? "interest" : "clearing", account.currency);
    const tx = this.create(m, {
      type,
      status: "completed",
      amountMinor,
      currency: account.currency,
      sourceAccountId: incoming ? undefined : accountId,
      destinationAccountId: incoming ? accountId : undefined,
      counterpartyName,
      description,
      category,
    });
    this.post(tx.id, account.currency, m.at, incoming
      ? [[counter, "debit", amountMinor], [accountId, "credit", amountMinor]]
      : [[accountId, "debit", amountMinor], [counter, "credit", amountMinor]]);
    this.event(m, tx, null, "completed", "Posted to the ledger.");
    if (type === "transfer_in") {
      this.notify(m, account.ownerId, "transaction", "Payment received", `${counterpartyName} paid ${formatMoney(amountMinor, account.currency)} into ${account.name}.`, `/transactions/${tx.id}`);
    }
    return tx;
  }

  /** Mirrors `createTransfer`, including routing by destination and amount. */
  transfer(
    m: Moment,
    sourceAccountId: string,
    to: { accountId: string } | { beneficiaryId: string },
    amountMinor: bigint,
    description: string,
    category: Category,
  ): TransactionRow | null {
    const source = this.account(sourceAccountId);
    if (source.status !== "active" || this.available(sourceAccountId) < amountMinor) return null;

    const beneficiary = "beneficiaryId" in to ? SEED_BENEFICIARIES.find((b) => b.id === to.beneficiaryId)! : null;
    const destinationId = "accountId" in to ? to.accountId : (beneficiary?.internalAccountId ?? null);
    const destination = destinationId ? this.account(destinationId) : null;
    const route = destination ? "instant" : amountMinor >= TRANSFER_POLICY.reviewThresholdMinor ? "review" : "network";
    const status: TransactionStatus = route === "instant" ? "completed" : route === "network" ? "processing" : "pending";
    const target = beneficiary?.name ?? destination?.name ?? "destination";

    const tx = this.create(m, {
      type: destination ? "transfer_internal" : "transfer_out",
      status,
      amountMinor,
      currency: source.currency,
      sourceAccountId,
      destinationAccountId: destination?.id,
      beneficiaryId: beneficiary?.id,
      counterpartyName: beneficiary?.name,
      description,
      category,
      metadata: { route },
    });
    const amount = formatMoney(amountMinor, source.currency);

    if (route === "instant") {
      this.post(tx.id, source.currency, m.at, [[sourceAccountId, "debit", amountMinor], [destination!.id, "credit", amountMinor]]);
      this.event(m, tx, null, "completed", "Settled instantly on the Aldera ledger.");
    } else if (route === "network") {
      this.post(tx.id, source.currency, m.at, [[sourceAccountId, "debit", amountMinor], [systemAccount("transit", source.currency), "credit", amountMinor, "Funds in transit to receiving bank"]]);
      this.event(m, tx, null, "processing", "Submitted to the payment network.");
    } else {
      source.held += amountMinor;
      this.event(m, tx, null, "pending", `Held for review: at or above the ${formatMoney(TRANSFER_POLICY.reviewThresholdMinor, source.currency)} automatic approval limit.`);
    }

    if (beneficiary) this.beneficiaryLastUsed.set(beneficiary.id, m.at);
    this.auditTransaction(m, "transfer.created", tx, `Transfer of ${amount} to ${target} created (${status}).`, { route, source: maskAccountNumber(source.number), destination: target });

    if (route === "review") {
      this.notify(m, m.actor.id, "transaction", "Transfer held for review", `Your transfer of ${amount} to ${target} is being reviewed. Funds are reserved until a decision is made.`, `/transactions/${tx.id}`);
    }
    if (destination && destination.ownerId !== m.actor.id) {
      this.notify(m, destination.ownerId, "transaction", "Payment received", `${m.actor.label} sent you ${amount}.`, `/transactions/${tx.id}`);
    }
    return tx;
  }

  approve(m: Moment, tx: TransactionRow, note: string): void {
    const source = this.account(tx.sourceAccountId!);
    source.held -= tx.amountMinor;
    this.post(tx.id, tx.currency, m.at, [[source.id, "debit", tx.amountMinor], [systemAccount("transit", tx.currency), "credit", tx.amountMinor, "Funds in transit to receiving bank"]]);
    this.event(m, tx, "pending", "processing", note);
    this.auditTransaction(m, "transfer.approved", tx, `Transfer ${tx.reference} approved.`, { note });
    this.notify(m, tx.initiatedBy, "transaction", "Transfer approved", `Your transfer of ${formatMoney(tx.amountMinor, tx.currency)} to ${tx.counterpartyName} was approved and is on its way.`, `/transactions/${tx.id}`);
  }

  reject(m: Moment, tx: TransactionRow, reason: string): void {
    this.account(tx.sourceAccountId!).held -= tx.amountMinor;
    tx.failureReason = reason;
    this.event(m, tx, "pending", "failed", reason);
    this.auditTransaction(m, "transfer.rejected", tx, `Transfer ${tx.reference} rejected.`, { reason });
    this.notify(m, tx.initiatedBy, "transaction", "Transfer not approved", `Your transfer of ${formatMoney(tx.amountMinor, tx.currency)} was not approved and the reserved funds were released. Reason: ${reason}`, `/transactions/${tx.id}`);
  }

  settle(m: Moment, tx: TransactionRow): void {
    this.post(tx.id, tx.currency, m.at, [[systemAccount("transit", tx.currency), "debit", tx.amountMinor], [systemAccount("clearing", tx.currency), "credit", tx.amountMinor, "Settled with receiving bank"]]);
    this.event(m, tx, "processing", "completed", "Settlement confirmed by the receiving bank.");
    this.auditTransaction(m, "transfer.settled", tx, `Transfer ${tx.reference} settled.`);
  }

  fail(m: Moment, tx: TransactionRow, reason: string): void {
    this.post(tx.id, tx.currency, m.at, [[systemAccount("transit", tx.currency), "debit", tx.amountMinor], [tx.sourceAccountId!, "credit", tx.amountMinor, "Funds returned to sender"]]);
    tx.failureReason = reason;
    this.event(m, tx, "processing", "failed", reason);
    this.auditTransaction(m, "transfer.failed", tx, `Transfer ${tx.reference} failed; funds returned.`, { reason });
    this.notify(m, tx.initiatedBy, "transaction", "Transfer returned", `Your transfer of ${formatMoney(tx.amountMinor, tx.currency)} could not be delivered and the funds are back in your account. Reason: ${reason}`, `/transactions/${tx.id}`);
  }

  /** Mirrors `reverseTransaction`: a compensating transaction, never an edit. */
  reverse(m: Moment, original: TransactionRow, reason: string): void {
    const net = new Map<string, bigint>();
    for (const entry of this.entries) {
      if (entry.transactionId !== original.id) continue;
      const signed = entry.direction === "credit" ? entry.amountMinor : -entry.amountMinor;
      net.set(entry.accountId, (net.get(entry.accountId) ?? 0n) + signed);
    }
    const reversal = this.create(
      { ...m, key: `${m.key}:reversal` },
      {
        type: "reversal",
        status: "completed",
        amountMinor: original.amountMinor,
        currency: original.currency,
        sourceAccountId: original.destinationAccountId ?? undefined,
        destinationAccountId: original.sourceAccountId ?? undefined,
        counterpartyName: original.counterpartyName ?? undefined,
        description: `Reversal of ${original.reference} · ${original.description}`,
        category: (original.category ?? "other") as Category,
        reversalOf: original.id,
        metadata: { reason },
      },
    );
    reversal.idempotencyScope = "system";
    reversal.idempotencyKey = `reversal:${original.id}`;

    this.post(
      reversal.id,
      original.currency,
      m.at,
      [...net]
        .filter(([, amount]) => amount !== 0n)
        .map(([accountId, amount]): PlanLeg => [accountId, amount > 0n ? "debit" : "credit", amount > 0n ? amount : -amount, `Reversal of ${original.reference}`]),
    );
    this.event(m, reversal, null, "completed", `Reverses ${original.reference}. ${reason}`);
    this.event(m, original, "completed", "reversed", `Reversed by ${reversal.reference}. ${reason}`);
    this.auditTransaction(m, "transaction.reversed", original, `Transaction ${original.reference} reversed by ${reversal.reference}.`, { reason, reversalId: reversal.id, reversalReference: reversal.reference });

    const owners = new Set([original.sourceAccountId, original.destinationAccountId].map((id) => (id ? this.account(id).ownerId : null)));
    for (const userId of owners) {
      this.notify(m, userId, "transaction", "Transaction reversed", `${original.description} (${formatMoney(original.amountMinor, original.currency)}) was reversed. Reason: ${reason}`, `/transactions/${original.id}`);
    }
  }

  freeze(m: Moment, accountId: string, reason: string): void {
    const account = this.account(accountId);
    account.status = "frozen";
    this.audit(m, { action: "account.frozen", entityType: "account", entityId: accountId, summary: `${account.name} frozen.`, metadata: { reason, previousStatus: "active" } });
    this.notify(m, account.ownerId, "account", "Account frozen", `${account.name} has been frozen and cannot send or receive funds. Contact support for details.`, `/accounts/${accountId}`);
  }

  suspend(m: Moment, userId: string, reason: string): void {
    const user = SEED_USERS.find((u) => u.id === userId)!;
    this.userStatus.set(userId, "suspended");
    this.audit(m, { action: "user.suspended", entityType: "user", entityId: userId, summary: `${user.name} suspended.`, metadata: { reason, email: user.email } });
  }

  login(m: Moment): void {
    this.lastLogin.set(m.actor.id, m.at);
    this.audit(m, { action: "auth.login", entityType: "user", entityId: m.actor.id, summary: `${m.actor.label} signed in.` });
  }
}

// --- the plan ---------------------------------------------------------------

type Step = { at: Date; run: () => void };

function buildPlan(now: Date): Planner {
  const plan = new Planner();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  /** Anything scheduled after this instant has not happened yet. */
  const horizon = now.getTime() - 5 * MINUTE;
  const daysAgo = (days: number, hour = 9, minute = 0) => new Date(today - days * DAY + hour * HOUR + minute * MINUTE);
  const ago = (ms: number) => new Date(now.getTime() - ms);

  const steps: Step[] = [];
  const schedule = (at: Date, run: () => void) => {
    if (at.getTime() <= horizon) steps.push({ at, run });
  };

  const activity = (key: string, at: Date, type: "card_payment" | "fee" | "interest" | "transfer_in", accountId: string, amountMinor: bigint, counterparty: string, description: string, category: Category) =>
    schedule(at, () => plan.activity({ key, at, actor: SYSTEM }, type, accountId, amountMinor, counterparty, description, category));

  type After =
    | { settleAfter: number }
    | { failAfter: number; reason: string }
    | { approveAfter: number; by: Person; note: string; settleAfter?: number }
    | { rejectAfter: number; by: Person; reason: string };

  const transfer = (
    key: string,
    at: Date,
    actor: Person,
    client: Client,
    sourceAccountId: string,
    to: { accountId: string } | { beneficiaryId: string },
    amountMinor: bigint,
    description: string,
    category: Category,
    then?: After,
  ) => {
    let tx: ReturnType<Planner["transfer"]> = null;
    schedule(at, () => {
      tx = plan.transfer({ key, at, actor, client }, sourceAccountId, to, amountMinor, description, category);
    });
    if (!then) return;
    const later = (ms: number, suffix: string, actor: Person, run: (m: Moment, tx: TransactionRow) => void) => {
      const when = new Date(at.getTime() + ms);
      schedule(when, () => {
        if (tx) run({ key: `${key}:${suffix}`, at: when, actor }, tx);
      });
    };
    if ("failAfter" in then) later(then.failAfter, "fail", SYSTEM, (m, t) => plan.fail(m, t, then.reason));
    else if ("rejectAfter" in then) later(then.rejectAfter, "reject", then.by, (m, t) => plan.reject(m, t, then.reason));
    else if ("approveAfter" in then) {
      later(then.approveAfter, "approve", then.by, (m, t) => plan.approve(m, t, then.note));
      if (then.settleAfter) later(then.settleAfter, "settle", SYSTEM, (m, t) => plan.settle(m, t));
    } else later(then.settleAfter, "settle", SYSTEM, (m, t) => plan.settle(m, t));
  };

  const office: Client = { ip: "203.0.113.24", userAgent: UA.chromeWindows };
  const phone: Client = { ip: "198.51.100.77", userAgent: UA.safariIphone };

  // Opening balances carried over from before the reporting window.
  const opening = daysAgo(HISTORY_DAYS, 8);
  const openings: [string, string, bigint][] = [
    ["operating", A.operating, 2_860_000n],
    ["tax", A.taxReserve, 1_850_000n],
    ["payroll", A.payroll, 1_750_000n],
    ["euro", A.euro, 620_000n],
    ["daniel-checking", A.danielChecking, 348_500n],
    ["daniel-savings", A.danielSavings, 1_420_000n],
    ["mateo", A.mateoBusiness, 2_340_000n],
    ["hannah", A.hannahGiro, 930_000n],
    ["lucas", A.lucasChecking, 124_000n],
  ];
  for (const [key, accountId, amount] of openings) {
    activity(`opening:${key}`, opening, "transfer_in", accountId, amount, "Balance brought forward", "Opening balance", "transfers");
  }

  const cardMerchants: [string, Category, number, number][] = [
    ["The Daily Grind Café", "meals", 850, 2400],
    ["Paper & Co. Supplies", "office", 4200, 18600],
    ["Metro Courier", "office", 1800, 4600],
    ["Signal Ads Platform", "marketing", 35000, 92000],
    ["Skyline Air", "travel", 28400, 64800],
    ["Corner Bistro", "meals", 3200, 9800],
    ["Lumen Stock Library", "software", 2900, 2900],
    ["Parkside Garage", "travel", 1400, 3800],
  ];

  for (let d = HISTORY_DAYS - 1; d >= 0; d--) {
    const date = new Date(today - d * DAY);
    const iso = date.toISOString().slice(0, 10);
    const dom = date.getUTCDate();
    const weekday = date.getUTCDay();
    const month = date.getUTCMonth();
    const jitter = (label: string) => hashInt(`${label}:${iso}`, 50);

    // ---- Elena: recurring obligations ----
    if (dom === 1) {
      transfer(`rent:${iso}`, daysAgo(d, 9, 5), P.elena, office, A.operating, { beneficiaryId: B.harborPoint }, 420_000n, "Studio rent", "rent", { settleAfter: 22 * HOUR });
      activity(`fee:${iso}`, daysAgo(d, 0, 10), "fee", A.operating, 1_500n, "Aldera", "Monthly account fee", "bank_fees");
      activity(`interest:${iso}`, daysAgo(d, 0, 12), "interest", A.taxReserve, amountBetween(`interest:${iso}`, 3_612, 4_388, 1), "Aldera", "Interest paid", "interest");
    }
    if (dom === 2) activity(`insurance:${iso}`, daysAgo(d, 6, 30), "card_payment", A.operating, 48_600n, "Harbor Insurance Group", "Business liability policy", "insurance");
    if (dom === 3) activity(`hosting:${iso}`, daysAgo(d, 4, 15), "card_payment", A.operating, amountBetween(`hosting:${iso}`, 58_000, 66_000, 10), "Cloudline Hosting", "Cloud infrastructure", "software");
    if (dom === 5) {
      transfer(`tax-sweep:${iso}`, daysAgo(d, 10, 20), P.elena, office, A.operating, { accountId: A.taxReserve }, 350_000n, "Monthly tax set-aside", "transfers");
      activity(`deskwise:${iso}`, daysAgo(d, 5, 2), "card_payment", A.operating, 24_900n, "Deskwise Software", "Team workspace subscription", "software");
    }
    if (dom === 6) activity(`nube:${iso}`, daysAgo(d, 7, 40), "card_payment", A.euro, 8_900n, "Nube Ibérica Hosting", "EU hosting", "software");
    if (dom === 7) activity(`internet:${iso}`, daysAgo(d, 3, 0), "card_payment", A.operating, 12_999n, "Brightwave Internet", "Fibre internet", "utilities");
    if (dom === 10) activity(`power:${iso}`, daysAgo(d, 8, 45), "card_payment", A.operating, amountBetween(`power:${iso}`, 17_800, 24_600, 1), "CityPower Utilities", "Electricity", "utilities");
    if (dom === 12) activity(`tipo:${iso}`, daysAgo(d, 13, 10), "card_payment", A.euro, amountBetween(`tipo:${iso}`, 32_000, 54_000, 50), "Estudio Tipográfico Sur", "Type licensing", "software");
    if (dom === 13) transfer(`payroll-topup:${iso}`, daysAgo(d, 15, 30), P.elena, office, A.operating, { accountId: A.payroll }, 1_720_000n, "Payroll funding", "transfers");
    if (dom === 14 || dom === 28) {
      transfer(`payroll:${iso}`, daysAgo(d, 9, 0), P.elena, office, A.payroll, { beneficiaryId: B.atlas }, amountBetween(`payroll:${iso}`, 842_000, 856_000, 500), `Payroll run · ${dom === 14 ? "mid-month" : "month-end"}`, "payroll", { settleAfter: 20 * HOUR });
    }
    if (dom === 18) activity(`stock:${iso}`, daysAgo(d, 2, 20), "card_payment", A.operating, 7_900n, "Pixel Stock Assets", "Asset library", "software");
    if (dom === 20) transfer(`tomas:${iso}`, daysAgo(d, 11, 15), P.elena, office, A.operating, { beneficiaryId: B.tomas }, amountBetween(`tomas:${iso}`, 240_000, 320_000, 5_000), "Frontend development · monthly invoice", "contractors", { settleAfter: 18 * HOUR });
    if (dom === 22) transfer(`lucia:${iso}`, daysAgo(d, 10, 40), P.elena, office, A.euro, { beneficiaryId: B.lucia }, amountBetween(`lucia:${iso}`, 115_000, 148_000, 2_500), "Illustration work", "contractors", { settleAfter: 27 * HOUR });
    if (dom === 24 && month % 2 === 0) transfer(`greenfield:${iso}`, daysAgo(d, 14, 5), P.elena, office, A.operating, { beneficiaryId: B.greenfield }, amountBetween(`greenfield:${iso}`, 128_000, 190_000, 1_000), "Print production", "marketing", { settleAfter: 21 * HOUR });
    if (dom === 25) transfer(`daniel:${iso}`, daysAgo(d, 16, 10), P.elena, phone, A.operating, { beneficiaryId: B.daniel }, 65_000n, "Strategy retainer", "contractors");

    // ---- Elena: client income ----
    if (dom === 4) activity(`halcyon:${iso}`, daysAgo(d, 13, jitter("h")), "transfer_in", A.operating, amountBetween(`halcyon:${iso}`, 1_240_000, 1_680_000, 5_000), "Halcyon Retail Group", "Invoice payment · brand retainer", "client_payments");
    if (dom === 9) activity(`lumiere:${iso}`, daysAgo(d, 10, jitter("l")), "transfer_in", A.euro, amountBetween(`lumiere:${iso}`, 280_000, 360_000, 5_000), "Lumière Hôtels SAS", "Invoice payment · campaign design", "client_payments");
    if (dom === 11) activity(`brightline:${iso}`, daysAgo(d, 15, jitter("b")), "transfer_in", A.operating, amountBetween(`brightline:${iso}`, 720_000, 960_000, 5_000), "Brightline Media", "Invoice payment · editorial design", "client_payments");
    if (dom === 17) activity(`orchard:${iso}`, daysAgo(d, 11, jitter("o")), "transfer_in", A.operating, amountBetween(`orchard:${iso}`, 540_000, 790_000, 5_000), "Orchard & Vine Hospitality", "Invoice payment · menu system", "client_payments");
    if (dom === 19 && month % 2 === 1) activity(`costaverde:${iso}`, daysAgo(d, 9, jitter("c")), "transfer_in", A.euro, amountBetween(`costaverde:${iso}`, 140_000, 210_000, 5_000), "Costa Verde Turismo S.L.", "Invoice payment · signage", "client_payments");
    if (dom === 23) activity(`summit:${iso}`, daysAgo(d, 14, jitter("s")), "transfer_in", A.operating, amountBetween(`summit:${iso}`, 980_000, 1_450_000, 5_000), "Summit Health Partners", "Invoice payment · patient app", "client_payments");
    if (dom === 27 && month % 3 !== 0) activity(`kite:${iso}`, daysAgo(d, 12, jitter("k")), "transfer_in", A.operating, amountBetween(`kite:${iso}`, 320_000, 480_000, 5_000), "Kite Mobility", "Invoice payment · icon set", "client_payments");

    // ---- Elena: day-to-day card spend ----
    if (weekday !== 0 && hashInt(`misc:${iso}`, 100) < 34) {
      const [merchant, category, min, max] = cardMerchants[hashInt(`merchant:${iso}`, cardMerchants.length)];
      activity(`card:${iso}`, daysAgo(d, 12 + hashInt(`hour:${iso}`, 8), jitter("m")), "card_payment", A.operating, amountBetween(`card:${iso}`, min, max, 5), merchant, "Card purchase", category);
    }

    // ---- Other customers ----
    if (d <= 75) {
      if (dom === 1) activity(`daniel-income:${iso}`, daysAgo(d, 7, 30), "transfer_in", A.danielChecking, 520_000n, "Northfield Advisory", "Consulting fees", "client_payments");
      if (dom % 6 === 2) activity(`daniel-card:${iso}`, daysAgo(d, 18, jitter("dc")), "card_payment", A.danielChecking, amountBetween(`daniel-card:${iso}`, 2_400, 16_800, 5), dom % 12 === 2 ? "Fresh Market" : "Metro Transit", "Card purchase", dom % 12 === 2 ? "meals" : "travel");
      if (dom === 15) activity(`mateo-income:${iso}`, daysAgo(d, 10, 0), "transfer_in", A.mateoBusiness, amountBetween(`mateo-income:${iso}`, 610_000, 880_000, 5_000), "Bahía Trading Corp", "Shipment settlement", "client_payments");
      if (dom % 9 === 4) activity(`mateo-card:${iso}`, daysAgo(d, 16, jitter("mc")), "card_payment", A.mateoBusiness, amountBetween(`mateo-card:${iso}`, 6_400, 42_000, 5), "Portside Freight Services", "Card purchase", "office");
      if (dom === 8) activity(`hannah-income:${iso}`, daysAgo(d, 9, 20), "transfer_in", A.hannahGiro, amountBetween(`hannah-income:${iso}`, 310_000, 460_000, 5_000), "Stadtwerke Bauprojekt", "Honorar · Entwurfsphase", "client_payments");
    }
  }

  // ---- Elena: one-off events that give the demo its texture ----
  transfer("estimated-tax", daysAgo(74, 10, 0), P.elena, office, A.taxReserve, { beneficiaryId: B.revenue }, 890_000n, "Quarterly estimated tax payment", "taxes", { settleAfter: 26 * HOUR });
  transfer("greenfield-approved", daysAgo(33, 11, 30), P.elena, office, A.operating, { beneficiaryId: B.greenfield }, 1_420_000n, "Trade show booth · final balance", "marketing", { approveAfter: 3 * HOUR, by: P.marcus, note: "Verified against signed purchase order PO-2291.", settleAfter: 25 * HOUR });
  transfer("payroll-duplicate", daysAgo(19, 15, 45), P.elena, phone, A.operating, { beneficiaryId: B.atlas }, 1_800_000n, "Payroll funding · special run", "payroll", { rejectAfter: 2 * HOUR, by: P.camila, reason: "Duplicate of an instruction already settled this cycle. Confirmed with the customer by phone." });

  let duplicateCharge: TransactionRow | null = null;
  const chargedAt = daysAgo(9, 4, 16);
  schedule(chargedAt, () => {
    duplicateCharge = plan.activity({ key: "hosting-duplicate", at: chargedAt, actor: SYSTEM }, "card_payment", A.operating, 61_240n, "Cloudline Hosting", "Cloud infrastructure", "software");
  });
  const reversedAt = daysAgo(8, 13, 20);
  schedule(reversedAt, () => {
    if (duplicateCharge) plan.reverse({ key: "hosting-duplicate:reverse", at: reversedAt, actor: P.priya }, duplicateCharge, "Duplicate charge confirmed by the merchant.");
  });

  transfer("northgate-returned", daysAgo(6, 10, 10), P.elena, office, A.operating, { beneficiaryId: B.northgate }, 184_000n, "Freight · exhibition materials", "office", { failAfter: 19 * HOUR, reason: "Returned by the receiving bank: beneficiary account closed (R02)." });
  transfer("greenfield-pending", ago(21 * HOUR), P.elena, office, A.operating, { beneficiaryId: B.greenfield }, 1_250_000n, "Trade show booth · 50% deposit", "marketing");
  transfer("tomas-processing", ago(2 * HOUR + 10 * MINUTE), P.elena, office, A.operating, { beneficiaryId: B.tomas }, 295_000n, "Invoice 2026-041 · frontend sprint", "contractors");
  transfer("lucia-processing", ago(42 * MINUTE), P.elena, phone, A.euro, { beneficiaryId: B.lucia }, 132_000n, "Packaging illustrations", "contractors");
  activity("halcyon-recent", ago(5 * HOUR), "transfer_in", A.operating, 1_425_000n, "Halcyon Retail Group", "Invoice payment · autumn campaign", "client_payments");

  // ---- Other customers: items for the operations queue ----
  transfer("daniel-pending", ago(1 * DAY + 3 * HOUR), P.daniel, { ip: "198.51.100.14", userAgent: UA.safariMac }, A.danielSavings, { beneficiaryId: B.coastal }, 1_100_000n, "Vehicle purchase deposit", "other");
  transfer("mateo-processing", ago(3 * HOUR + 25 * MINUTE), P.mateo, { ip: "203.0.113.90", userAgent: UA.chromeWindows }, A.mateoBusiness, { beneficiaryId: B.andes }, 430_000n, "Container deposit · order 7714", "other");
  transfer("mateo-settled", daysAgo(12, 14, 0), P.mateo, { ip: "203.0.113.90", userAgent: UA.chromeWindows }, A.mateoBusiness, { beneficiaryId: B.andes }, 268_000n, "Packaging supplies", "other", { settleAfter: 23 * HOUR });
  transfer("hannah-failed", daysAgo(8, 9, 30), P.hannah, { ip: "198.51.100.201", userAgent: UA.firefoxLinux }, A.hannahGiro, { beneficiaryId: B.werkraum }, 78_000n, "Modellbau · Wettbewerb", "other", { failAfter: 6 * HOUR, reason: "Rejected by the receiving bank: account details could not be validated." });

  const frozenAt = daysAgo(12, 16, 5);
  schedule(frozenAt, () => plan.freeze({ key: "lucas-freeze", at: frozenAt, actor: P.marcus }, A.lucasChecking, "Unusual sign-in pattern from multiple countries; pending identity verification."));
  const suspendedAt = daysAgo(12, 16, 40);
  schedule(suspendedAt, () => plan.suspend({ key: "lucas-suspend", at: suspendedAt, actor: P.priya }, U.lucas, "Identity verification outstanding. Escalated by operations."));

  // ---- Sign-in history ----
  const login = (key: string, at: Date, actor: Person, client: Client) => schedule(at, () => plan.login({ key, at, actor, client }));
  for (const d of [26, 19, 13, 9, 6, 4, 2, 1]) {
    login(`login:elena:${d}`, daysAgo(d, 8, 40 + (d % 7)), P.elena, d % 3 === 0 ? phone : office);
  }
  login("login:elena:today", ago(2 * HOUR + 30 * MINUTE), P.elena, office);
  for (const d of [12, 8, 5, 2, 1]) {
    login(`login:marcus:${d}`, daysAgo(d, 7, 55), P.marcus, { ip: "192.0.2.10", userAgent: UA.chromeWindows });
    login(`login:priya:${d}`, daysAgo(d, 8, 15), P.priya, { ip: "192.0.2.11", userAgent: UA.safariMac });
  }
  login("login:camila:19", daysAgo(19, 15, 0), P.camila, { ip: "192.0.2.12", userAgent: UA.firefoxLinux });
  login("login:daniel:1", ago(1 * DAY + 3 * HOUR + 10 * MINUTE), P.daniel, { ip: "198.51.100.14", userAgent: UA.safariMac });

  const failedAt = daysAgo(3, 2, 14);
  schedule(failedAt, () => {
    const m: Moment = { key: "login-failed:elena", at: failedAt, actor: { id: "", label: "elena@aldera.example", role: "system" }, client: { ip: "192.0.2.146", userAgent: UA.firefoxLinux } };
    plan.audit(m, { action: "auth.login_failed", entityType: "user", entityId: U.elena, summary: "Failed sign-in attempt for elena@aldera.example.", metadata: { reason: "wrong_password" } });
    plan.notify(m, U.elena, "security", "Sign-in attempt blocked", "We blocked a sign-in attempt with an incorrect password from an unrecognised device. If this was not you, change your password.", "/settings?tab=security");
  });
  const profileAt = daysAgo(16, 9, 12);
  schedule(profileAt, () => plan.audit({ key: "profile:elena", at: profileAt, actor: P.elena, client: office }, { action: "profile.updated", entityType: "user", entityId: U.elena, summary: "Profile updated (phone).", metadata: { fields: ["phone"] } }));

  // ---- Standalone notices ----
  const notice = (key: string, at: Date, kind: "security" | "account" | "system", title: string, body: string, href: string) =>
    schedule(at, () => plan.notify({ key, at, actor: SYSTEM }, U.elena, kind, title, body, href));
  notice("two-factor", daysAgo(2, 9, 0), "security", "Add a second layer of protection", "Two-step verification is not enabled for your profile. Turn it on in security settings.", "/settings?tab=security");
  notice("statement", daysAgo(Math.max(1, new Date(today).getUTCDate() - 1), 6, 0), "account", "Your monthly statement is ready", "The statement for last month is available for all four accounts.", "/accounts");
  notice("maintenance", daysAgo(11, 5, 30), "system", "Scheduled maintenance completed", "Payment processing was upgraded overnight with no downtime. No action is needed.", "/notifications");

  // Replay in chronological order; ties keep their scheduling order.
  steps
    .map((step, index) => ({ step, index }))
    .sort((a, b) => a.step.at.getTime() - b.step.at.getTime() || a.index - b.index)
    .forEach(({ step }) => step.run());

  return plan;
}

// --- load -------------------------------------------------------------------

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function seedDatabase(
  db: DbOrTx,
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysAgo = (days: number, hour: number) => new Date(today - days * DAY + hour * HOUR);

  const [plan, passwordHashes] = await Promise.all([
    Promise.resolve().then(() => buildPlan(now)),
    Promise.all(SEED_USERS.map(() => hashPassword(DEMO_PASSWORD))),
  ]);

  await db.insert(users).values(
    SEED_USERS.map((user, index) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      passwordHash: passwordHashes[index],
      role: user.role,
      status: plan.userStatus.get(user.id) ?? ("active" as const),
      company: user.company ?? null,
      phone: user.phone ?? null,
      twoFactorEnabled: user.twoFactorEnabled ?? false,
      createdAt: daysAgo(user.joinedDaysAgo, 10),
      updatedAt: daysAgo(user.joinedDaysAgo, 10),
      lastLoginAt: plan.lastLogin.get(user.id) ?? null,
    })),
  );

  await db.insert(accounts).values(
    SEED_ACCOUNTS.map((account) => {
      const state = plan.accounts.get(account.id)!;
      return {
        id: account.id,
        ownerId: account.ownerId,
        kind: "customer" as const,
        type: account.type,
        name: account.name,
        number: account.number,
        currency: account.currency,
        status: state.status,
        postedMinor: state.posted,
        heldMinor: state.held,
        createdAt: daysAgo(account.openedDaysAgo, 11),
      };
    }),
  );

  // The bank-side accounts already exist; bring their balances in line.
  const systemBalances = [...plan.accounts.values()].filter((a) => a.ownerId === null);
  await db.execute(sql`
    UPDATE accounts AS a
       SET posted_minor = v.posted::bigint
      FROM (VALUES ${sql.join(
        systemBalances.map((a) => sql`(${a.id}, ${a.posted.toString()})`),
        sql`, `,
      )}) AS v(id, posted)
     WHERE a.id = v.id
  `);

  await db.insert(beneficiaries).values(
    SEED_BENEFICIARIES.map((b) => ({
      id: b.id,
      ownerId: b.ownerId,
      kind: b.kind,
      name: b.name,
      nickname: b.nickname ?? null,
      email: b.email ?? null,
      bankName: b.bankName,
      accountNumber: b.accountNumber,
      routingCode: b.routingCode ?? null,
      country: b.country,
      currency: b.currency,
      internalAccountId: b.internalAccountId ?? null,
      createdAt: daysAgo(b.addedDaysAgo, 14),
      lastUsedAt: plan.beneficiaryLastUsed.get(b.id) ?? null,
    })),
  );

  for (const rows of chunks(plan.transactions, 250)) await db.insert(transactions).values(rows);
  for (const rows of chunks(plan.entries, 500)) await db.insert(ledgerEntries).values(rows);
  for (const rows of chunks(plan.events, 500)) await db.insert(transactionEvents).values(rows);
  for (const rows of chunks(plan.audits, 250)) await db.insert(auditLogs).values(rows);

  // Anything older than a few days has already been seen.
  const seenBefore = now.getTime() - 4 * DAY;
  const notificationRows = plan.notifications.map((n) => ({
    ...n,
    readAt: n.createdAt!.getTime() < seenBefore ? new Date(n.createdAt!.getTime() + 3 * HOUR) : null,
  }));
  for (const rows of chunks(notificationRows, 500)) await db.insert(notifications).values(rows);
}
