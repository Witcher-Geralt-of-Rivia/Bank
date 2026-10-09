import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { ledgerEntries, notifications, transactionEvents, transactions } from "@/db/schema";
import { TRANSFER_POLICY } from "@/lib/domain";
import {
  AccountUnavailableError,
  CurrencyMismatchError,
  InsufficientFundsError,
  InvalidStateError,
  LimitExceededError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { setAccountStatus } from "@/server/admin/service";
import { checkLedgerIntegrity } from "@/server/ledger/integrity";
import { systemAccountId } from "@/server/ledger/postings";
import {
  approveTransfer,
  createTransfer,
  deposit,
  failTransfer,
  rejectTransfer,
  reverseTransaction,
  settleTransfer,
  withdraw,
} from "@/server/ledger/service";
import {
  balances,
  createAccount,
  createExternalBeneficiary,
  createInternalBeneficiary,
  createTestDatabase,
  createUser,
  key,
} from "./support/harness";

let db: Database;

beforeAll(async () => {
  db = await createTestDatabase();
});

async function entriesOf(transactionId: string) {
  return db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.transactionId, transactionId))
    .orderBy(asc(ledgerEntries.seq));
}

function expectBalanced(entries: Awaited<ReturnType<typeof entriesOf>>) {
  const debits = entries.filter((e) => e.direction === "debit").reduce((s, e) => s + e.amountMinor, 0n);
  const credits = entries.filter((e) => e.direction === "credit").reduce((s, e) => s + e.amountMinor, 0n);
  expect(debits).toBe(credits);
}

