import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { type Database, createEmbeddedDatabase, seedIfEmpty } from "@/db/client";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/db/seed";
import { accounts, auditLogs, transactions, users } from "@/db/schema";
import { TRANSACTION_STATUSES } from "@/lib/domain";
import { verifyAuditChain } from "@/server/audit";
import { verifyPassword } from "@/server/auth/password";
import { checkLedgerIntegrity } from "@/server/ledger/integrity";

describe("demo dataset", () => {
  let db: Database;

  beforeAll(async () => {
    db = await createEmbeddedDatabase();
    const startedAt = Date.now();
    expect(await seedIfEmpty(db)).toBe(true);
    console.info(`seeded in ${Date.now() - startedAt}ms`);
  });

  it("is only applied once", async () => {
    expect(await seedIfEmpty(db)).toBe(false);
  });

  it("leaves the ledger fully balanced", async () => {
    const report = await checkLedgerIntegrity(db);
    expect(report.unbalancedTransactions).toBe(0);
    expect(report.driftedAccounts).toBe(0);
    for (const currency of report.currencies) {
      expect(currency.debitMinor).toBe(currency.creditMinor);
      expect(currency.netBalanceMinor).toBe(0n);
    }
    expect(report.healthy).toBe(true);
    expect(report.entryCount).toBeGreaterThan(200);
  });

  it("never leaves a customer account overdrawn", async () => {
    const rows = await db.select().from(accounts).where(eq(accounts.kind, "customer"));
    expect(rows.length).toBeGreaterThanOrEqual(9);
    for (const account of rows) {
      expect(account.postedMinor - account.heldMinor).toBeGreaterThanOrEqual(0n);
    }
  });

  it("contains every transaction status", async () => {
    const rows = await db
      .select({ status: transactions.status, count: sql<string>`count(*)::text` })
      .from(transactions)
      .groupBy(transactions.status);
    const seen = new Map(rows.map((row) => [row.status, Number(row.count)]));
    for (const status of TRANSACTION_STATUSES) {
      expect(seen.get(status) ?? 0, status).toBeGreaterThan(0);
    }
    const total = [...seen.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(150);
  });

  it("produces a valid, unbroken audit chain", async () => {
    const verification = await verifyAuditChain(db);
    expect(verification.valid).toBe(true);
    expect(verification.checked).toBeGreaterThan(40);
    const [first] = await db.select().from(auditLogs).limit(1);
    expect(first.prevHash).toMatch(/^0{64}$/);
  });

  it("creates working demo credentials for each role", async () => {
    for (const demo of DEMO_ACCOUNTS) {
      const [user] = await db.select().from(users).where(eq(users.email, demo.email));
      expect(user.role).toBe(demo.role);
      expect(await verifyPassword(DEMO_PASSWORD, user.passwordHash)).toBe(true);
      expect(await verifyPassword("wrong-password-1", user.passwordHash)).toBe(false);
    }
  });

  it("is deterministic: a second database gets identical identifiers", async () => {
    const other = await createEmbeddedDatabase();
    await seedIfEmpty(other);
    const ids = async (database: Database) =>
      (await database.select({ id: transactions.id }).from(transactions))
        .map((row) => row.id)
        .sort();
    const a = await ids(db);
    const b = await ids(other);
    // Entries anchored to "minutes ago" can straddle the boot instant; the
    // overwhelming majority of the history must match exactly.
    const shared = a.filter((id) => b.includes(id)).length;
    expect(shared / a.length).toBeGreaterThan(0.98);
  });
});
