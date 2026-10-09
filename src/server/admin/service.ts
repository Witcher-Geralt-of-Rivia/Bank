import "server-only";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { accounts, users } from "@/db/schema";
import { ROLE_LABELS, type Role } from "@/lib/domain";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "../audit";
import { type RequestContext, assertAdmin, assertStaff, clock } from "../context";
import { notify } from "../ledger/service";

function requireReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    throw new ValidationError("A reason is required for this action.", {
      reason: "Enter a reason.",
    });
  }
  return trimmed;
}

/** Freezes or unfreezes a customer account. Operators and administrators. */
export async function setAccountStatus(
  db: DbOrTx,
  ctx: RequestContext,
  accountId: string,
  status: "active" | "frozen",
  reason: string,
): Promise<void> {
  assertStaff(ctx);
  const note = requireReason(reason);

  await db.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .for("update");
    if (!account || account.kind !== "customer") throw new NotFoundError("Account");
    if (account.status === "closed") {
      throw new InvalidStateError("A closed account cannot be changed.");
    }
    if (account.status === status) {
      throw new InvalidStateError(`The account is already ${status}.`);
    }

    await tx.update(accounts).set({ status }).where(eq(accounts.id, accountId));
    await recordAudit(tx, ctx, {
      action: status === "frozen" ? "account.frozen" : "account.unfrozen",
      entityType: "account",
      entityId: accountId,
      summary: `${account.name} ${status === "frozen" ? "frozen" : "unfrozen"}.`,
      metadata: { reason: note, previousStatus: account.status },
    });
    await notify(
      tx,
      ctx,
      account.ownerId,
      "account",
      status === "frozen" ? "Account frozen" : "Account restored",
      status === "frozen"
        ? `${account.name} has been frozen and cannot send or receive funds. Contact support for details.`
        : `${account.name} is active again.`,
      `/accounts/${accountId}`,
    );
  });
}

/** Suspends or reactivates a user. Administrators only. */
export async function setUserStatus(
  db: DbOrTx,
  ctx: RequestContext,
  userId: string,
  status: "active" | "suspended",
  reason: string,
): Promise<void> {
  assertAdmin(ctx);
  const note = requireReason(reason);
  if (userId === ctx.actor.id) {
    throw new InvalidStateError("You cannot change the status of your own user.");
  }

  await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!user) throw new NotFoundError("User");
    if (user.status === status) {
      throw new InvalidStateError(`The user is already ${status}.`);
    }

    await tx
      .update(users)
      .set({ status, updatedAt: clock(ctx) })
      .where(eq(users.id, userId));
    await recordAudit(tx, ctx, {
      action: status === "suspended" ? "user.suspended" : "user.reactivated",
      entityType: "user",
      entityId: userId,
      summary: `${user.name} ${status === "suspended" ? "suspended" : "reactivated"}.`,
      metadata: { reason: note, email: user.email },
    });
  });
}

/** Changes a user's role. Administrators only, and never their own. */
export async function setUserRole(
  db: DbOrTx,
  ctx: RequestContext,
  userId: string,
  role: Role,
  reason: string,
): Promise<void> {
  assertAdmin(ctx);
  const note = requireReason(reason);
  if (userId === ctx.actor.id) {
    throw new InvalidStateError("You cannot change your own role.");
  }

  await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!user) throw new NotFoundError("User");
    if (user.role === role) {
      throw new InvalidStateError(`The user is already ${ROLE_LABELS[role]}.`);
    }

    await tx
      .update(users)
      .set({ role, updatedAt: clock(ctx) })
      .where(eq(users.id, userId));
    await recordAudit(tx, ctx, {
      action: "user.role_changed",
      entityType: "user",
      entityId: userId,
      summary: `${user.name} changed from ${ROLE_LABELS[user.role]} to ${ROLE_LABELS[role]}.`,
      metadata: { reason: note, from: user.role, to: role },
    });
  });
}