describe("transfers between accounts on the platform", () => {
  it("debits the source and credits the destination atomically", async () => {
    const user = await createUser(db);
    const from = await createAccount(db, user.id, { balanceMinor: 100_000n });
    const to = await createAccount(db, user.id);

    const { transaction, replayed } = await createTransfer(db, user.ctx, {
      idempotencyKey: key(),
      sourceAccountId: from,
      destination: { kind: "account", accountId: to },
      amountMinor: 25_050n,
      description: "Move to savings",
    });

    expect(replayed).toBe(false);
    expect(transaction.status).toBe("completed");
    expect(transaction.type).toBe("transfer_internal");
    expect(transaction.completedAt).not.toBeNull();
    expect((await balances(db, from)).posted).toBe(74_950n);
    expect((await balances(db, to)).posted).toBe(25_050n);

    const entries = await entriesOf(transaction.id);
    expect(entries).toHaveLength(2);
    expectBalanced(entries);
    expect(entries.find((e) => e.accountId === from)).toMatchObject({ direction: "debit", amountMinor: 25_050n, balanceAfterMinor: 74_950n });
    expect(entries.find((e) => e.accountId === to)).toMatchObject({ direction: "credit", amountMinor: 25_050n, balanceAfterMinor: 25_050n });
  });

  it("settles instantly to another customer and notifies them", async () => {
    const sender = await createUser(db, "customer", "Sender");
    const receiver = await createUser(db);
    const from = await createAccount(db, sender.id, { balanceMinor: 50_000n });
    const theirs = await createAccount(db, receiver.id);
    const beneficiary = await createInternalBeneficiary(db, sender.id, theirs);

    const { transaction } = await createTransfer(db, sender.ctx, {
      idempotencyKey: key(),
      sourceAccountId: from,
      destination: { kind: "beneficiary", beneficiaryId: beneficiary },
      amountMinor: 12_000n,
      description: "Invoice 17",
    });

    expect(transaction.status).toBe("completed");
    expect(transaction.destinationAccountId).toBe(theirs);
    expect((await balances(db, theirs)).posted).toBe(12_000n);
    const inbox = await db.select().from(notifications).where(eq(notifications.userId, receiver.id));
    expect(inbox.map((n) => n.title)).toContain("Pago recibido");
  });

  it("allows the exact available balance and not one cent more", async () => {
    const user = await createUser(db);
    const from = await createAccount(db, user.id, { balanceMinor: 10_000n });
    const to = await createAccount(db, user.id);
    const send = (amountMinor: bigint) =>
      createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "account", accountId: to }, amountMinor, description: "Test" });

    await expect(send(10_001n)).rejects.toBeInstanceOf(InsufficientFundsError);
    expect((await balances(db, from)).posted).toBe(10_000n);

    await send(10_000n);
    expect((await balances(db, from)).posted).toBe(0n);
    await expect(send(1n)).rejects.toBeInstanceOf(InsufficientFundsError);
  });

  it("leaves nothing behind when a transfer is refused", async () => {
    const user = await createUser(db);
    const from = await createAccount(db, user.id, { balanceMinor: 500n });
    const to = await createAccount(db, user.id);
    const idempotencyKey = key();

    await expect(
      createTransfer(db, user.ctx, { idempotencyKey, sourceAccountId: from, destination: { kind: "account", accountId: to }, amountMinor: 900n, description: "Too much" }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    const recorded = await db.select().from(transactions).where(eq(transactions.idempotencyKey, idempotencyKey));
    expect(recorded).toHaveLength(0);
    expect((await balances(db, to)).posted).toBe(0n);
  });

  it("never loses or creates money under concurrent transfers", async () => {
    const user = await createUser(db);
    const a = await createAccount(db, user.id, { balanceMinor: 100_000n });
    const b = await createAccount(db, user.id, { balanceMinor: 100_000n });

    const moves = Array.from({ length: 40 }, (_, i) =>
      createTransfer(db, user.ctx, {
        idempotencyKey: key("concurrent"),
        sourceAccountId: i % 2 === 0 ? a : b,
        destination: { kind: "account", accountId: i % 2 === 0 ? b : a },
        amountMinor: BigInt(100 + i * 37),
        description: `Move ${i}`,
      }),
    );
    const results = await Promise.all(moves);
    expect(results.every((r) => r.transaction.status === "completed")).toBe(true);

    const total = (await balances(db, a)).posted + (await balances(db, b)).posted;
    expect(total).toBe(200_000n);
  });

  it("refuses to overdraw when concurrent requests race for the same funds", async () => {
    const user = await createUser(db);
    const from = await createAccount(db, user.id, { balanceMinor: 10_000n });
    const to = await createAccount(db, user.id);

    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        createTransfer(db, user.ctx, { idempotencyKey: key("race"), sourceAccountId: from, destination: { kind: "account", accountId: to }, amountMinor: 4_000n, description: "Race" }),
      ),
    );

    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(2);
    for (const attempt of attempts.filter((a) => a.status === "rejected")) {
      expect((attempt as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientFundsError);
    }
    expect((await balances(db, from)).posted).toBe(2_000n);
    expect((await balances(db, to)).posted).toBe(8_000n);
  });
});

