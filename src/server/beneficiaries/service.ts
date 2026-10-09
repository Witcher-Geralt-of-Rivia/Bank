import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { type Beneficiary, accounts, beneficiaries, users } from "@/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { BeneficiaryPayload } from "@/lib/validation";
import { recordAudit } from "../audit";
import { type RequestContext, assertCustomer, clock, makeId } from "../context";

function normaliseAccountNumber(value: string): string {
  return value.replace(/[\s-]+/g, "").toUpperCase();
}

/**
 * Adds a beneficiary for the caller. An `internal` beneficiary is another
 * customer on the platform, resolved by account number; transfers to it
 * settle instantly on the ledger.
 */
export async function createBeneficiary(
  db: DbOrTx,
  ctx: RequestContext,
  input: BeneficiaryPayload,
): Promise<Beneficiary> {
  const ownerId = assertCustomer(ctx);
  const accountNumber = normaliseAccountNumber(input.accountNumber);

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ accountNumber: beneficiaries.accountNumber })
      .from(beneficiaries)
      .where(and(eq(beneficiaries.ownerId, ownerId), isNull(beneficiaries.archivedAt)));
    if (existing.some((row) => normaliseAccountNumber(row.accountNumber) === accountNumber)) {
      throw new ConflictError("You already have a beneficiary with this account number.", {
        accountNumber: "This account is already in your beneficiaries.",
      });
    }

    let internalAccountId: string | null = null;
    let bankName = input.bankName?.trim() ?? "";
    let displayNumber = input.accountNumber.trim();

    if (input.kind === "internal") {
      const candidates = await tx
        .select({ account: accounts, ownerName: users.name })
        .from(accounts)
        .innerJoin(users, eq(users.id, accounts.ownerId))
        .where(eq(accounts.kind, "customer"));
      const match = candidates.find(
        (row) => normaliseAccountNumber(row.account.number) === accountNumber,
      );

      if (!match || match.account.status === "closed") {
        throw new ValidationError("No Aldera account matches this number.", {
          accountNumber: "No Aldera account matches this number.",
        });
      }
      if (match.account.ownerId === ownerId) {
        throw new ValidationError("This is one of your own accounts.", {
          accountNumber: "Use “Between my accounts” to move money to your own accounts.",
        });
      }
      if (match.account.currency !== input.currency) {
        throw new ValidationError("Currency does not match the account.", {
          currency: `This account is held in ${match.account.currency}.`,
        });
      }
      internalAccountId = match.account.id;
      bankName = "Aldera";
      displayNumber = match.account.number;
    } else if (bankName.length < 2) {
      throw new ValidationError("Enter the name of the bank.", {
        bankName: "Enter the name of the bank.",
      });
    }

    const [created] = await tx
      .insert(beneficiaries)
      .values({
        id: makeId(ctx, "ben"),
        ownerId,
        kind: input.kind,
        name: input.name,
        nickname: input.nickname || null,
        email: input.email || null,
        bankName,
        accountNumber: displayNumber,
        routingCode: input.kind === "internal" ? null : input.routingCode || null,
        country: input.country,
        currency: input.currency,
        internalAccountId,
        createdAt: clock(ctx),
      })
      .returning();

    await recordAudit(tx, ctx, {
      action: "beneficiary.created",
      entityType: "beneficiary",
      entityId: created.id,
      summary: `Beneficiary ${created.name} added.`,
      metadata: {
        kind: created.kind,
        bank: created.bankName,
        currency: created.currency,
        accountEnding: displayNumber.replace(/\s+/g, "").slice(-4),
      },
    });
    return created;
  });
}

/**
 * Removes a beneficiary from the caller's list. The record is archived, not
 * deleted, because past transactions still reference it.
 */
export async function archiveBeneficiary(
  db: DbOrTx,
  ctx: RequestContext,
  beneficiaryId: string,
): Promise<void> {
  const ownerId = assertCustomer(ctx);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(beneficiaries)
      .where(eq(beneficiaries.id, beneficiaryId))
      .limit(1);
    if (!row || row.ownerId !== ownerId || row.archivedAt) {
      throw new NotFoundError("Beneficiary");
    }

    await tx
      .update(beneficiaries)
      .set({ archivedAt: clock(ctx) })
      .where(eq(beneficiaries.id, beneficiaryId));
    await recordAudit(tx, ctx, {
      action: "beneficiary.archived",
      entityType: "beneficiary",
      entityId: beneficiaryId,
      summary: `Beneficiary ${row.name} removed.`,
    });
  });
}
