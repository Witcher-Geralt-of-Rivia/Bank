import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { auditLogs, ledgerEntries, transactions } from "@/db/schema";
import { IdempotencyConflictError } from "@/lib/errors";
import { createTransfer, deposit, withdraw } from "@/server/ledger/service";
import {
  balances,
  createAccount,
  createExternalBeneficiary,
  createTestDatabase,
  createUser,
  key,
} from "./support/harness";

let db: Database;

beforeAll(async () => {
  db = await createTestDatabase();
});

describe("idempotent transfers", () => {
  it("returns the original transaction when a request is retried", async () => {
    const user = await createUser(db);
    const from = await createAccount(db, user.id, { balanceMinor: 100_000n });
    const to = await createAccount(db, user.id);
    const request = {
      idempotencyKey: key(),
      sourceAccountId: from,
      destination: { kind: "account" as const, accountId: to },
      amountMinor: 40_000n,
      description: "Retry me",
    };

    const first = await createTransfer(db, user.ctx, request);
    const second = await createTransfer(db, user.ctx, request);
    const third = await createTransfer(db, user.ctx, request);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(third.replayed).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(third.transaction.reference).toBe(first.transaction.reference);

    expect((await balances(db, from)).posted).toBe(60_000n);
    expect((await balances(db, to)).posted).toBe(40_000n);
    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.transactionId, first.transaction.id));
    expect(entries).toHaveLength(2);
  });

  it("processes a double-submitted request exactly once", async () => {
    const user = await createUser(db);
    const from = await createAccount(db, user.id, { balanceMinor: 100_000n });
    const to = await createAccount(db, user.id);
    const request = {
      idempotencyKey: key(),
      sourceAccountId: from,
      destination: { kind: "account" as const, accountId: to },
      amountMinor: 30_000n,
      description: "Double click",
    };

    const results = await Promise.all(Array.from({ length: 6 }, () => createTransfer(db, user.ctx, request)));

    expect(new Set(results.map((r) => r.transaction.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect((await balances(db, from)).posted).toBe(70_000n);
    expect((await balances(db, to)).posted).toBe(30_000n);

    const recorded = await db.select().from(transactions).where(eq(transactions.idempotencyKey, request.idempotencyKey));
    expect(recorded).toHaveLength(1);
  });

  it("writes a single audit record no matter how often the request is replayed", async () => {
    const user = await createUser(db);
    const from = await createAccount(db, user.id, { balanceMinor: 100_000n });
    const to = await createAccount(db, user.id);
    const request = { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "account" as const, accountId: to }, amountMinor: 1_000n, description: "Audited once" };

    const { transaction } = await createTransfer(db, user.ctx, request);
    await createTransfer(db, user.ctx, request);
    await createTransfer(db, user.ctx, request);

    const records = await db.select().from(auditLogs).where(eq(auditLogs.entityId, transaction.id));
    expect(records.filter((r) => r.action === "transfer.created")).toHaveLength(1);
  });

  it("replays the original result even if the balance has since changed", async () => {
    const user = await createUser(db);
    const from = await createAccount(db, user.id, { balanceMinor: 50_000n });
    const to = await createAccount(db, user.id);
    const request = { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "account" as const, accountId: to }, amountMinor: 50_000n, description: "All of it" };

    const first = await createTransfer(db, user.ctx, request);
    expect((await balances(db, from)).posted).toBe(0n);

    // A fresh request for the same amount would now fail; the retry must not.
    const retry = await createTransfer(db, user.ctx, request);
    expect(retry.replayed).toBe(true);
    expect(retry.transaction.id).toBe(first.transaction.id);
    expect((await balances(db, to)).posted).toBe(50_000n);
  });

  it("rejects the same key reused for a different request", async () => {
    const user = await createUser(db);
    const from = await createAccount(db, user.id, { balanceMinor: 100_000n });
    const to = await createAccount(db, user.id);
    const other = await createAccount(db, user.id);
    const idempotencyKey = key();
    const base = { idempotencyKey, sourceAccountId: from, destination: { kind: "account" as const, accountId: to }, amountMinor: 10_000n, description: "Original" };

    await createTransfer(db, user.ctx, base);

    await expect(createTransfer(db, user.ctx, { ...base, amountMinor: 10_001n })).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(createTransfer(db, user.ctx, { ...base, destination: { kind: "account", accountId: other } })).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(createTransfer(db, user.ctx, { ...base, description: "Edited" })).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(deposit(db, user.ctx, { idempotencyKey, accountId: from, amountMinor: 10_000n, description: "Original" })).rejects.toBeInstanceOf(IdempotencyConflictError);

    expect((await balances(db, from)).posted).toBe(90_000n);
    expect((await balances(db, other)).posted).toBe(0n);
  });

  it("scopes keys to the user: two users may use the same key", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const aliceFrom = await createAccount(db, alice.id, { balanceMinor: 10_000n });
    const aliceTo = await createAccount(db, alice.id);
    const bobFrom = await createAccount(db, bob.id, { balanceMinor: 10_000n });
    const bobTo = await createAccount(db, bob.id);
    const shared = key("shared");

    const a = await createTransfer(db, alice.ctx, { idempotencyKey: shared, sourceAccountId: aliceFrom, destination: { kind: "account", accountId: aliceTo }, amountMinor: 1_000n, description: "Alice" });
    const b = await createTransfer(db, bob.ctx, { idempotencyKey: shared, sourceAccountId: bobFrom, destination: { kind: "account", accountId: bobTo }, amountMinor: 2_000n, description: "Bob" });

    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(false);
    expect(a.transaction.id).not.toBe(b.transaction.id);
    expect((await balances(db, aliceTo)).posted).toBe(1_000n);
    expect((await balances(db, bobTo)).posted).toBe(2_000n);
  });

  it("holds funds once for a retried transfer that needs review", async () => {
    const user = await createUser(db);
    const from = await createAccount(db, user.id, { balanceMinor: 5_000_000n });
    const beneficiary = await createExternalBeneficiary(db, user.id);
    const request = { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "beneficiary" as const, beneficiaryId: beneficiary }, amountMinor: 1_500_000n, description: "Large" };

    await Promise.all([createTransfer(db, user.ctx, request), createTransfer(db, user.ctx, request)]);
    await createTransfer(db, user.ctx, request);

    expect((await balances(db, from)).held).toBe(1_500_000n);
  });
});

describe("idempotent deposits and withdrawals", () => {
  it("applies a retried deposit and withdrawal once", async () => {
    const user = await createUser(db);
    const account = await createAccount(db, user.id);

    const depositRequest = { idempotencyKey: key(), accountId: account, amountMinor: 20_000n, description: "Top up" };
    const d1 = await deposit(db, user.ctx, depositRequest);
    const d2 = await deposit(db, user.ctx, depositRequest);
    expect(d2.replayed).toBe(true);
    expect(d2.transaction.id).toBe(d1.transaction.id);
    expect((await balances(db, account)).posted).toBe(20_000n);

    const withdrawRequest = { idempotencyKey: key(), accountId: account, amountMinor: 5_000n, description: "Cash" };
    await Promise.all([withdraw(db, user.ctx, withdrawRequest), withdraw(db, user.ctx, withdrawRequest)]);
    expect((await balances(db, account)).posted).toBe(15_000n);
  });
});