describe("transfer validation", () => {
  it("rejects zero and negative amounts", async () => {
    const user = await createUser(db);
    const from = await createAccount(db, user.id, { balanceMinor: 10_000n });
    const to = await createAccount(db, user.id);
    for (const amountMinor of [0n, -100n]) {
      await expect(
        createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "account", accountId: to }, amountMinor, description: "Bad" }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("rejects amounts above the per-transfer limit", async () => {
    const user = await createUser(db);
    const from = await createAccount(db, user.id, { balanceMinor: TRANSFER_POLICY.maxAmountMinor * 2n });
    const to = await createAccount(db, user.id);
    await expect(
      createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "account", accountId: to }, amountMinor: TRANSFER_POLICY.maxAmountMinor + 1n, description: "Huge" }),
    ).rejects.toBeInstanceOf(LimitExceededError);
  });

  it("rejects a transfer to the same account", async () => {
    const user = await createUser(db);
    const from = await createAccount(db, user.id, { balanceMinor: 10_000n });
    await expect(
      createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "account", accountId: from }, amountMinor: 100n, description: "Loop" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a missing description and a malformed idempotency key", async () => {
    const user = await createUser(db);
    const from = await createAccount(db, user.id, { balanceMinor: 10_000n });
    const to = await createAccount(db, user.id);
    const base = { sourceAccountId: from, destination: { kind: "account" as const, accountId: to }, amountMinor: 100n };
    await expect(createTransfer(db, user.ctx, { ...base, idempotencyKey: key(), description: "   " })).rejects.toBeInstanceOf(ValidationError);
    await expect(createTransfer(db, user.ctx, { ...base, idempotencyKey: "short", description: "ok" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects transfers between different currencies", async () => {
    const user = await createUser(db);
    const usd = await createAccount(db, user.id, { balanceMinor: 10_000n });
    const eur = await createAccount(db, user.id, { currency: "EUR" });
    const eurBeneficiary = await createExternalBeneficiary(db, user.id, "EUR");

    await expect(
      createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: usd, destination: { kind: "account", accountId: eur }, amountMinor: 100n, description: "FX" }),
    ).rejects.toBeInstanceOf(CurrencyMismatchError);
    await expect(
      createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: usd, destination: { kind: "beneficiary", beneficiaryId: eurBeneficiary }, amountMinor: 100n, description: "FX" }),
    ).rejects.toBeInstanceOf(CurrencyMismatchError);
  });

  it("blocks movements out of and into a frozen account", async () => {
    const user = await createUser(db);
    const operator = await createUser(db, "operator");
    const frozen = await createAccount(db, user.id, { balanceMinor: 10_000n });
    const other = await createAccount(db, user.id, { balanceMinor: 10_000n });
    await setAccountStatus(db, operator.ctx, frozen, "frozen", "Verification pending");

    await expect(
      createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: frozen, destination: { kind: "account", accountId: other }, amountMinor: 100n, description: "Out" }),
    ).rejects.toBeInstanceOf(AccountUnavailableError);
    await expect(
      createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: other, destination: { kind: "account", accountId: frozen }, amountMinor: 100n, description: "In" }),
    ).rejects.toBeInstanceOf(AccountUnavailableError);
    await expect(withdraw(db, user.ctx, { idempotencyKey: key(), accountId: frozen, amountMinor: 100n, description: "Cash" })).rejects.toBeInstanceOf(AccountUnavailableError);
    expect((await balances(db, frozen)).posted).toBe(10_000n);
  });
});

