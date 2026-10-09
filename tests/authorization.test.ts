import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { accounts, users } from "@/db/schema";
import {
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "@/lib/errors";
import { setAccountStatus, setUserRole, setUserStatus } from "@/server/admin/service";
import { archiveBeneficiary, createBeneficiary } from "@/server/beneficiaries/service";
import { type RequestContext, systemContext } from "@/server/context";
import {
  approveTransfer,
  createTransfer,
  deposit,
  failTransfer,
  recordExternalActivity,
  rejectTransfer,
  reverseTransaction,
  settleTransfer,
  withdraw,
} from "@/server/ledger/service";
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

const anonymous: RequestContext = { actor: { id: null, label: "Anonymous", role: "customer" } };

describe("customers can only move their own money", () => {
  it("cannot transfer out of another customer's account", async () => {
    const owner = await createUser(db);
    const attacker = await createUser(db);
    const victimAccount = await createAccount(db, owner.id, { balanceMinor: 100_000n });
    const attackerAccount = await createAccount(db, attacker.id);

    await expect(
      createTransfer(db, attacker.ctx, { idempotencyKey: key(), sourceAccountId: victimAccount, destination: { kind: "account", accountId: attackerAccount }, amountMinor: 50_000n, description: "Theft" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await balances(db, victimAccount)).posted).toBe(100_000n);
    expect((await balances(db, attackerAccount)).posted).toBe(0n);
  });

  it("cannot name another customer's account as an 'own account' destination", async () => {
    const owner = await createUser(db);
    const other = await createUser(db);
    const mine = await createAccount(db, owner.id, { balanceMinor: 10_000n });
    const theirs = await createAccount(db, other.id);

    await expect(
      createTransfer(db, owner.ctx, { idempotencyKey: key(), sourceAccountId: mine, destination: { kind: "account", accountId: theirs }, amountMinor: 100n, description: "Probe" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cannot use another customer's beneficiary", async () => {
    const owner = await createUser(db);
    const other = await createUser(db);
    const mine = await createAccount(db, owner.id, { balanceMinor: 10_000n });
    const theirBeneficiary = await createExternalBeneficiary(db, other.id);

    await expect(
      createTransfer(db, owner.ctx, { idempotencyKey: key(), sourceAccountId: mine, destination: { kind: "beneficiary", beneficiaryId: theirBeneficiary }, amountMinor: 100n, description: "Probe" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(archiveBeneficiary(db, owner.ctx, theirBeneficiary)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cannot deposit to or withdraw from another customer's account", async () => {
    const owner = await createUser(db);
    const attacker = await createUser(db);
    const account = await createAccount(db, owner.id, { balanceMinor: 10_000n });

    await expect(withdraw(db, attacker.ctx, { idempotencyKey: key(), accountId: account, amountMinor: 100n, description: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deposit(db, attacker.ctx, { idempotencyKey: key(), accountId: account, amountMinor: 100n, description: "x" })).rejects.toBeInstanceOf(NotFoundError);
    expect((await balances(db, account)).posted).toBe(10_000n);
  });

  it("cannot move money out of the bank's system accounts", async () => {
    const attacker = await createUser(db);
    const mine = await createAccount(db, attacker.id);
    await expect(
      createTransfer(db, attacker.ctx, { idempotencyKey: key(), sourceAccountId: "acc_sys_clearing_usd", destination: { kind: "account", accountId: mine }, amountMinor: 1_000_000n, description: "Mint" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deposit(db, attacker.ctx, { idempotencyKey: key(), accountId: "acc_sys_fees_usd", amountMinor: 100n, description: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("requires a signed-in user", async () => {
    const owner = await createUser(db);
    const from = await createAccount(db, owner.id, { balanceMinor: 10_000n });
    const to = await createAccount(db, owner.id);
    await expect(
      createTransfer(db, anonymous, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "account", accountId: to }, amountMinor: 100n, description: "x" }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("does not let staff move customer funds through the customer flow", async () => {
    const owner = await createUser(db);
    const operator = await createUser(db, "operator");
    const admin = await createUser(db, "admin");
    const from = await createAccount(db, owner.id, { balanceMinor: 10_000n });
    const to = await createAccount(db, owner.id);
    for (const staff of [operator, admin]) {
      await expect(
        createTransfer(db, staff.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "account", accountId: to }, amountMinor: 100n, description: "x" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("operations actions are role-gated", () => {
  async function scenario() {
    const customer = await createUser(db);
    const from = await createAccount(db, customer.id, { balanceMinor: 6_000_000n });
    const beneficiary = await createExternalBeneficiary(db, customer.id);
    const make = (amountMinor: bigint) =>
      createTransfer(db, customer.ctx, { idempotencyKey: key(), sourceAccountId: from, destination: { kind: "beneficiary", beneficiaryId: beneficiary }, amountMinor, description: "Payment" });
    return { customer, from, pending: (await make(1_500_000n)).transaction, processing: (await make(50_000n)).transaction };
  }

  it("customers cannot approve, reject, settle, fail or reverse", async () => {
    const { customer, pending, processing } = await scenario();
    await expect(approveTransfer(db, customer.ctx, pending.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(rejectTransfer(db, customer.ctx, pending.id, "no")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(settleTransfer(db, customer.ctx, processing.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(failTransfer(db, customer.ctx, processing.id, "no")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reverseTransaction(db, customer.ctx, processing.id, "undo this")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("operators can review and settle but cannot reverse", async () => {
    const { pending, processing } = await scenario();
    const operator = await createUser(db, "operator");

    expect((await approveTransfer(db, operator.ctx, pending.id)).status).toBe("processing");
    const settled = await settleTransfer(db, operator.ctx, processing.id);
    expect(settled.status).toBe("completed");
    await expect(reverseTransaction(db, operator.ctx, settled.id, "Operator override")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("administrators can reverse", async () => {
    const { from, processing } = await scenario();
    const admin = await createUser(db, "admin");
    await settleTransfer(db, admin.ctx, processing.id);
    const before = (await balances(db, from)).posted;
    const { original } = await reverseTransaction(db, admin.ctx, processing.id, "Recalled");
    expect(original.status).toBe("reversed");
    expect((await balances(db, from)).posted).toBe(before + 50_000n);
  });

  it("only the platform can record external activity", async () => {
    const customer = await createUser(db);
    const admin = await createUser(db, "admin");
    const account = await createAccount(db, customer.id);
    const input = { idempotencyKey: key(), type: "transfer_in" as const, accountId: account, amountMinor: 1_000_000n, counterpartyName: "Nobody", description: "Free money", category: "other" as const };

    await expect(recordExternalActivity(db, customer.ctx, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordExternalActivity(db, admin.ctx, input)).rejects.toBeInstanceOf(ForbiddenError);
    await recordExternalActivity(db, systemContext(), input);
    expect((await balances(db, account)).posted).toBe(1_000_000n);
  });
});

describe("administration", () => {
  it("customers cannot freeze accounts or manage users", async () => {
    const customer = await createUser(db);
    const victim = await createUser(db);
    const account = await createAccount(db, victim.id);
    await expect(setAccountStatus(db, customer.ctx, account, "frozen", "because")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setUserStatus(db, customer.ctx, victim.id, "suspended", "because")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setUserRole(db, customer.ctx, customer.id, "admin", "self promotion")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("operators can freeze accounts but cannot suspend users or change roles", async () => {
    const operator = await createUser(db, "operator");
    const customer = await createUser(db);
    const account = await createAccount(db, customer.id);

    await setAccountStatus(db, operator.ctx, account, "frozen", "Verification pending");
    const [frozen] = await db.select().from(accounts).where(eq(accounts.id, account));
    expect(frozen.status).toBe("frozen");

    await expect(setUserStatus(db, operator.ctx, customer.id, "suspended", "because")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setUserRole(db, operator.ctx, operator.id, "admin", "self promotion")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("administrators can manage users, but not themselves", async () => {
    const admin = await createUser(db, "admin");
    const customer = await createUser(db);

    await setUserStatus(db, admin.ctx, customer.id, "suspended", "Verification outstanding");
    await setUserRole(db, admin.ctx, customer.id, "operator", "Joined the operations team");
    const [updated] = await db.select().from(users).where(eq(users.id, customer.id));
    expect(updated).toMatchObject({ status: "suspended", role: "operator" });

    await expect(setUserStatus(db, admin.ctx, admin.id, "suspended", "oops")).rejects.toBeInstanceOf(InvalidStateError);
    await expect(setUserRole(db, admin.ctx, admin.id, "customer", "oops")).rejects.toBeInstanceOf(InvalidStateError);
  });

  it("requires a reason for sensitive actions and protects system accounts", async () => {
    const admin = await createUser(db, "admin");
    const customer = await createUser(db);
    const account = await createAccount(db, customer.id);
    await expect(setAccountStatus(db, admin.ctx, account, "frozen", "  ")).rejects.toBeInstanceOf(ValidationError);
    await expect(setAccountStatus(db, admin.ctx, "acc_sys_clearing_usd", "frozen", "Freeze the bank")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("beneficiaries", () => {
  it("staff cannot add beneficiaries; customers can", async () => {
    const operator = await createUser(db, "operator");
    const customer = await createUser(db);
    const payload = { kind: "external" as const, name: "Vendor Ltd", bankName: "Some Bank", accountNumber: "1234 5678 9012", country: "US", currency: "USD" as const };

    await expect(createBeneficiary(db, operator.ctx, payload)).rejects.toBeInstanceOf(ForbiddenError);
    const created = await createBeneficiary(db, customer.ctx, payload);
    expect(created.ownerId).toBe(customer.id);
  });

  it("resolves an internal beneficiary by account number, never to the caller's own account", async () => {
    const customer = await createUser(db);
    const other = await createUser(db);
    const mine = await createAccount(db, customer.id);
    const theirs = await createAccount(db, other.id);
    const [mineRow] = await db.select().from(accounts).where(eq(accounts.id, mine));
    const [theirsRow] = await db.select().from(accounts).where(eq(accounts.id, theirs));
    const base = { kind: "internal" as const, name: "Someone", country: "US", currency: "USD" as const };

    const created = await createBeneficiary(db, customer.ctx, { ...base, accountNumber: theirsRow.number });
    expect(created.internalAccountId).toBe(theirs);

    await expect(createBeneficiary(db, customer.ctx, { ...base, accountNumber: mineRow.number })).rejects.toBeInstanceOf(ValidationError);
    await expect(createBeneficiary(db, customer.ctx, { ...base, accountNumber: "0000 0000 0000" })).rejects.toBeInstanceOf(ValidationError);
  });
});
