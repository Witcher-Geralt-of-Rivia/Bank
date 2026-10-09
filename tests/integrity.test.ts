import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { accounts, auditLogs, ledgerEntries, transactionEvents, transactions } from "@/db/schema";
import { recordAudit, verifyAuditChain } from "@/server/audit";
import { checkLedgerIntegrity } from "@/server/ledger/integrity";
import { postEntries } from "@/server/ledger/postings";
import { createTransfer } from "@/server/ledger/service";
import {
  balances,
  createAccount,
  createTestDatabase,
  createUser,
  key,
} from "./support/harness";

/**
 * These tests bypass the service layer on purpose. They prove that the
 * database itself refuses to hold an inconsistent ledger, whatever the
 * application code — or anyone with SQL access — tries to do.
 */

let db: Database;
let transactionId: string;
let accountA: string;
let accountB: string;

beforeAll(async () => {
  db = await createTestDatabase();
  const user = await createUser(db);
  accountA = await createAccount(db, user.id, { balanceMinor: 100_000n });
  accountB = await createAccount(db, user.id);
  const { transaction } = await createTransfer(db, user.ctx, {
    idempotencyKey: key(),
    sourceAccountId: accountA,
    destination: { kind: "account", accountId: accountB },
    amountMinor: 10_000n,
    description: "Baseline",
  });
  transactionId = transaction.id;
});

/** Drizzle wraps driver errors; the database's message is on the cause. */
async function databaseError(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return `${(error as Error).message} ${cause?.message ?? ""}`;
  }
  throw new Error("expected the database to reject the statement");
}

describe("double-entry is enforced by the database", () => {
  it("refuses to commit a one-sided entry", async () => {
    const message = await databaseError(() =>
      db.insert(ledgerEntries).values({ transactionId, accountId: accountA, direction: "credit", amountMinor: 5_000n, currency: "USD", balanceAfterMinor: 95_000n }),
    );
    expect(message).toMatch(/do not balance/);
  });

  it("refuses to commit legs that do not sum to zero", async () => {
    const message = await databaseError(() =>
      db.transaction(async (tx) => {
        await tx.insert(ledgerEntries).values([
          { transactionId, accountId: accountA, direction: "debit", amountMinor: 5_000n, currency: "USD", balanceAfterMinor: 85_000n },
          { transactionId, accountId: accountB, direction: "credit", amountMinor: 4_999n, currency: "USD", balanceAfterMinor: 14_999n },
        ]);
      }),
    );
    expect(message).toMatch(/do not balance/);
  });

  it("refuses unbalanced legs at the service boundary too", async () => {
    await expect(
      db.transaction((tx) =>
        postEntries(tx, {
          transactionId,
          currency: "USD",
          at: new Date(),
          legs: [
            { accountId: accountA, direction: "debit", amountMinor: 100n },
            { accountId: accountB, direction: "credit", amountMinor: 99n },
          ],
        }),
      ),
    ).rejects.toThrow(/unbalanced/i);
  });

  it("rejects zero and negative entry amounts", async () => {
    for (const amountMinor of [0n, -1n]) {
      const message = await databaseError(() =>
        db.insert(ledgerEntries).values({ transactionId, accountId: accountA, direction: "debit", amountMinor, currency: "USD", balanceAfterMinor: 0n }),
      );
      expect(message).toMatch(/check constraint|violates/i);
    }
  });
});

describe("history is append-only", () => {
  it("ledger entries cannot be updated or deleted", async () => {
    expect(await databaseError(() => db.update(ledgerEntries).set({ amountMinor: 1n }).where(eq(ledgerEntries.transactionId, transactionId)))).toMatch(/append-only/);
    expect(await databaseError(() => db.delete(ledgerEntries).where(eq(ledgerEntries.transactionId, transactionId)))).toMatch(/append-only/);
  });

  it("status events cannot be updated or deleted", async () => {
    expect(await databaseError(() => db.update(transactionEvents).set({ note: "rewritten" }).where(eq(transactionEvents.transactionId, transactionId)))).toMatch(/append-only/);
    expect(await databaseError(() => db.delete(transactionEvents).where(eq(transactionEvents.transactionId, transactionId)))).toMatch(/append-only/);
  });

  it("audit records cannot be updated or deleted", async () => {
    expect(await databaseError(() => db.update(auditLogs).set({ summary: "nothing happened" }))).toMatch(/append-only/);
    expect(await databaseError(() => db.delete(auditLogs))).toMatch(/append-only/);
  });

  it("a transaction's financial facts cannot be rewritten, and it cannot be deleted", async () => {
    expect(await databaseError(() => db.update(transactions).set({ amountMinor: 1n }).where(eq(transactions.id, transactionId)))).toMatch(/immutable/);
    expect(await databaseError(() => db.update(transactions).set({ sourceAccountId: accountB, destinationAccountId: accountA }).where(eq(transactions.id, transactionId)))).toMatch(/immutable/);
    expect(await databaseError(() => db.update(transactions).set({ idempotencyKey: "another-key" }).where(eq(transactions.id, transactionId)))).toMatch(/immutable/);
    expect(await databaseError(() => db.delete(transactions).where(eq(transactions.id, transactionId)))).toMatch(/cannot be deleted/);
  });
});