describe("external transfers", () => {
  it("moves funds into transit, then settles them out to clearing", async () => {
    const user = await createUser(db);
    const operator = await createUser(db, "operator");
    const from = await createAccount(db, user.id, { balanceMinor: 80_000n });
    const beneficiary = await createExternalBeneficiary(db, user.id);
    const transit = systemAccountId("transit", "USD");
    const transitBefore = (await balances(db, transit)).posted;

    const { transaction } = await createTransfer(db, user.ctx, {
      idempotencyKey: key(),
      sourceAccountId: from,
      destination: { kind: "beneficiary", beneficiaryId: beneficiary },
      amountMinor: 30_000n,
      description: "Supplier invoice",
    });

    expect(transaction.status).toBe("processing");
    expect(transaction.type).toBe("transfer_out");
    expect(transaction.destinationAccountId).toBeNull();
    expect((await balances(db, from)).posted).toBe(50_000n);
    expect((await balances(db, transit)).posted).toBe(transitBefore + 30_000n);

    const settled = await settleTransfer(db, operator.ctx, transaction.id);
    expect(settled.status).toBe("completed");
    expect(settled.completedAt).not.toBeNull();
    expect((await balances(db, transit)).posted).toBe(transitBefore);

    const entries = await entriesOf(transaction.id);
    expect(entries).toHaveLength(4);
    expectBalanced(entries);
  });

  it("returns the funds when an in-transit transfer fails", async () => {
    const user = await createUser(db);
    const operator = await createUser(db, "operator");
    const from = await createAccount(db, user.id, { balanceMinor: 80_000n });
    const beneficiary = await createExternalBeneficiary(db, user.id);

    const { transaction } = await createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "beneficiary", beneficiaryId: beneficiary }, amountMinor: 30_000n, description: "Supplier invoice" });
    const failed = await failTransfer(db, operator.ctx, transaction.id, "Account closed");

    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toBe("Account closed");
    expect((await balances(db, from)).posted).toBe(80_000n);
    expectBalanced(await entriesOf(transaction.id));
  });

  it("holds funds for review at the policy threshold without moving them", async () => {
    const user = await createUser(db);
    const from = await createAccount(db, user.id, { balanceMinor: 3_000_000n });
    const beneficiary = await createExternalBeneficiary(db, user.id);

    const below = await createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "beneficiary", beneficiaryId: beneficiary }, amountMinor: TRANSFER_POLICY.reviewThresholdMinor - 1n, description: "Just under" });
    expect(below.transaction.status).toBe("processing");

    const at = await createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "beneficiary", beneficiaryId: beneficiary }, amountMinor: TRANSFER_POLICY.reviewThresholdMinor, description: "At threshold" });
    expect(at.transaction.status).toBe("pending");
    expect(await entriesOf(at.transaction.id)).toHaveLength(0);

    const state = await balances(db, from);
    expect(state.held).toBe(TRANSFER_POLICY.reviewThresholdMinor);
    expect(state.posted).toBe(3_000_000n - (TRANSFER_POLICY.reviewThresholdMinor - 1n));
    expect(state.available).toBe(state.posted - TRANSFER_POLICY.reviewThresholdMinor);
  });

  it("does not let held funds be spent twice", async () => {
    const user = await createUser(db);
    const from = await createAccount(db, user.id, { balanceMinor: 1_500_000n });
    const other = await createAccount(db, user.id);
    const beneficiary = await createExternalBeneficiary(db, user.id);

    await createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "beneficiary", beneficiaryId: beneficiary }, amountMinor: 1_200_000n, description: "Held" });

    await expect(
      createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "account", accountId: other }, amountMinor: 400_000n, description: "Too much" }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
    await createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "account", accountId: other }, amountMinor: 300_000n, description: "Fits" });
    expect((await balances(db, from)).available).toBe(0n);
  });

  it("approval converts the hold into a debit; rejection releases it", async () => {
    const user = await createUser(db);
    const operator = await createUser(db, "operator");
    const from = await createAccount(db, user.id, { balanceMinor: 5_000_000n });
    const beneficiary = await createExternalBeneficiary(db, user.id);
    const make = () => createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "beneficiary", beneficiaryId: beneficiary }, amountMinor: 2_000_000n, description: "Large payment" });

    const first = await make();
    const approved = await approveTransfer(db, operator.ctx, first.transaction.id, "Verified");
    expect(approved.status).toBe("processing");
    expect(await balances(db, from)).toMatchObject({ posted: 3_000_000n, held: 0n });

    const second = await make();
    expect((await balances(db, from)).held).toBe(2_000_000n);
    const rejected = await rejectTransfer(db, operator.ctx, second.transaction.id, "Could not verify");
    expect(rejected.status).toBe("failed");
    expect(await balances(db, from)).toMatchObject({ posted: 3_000_000n, held: 0n });
    expect(await entriesOf(second.transaction.id)).toHaveLength(0);
  });
});

