import { eq } from "drizzle-orm";
import { type Database, createEmbeddedDatabase } from "@/db/client";
import { accounts, beneficiaries, users } from "@/db/schema";
import type { Role } from "@/lib/domain";
import type { CurrencyCode } from "@/lib/money";
import type { RequestContext } from "@/server/context";
import { systemContext } from "@/server/context";
import { recordExternalActivity } from "@/server/ledger/service";

/**
 * Test harness: a fresh in-memory PostgreSQL database per test file, with the
 * production schema, constraints and triggers applied.
 */
export async function createTestDatabase(): Promise<Database> {
  return createEmbeddedDatabase();
}

let counter = 0;
const next = () => (++counter).toString().padStart(4, "0");

export function key(label = "key"): string {
  return `test-${label}-${next()}`;
}

export async function createUser(
  db: Database,
  role: Role = "customer",
  name = `User ${next()}`,
): Promise<{ id: string; ctx: RequestContext }> {
  const id = `usr_test_${next()}`;
  await db.insert(users).values({
    id,
    email: `${id}@test.example`,
    name,
    passwordHash: "not-a-real-hash",
    role,
  });
  return { id, ctx: { actor: { id, label: name, role }, channel: "web" } };
}

export async function createAccount(
  db: Database,
  ownerId: string,
  options: { currency?: CurrencyCode; balanceMinor?: bigint; name?: string } = {},
): Promise<string> {
  const id = `acc_test_${next()}`;
  await db.insert(accounts).values({
    id,
    ownerId,
    kind: "customer",
    type: "checking",
    name: options.name ?? `Account ${id}`,
    number: `TEST ${id}`,
    currency: options.currency ?? "USD",
  });

  if (options.balanceMinor && options.balanceMinor > 0n) {
    await recordExternalActivity(db, systemContext(), {
      idempotencyKey: key("fund"),
      type: "transfer_in",
      accountId: id,
      amountMinor: options.balanceMinor,
      counterpartyName: "Test funding",
      description: "Opening balance",
      category: "transfers",
    });
  }
  return id;
}

export async function createExternalBeneficiary(
  db: Database,
  ownerId: string,
  currency: CurrencyCode = "USD",
): Promise<string> {
  const id = `ben_test_${next()}`;
  await db.insert(beneficiaries).values({
    id,
    ownerId,
    kind: "external",
    name: `Beneficiary ${id}`,
    bankName: "Test Bank",
    accountNumber: `EXT-${id}`,
    country: "US",
    currency,
  });
  return id;
}

export async function createInternalBeneficiary(
  db: Database,
  ownerId: string,
  internalAccountId: string,
  currency: CurrencyCode = "USD",
): Promise<string> {
  const id = `ben_test_${next()}`;
  await db.insert(beneficiaries).values({
    id,
    ownerId,
    kind: "internal",
    name: `Beneficiary ${id}`,
    bankName: "Aldera",
    accountNumber: `INT-${id}`,
    country: "US",
    currency,
    internalAccountId,
  });
  return id;
}

export async function balances(
  db: Database,
  accountId: string,
): Promise<{ posted: bigint; held: bigint; available: bigint }> {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  return {
    posted: row.postedMinor,
    held: row.heldMinor,
    available: row.postedMinor - row.heldMinor,
  };
}