describe("balances are protected", () => {
  it("a customer account cannot be driven negative, even with direct SQL", async () => {
    const message = await databaseError(() => db.update(accounts).set({ postedMinor: -1n }).where(eq(accounts.id, accountB)));
    expect(message).toMatch(/accounts_no_overdraft/);
  });

  it("a hold cannot exceed the balance or go negative", async () => {
    expect(await databaseError(() => db.update(accounts).set({ heldMinor: 10_000_000n }).where(eq(accounts.id, accountA)))).toMatch(/accounts_no_overdraft/);
    expect(await databaseError(() => db.update(accounts).set({ heldMinor: -1n }).where(eq(accounts.id, accountA)))).toMatch(/check constraint/i);
  });

  it("an idempotency key can only ever be recorded once", async () => {
    const [existing] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
    const message = await databaseError(() =>
      db.insert(transactions).values({ ...existing, id: "txn_duplicate", reference: "TX-DUPLI-CATE0" }),
    );
    expect(message).toMatch(/transactions_idempotency_idx|duplicate key/);
  });

  it("the integrity report detects drift between a balance and its entries", async () => {
    expect((await checkLedgerIntegrity(db)).healthy).toBe(true);

    await db.update(accounts).set({ postedMinor: sql`${accounts.postedMinor} + 1` }).where(eq(accounts.id, accountB));
    const report = await checkLedgerIntegrity(db);
    expect(report.healthy).toBe(false);
    expect(report.driftedAccounts).toBe(1);

    await db.update(accounts).set({ postedMinor: sql`${accounts.postedMinor} - 1` }).where(eq(accounts.id, accountB));
    expect((await checkLedgerIntegrity(db)).healthy).toBe(true);
    expect((await balances(db, accountB)).posted).toBe(10_000n);
  });
});

describe("the audit log is tamper-evident", () => {
  it("links every record to the one before it", async () => {
    const user = await createUser(db, "admin", "Auditor");
    for (let i = 0; i < 5; i++) {
      await recordAudit(db, user.ctx, { action: "profile.updated", entityType: "user", entityId: user.id, summary: `Change ${i}`, metadata: { index: i, nested: { b: 2, a: 1 } } });
    }
    const verification = await verifyAuditChain(db);
    expect(verification.valid).toBe(true);
    expect(verification.checked).toBeGreaterThanOrEqual(5);
  });

  it("keeps the chain intact when records are written concurrently", async () => {
    const user = await createUser(db, "admin");
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        recordAudit(db, user.ctx, { action: "auth.login", entityType: "user", entityId: user.id, summary: `Concurrent ${i}` }),
      ),
    );
    expect((await verifyAuditChain(db)).valid).toBe(true);
  });

  it("an audit record rolls back together with the change it describes", async () => {
    const user = await createUser(db, "admin");
    const count = async () => (await db.select({ seq: auditLogs.seq }).from(auditLogs)).length;
    const before = await count();

    await expect(
      db.transaction(async (tx) => {
        await recordAudit(tx, user.ctx, { action: "user.suspended", entityType: "user", entityId: user.id, summary: "Should never be seen" });
        throw new Error("the surrounding change failed");
      }),
    ).rejects.toThrow("the surrounding change failed");

    expect(await count()).toBe(before);
  });

  it("detects a record altered behind the trigger's back", async () => {
    const records = await db.select().from(auditLogs);
    const target = records[Math.floor(records.length / 2)];

    // Only a database superuser could do this; the hash chain still exposes it.
    await db.execute(sql`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only`);
    await db.execute(sql`UPDATE audit_logs SET summary = 'Nothing to see here' WHERE seq = ${target.seq}`);
    await db.execute(sql`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only`);

    const verification = await verifyAuditChain(db);
    expect(verification.valid).toBe(false);
    expect(verification.brokenAtSeq).toBe(target.seq);
  });
});