describe("status lifecycle", () => {
  it("only permits forward transitions", async () => {
    const user = await createUser(db);
    const operator = await createUser(db, "operator");
    const from = await createAccount(db, user.id, { balanceMinor: 5_000_000n });
    const to = await createAccount(db, user.id);
    const beneficiary = await createExternalBeneficiary(db, user.id);

    const completed = await createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "account", accountId: to }, amountMinor: 100n, description: "Done" });
    await expect(settleTransfer(db, operator.ctx, completed.transaction.id)).rejects.toBeInstanceOf(InvalidStateError);
    await expect(failTransfer(db, operator.ctx, completed.transaction.id, "x")).rejects.toBeInstanceOf(InvalidStateError);
    await expect(approveTransfer(db, operator.ctx, completed.transaction.id)).rejects.toBeInstanceOf(InvalidStateError);

    const processing = await createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "beneficiary", beneficiaryId: beneficiary }, amountMinor: 100n, description: "Out" });
    await expect(approveTransfer(db, operator.ctx, processing.transaction.id)).rejects.toBeInstanceOf(InvalidStateError);
    await expect(rejectTransfer(db, operator.ctx, processing.transaction.id, "x")).rejects.toBeInstanceOf(InvalidStateError);

    await settleTransfer(db, operator.ctx, processing.transaction.id);
    await expect(settleTransfer(db, operator.ctx, processing.transaction.id)).rejects.toBeInstanceOf(InvalidStateError);
    await expect(settleTransfer(db, operator.ctx, "txn_missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("settling twice concurrently only settles once", async () => {
    const user = await createUser(db);
    const operator = await createUser(db, "operator");
    const from = await createAccount(db, user.id, { balanceMinor: 50_000n });
    const beneficiary = await createExternalBeneficiary(db, user.id);
    const { transaction } = await createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "beneficiary", beneficiaryId: beneficiary }, amountMinor: 10_000n, description: "Out" });

    const results = await Promise.allSettled([
      settleTransfer(db, operator.ctx, transaction.id),
      settleTransfer(db, operator.ctx, transaction.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await entriesOf(transaction.id)).toHaveLength(4);
  });

  it("records every status change as an event", async () => {
    const user = await createUser(db);
    const operator = await createUser(db, "operator", "Olive Operator");
    const from = await createAccount(db, user.id, { balanceMinor: 5_000_000n });
    const beneficiary = await createExternalBeneficiary(db, user.id);
    const { transaction } = await createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "beneficiary", beneficiaryId: beneficiary }, amountMinor: 1_500_000n, description: "Reviewed" });
    await approveTransfer(db, operator.ctx, transaction.id, "Checked");
    await settleTransfer(db, operator.ctx, transaction.id);

    const events = await db.select().from(transactionEvents).where(eq(transactionEvents.transactionId, transaction.id)).orderBy(asc(transactionEvents.seq));
    expect(events.map((e) => [e.fromStatus, e.toStatus])).toEqual([
      [null, "pending"],
      ["pending", "processing"],
      ["processing", "completed"],
    ]);
    expect(events[1].actorLabel).toBe("Olive Operator");
    expect(events[1].note).toBe("Checked");
  });
});

describe("reversals", () => {
  it("posts a compensating transaction and keeps the original intact", async () => {
    const user = await createUser(db);
    const admin = await createUser(db, "admin");
    const from = await createAccount(db, user.id, { balanceMinor: 60_000n });
    const to = await createAccount(db, user.id);
    const { transaction } = await createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "account", accountId: to }, amountMinor: 15_000n, description: "Sent in error" });

    const { original, reversal } = await reverseTransaction(db, admin.ctx, transaction.id, "Customer request");

    expect(original.status).toBe("reversed");
    expect(original.amountMinor).toBe(15_000n);
    expect(reversal.type).toBe("reversal");
    expect(reversal.reversalOf).toBe(transaction.id);
    expect(reversal.sourceAccountId).toBe(to);
    expect(reversal.destinationAccountId).toBe(from);
    expect((await balances(db, from)).posted).toBe(60_000n);
    expect((await balances(db, to)).posted).toBe(0n);

    expect(await entriesOf(transaction.id)).toHaveLength(2);
    const inverse = await entriesOf(reversal.id);
    expect(inverse).toHaveLength(2);
    expectBalanced(inverse);
  });

  it("reverses a settled external transfer back to the sender", async () => {
    const user = await createUser(db);
    const operator = await createUser(db, "operator");
    const admin = await createUser(db, "admin");
    const from = await createAccount(db, user.id, { balanceMinor: 60_000n });
    const beneficiary = await createExternalBeneficiary(db, user.id);
    const { transaction } = await createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "beneficiary", beneficiaryId: beneficiary }, amountMinor: 20_000n, description: "Paid twice" });
    await settleTransfer(db, operator.ctx, transaction.id);

    await reverseTransaction(db, admin.ctx, transaction.id, "Duplicate payment recalled");
    expect((await balances(db, from)).posted).toBe(60_000n);
  });

  it("cannot be applied twice, to a reversal, or to an unsettled transaction", async () => {
    const user = await createUser(db);
    const admin = await createUser(db, "admin");
    const from = await createAccount(db, user.id, { balanceMinor: 60_000n });
    const to = await createAccount(db, user.id);
    const beneficiary = await createExternalBeneficiary(db, user.id);

    const done = await createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "account", accountId: to }, amountMinor: 5_000n, description: "Once" });
    const { reversal } = await reverseTransaction(db, admin.ctx, done.transaction.id, "First reversal");
    await expect(reverseTransaction(db, admin.ctx, done.transaction.id, "Second reversal")).rejects.toBeInstanceOf(InvalidStateError);
    await expect(reverseTransaction(db, admin.ctx, reversal.id, "Reverse the reversal")).rejects.toBeInstanceOf(InvalidStateError);

    const inFlight = await createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "beneficiary", beneficiaryId: beneficiary }, amountMinor: 5_000n, description: "In flight" });
    await expect(reverseTransaction(db, admin.ctx, inFlight.transaction.id, "Too early")).rejects.toBeInstanceOf(InvalidStateError);
    await expect(reverseTransaction(db, admin.ctx, done.transaction.id, " ")).rejects.toBeInstanceOf(ValidationError);
  });

  it("is refused when the recipient no longer has the funds", async () => {
    const user = await createUser(db);
    const admin = await createUser(db, "admin");
    const from = await createAccount(db, user.id, { balanceMinor: 60_000n });
    const to = await createAccount(db, user.id);
    const third = await createAccount(db, user.id);
    const { transaction } = await createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "account", accountId: to }, amountMinor: 20_000n, description: "Spent on arrival" });
    await createTransfer(db, user.ctx, { idempotencyKey: key(), sourceAccountId: to, destination: { kind: "account", accountId: third }, amountMinor: 20_000n, description: "Moved on" });

    await expect(reverseTransaction(db, admin.ctx, transaction.id, "Recall")).rejects.toBeInstanceOf(InsufficientFundsError);
    const [unchanged] = await db.select().from(transactions).where(eq(transactions.id, transaction.id));
    expect(unchanged.status).toBe("completed");
  });
});

describe("deposits and withdrawals", () => {
  it("post against the clearing account", async () => {
    const user = await createUser(db);
    const account = await createAccount(db, user.id);
    const clearing = systemAccountId("clearing", "USD");
    const before = (await balances(db, clearing)).posted;

    const added = await deposit(db, user.ctx, { idempotencyKey: key(), accountId: account, amountMinor: 75_000n, description: "Top up" });
    expect(added.transaction).toMatchObject({ type: "deposit", status: "completed", destinationAccountId: account, sourceAccountId: null });
    expect((await balances(db, account)).posted).toBe(75_000n);
    expect((await balances(db, clearing)).posted).toBe(before - 75_000n);

    const taken = await withdraw(db, user.ctx, { idempotencyKey: key(), accountId: account, amountMinor: 20_000n, description: "Cash out" });
    expect(taken.transaction).toMatchObject({ type: "withdrawal", status: "completed", sourceAccountId: account, destinationAccountId: null });
    expect((await balances(db, account)).posted).toBe(55_000n);
    expect((await balances(db, clearing)).posted).toBe(before - 55_000n);
  });

  it("refuses a withdrawal larger than the available balance", async () => {
    const user = await createUser(db);
    const account = await createAccount(db, user.id, { balanceMinor: 1_000n });
    await expect(withdraw(db, user.ctx, { idempotencyKey: key(), accountId: account, amountMinor: 1_001n, description: "Too much" })).rejects.toBeInstanceOf(InsufficientFundsError);
  });
});

describe("ledger integrity after everything above", () => {
  it("still balances to zero in every currency", async () => {
    const report = await checkLedgerIntegrity(db);
    expect(report.unbalancedTransactions).toBe(0);
    expect(report.driftedAccounts).toBe(0);
    for (const currency of report.currencies) {
      expect(currency.debitMinor).toBe(currency.creditMinor);
      expect(currency.netBalanceMinor).toBe(0n);
    }
    expect(report.healthy).toBe(true);
  });
});
