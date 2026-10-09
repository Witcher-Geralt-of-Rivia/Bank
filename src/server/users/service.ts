import "server-only";
import { randomInt } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "@/db/client";
import { type User, accounts, users } from "@/db/schema";
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import type { CurrencyCode } from "@/lib/money";
import { recordAudit } from "../audit";
import { hashPassword, verifyPassword, decoyHash } from "../auth/password";
import { type RequestContext, clock, makeId, requireUserId } from "../context";
import { notify } from "../ledger/service";

/** Generates a 12-digit account number that is not already in use. */
async function generateAccountNumber(tx: Tx): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const digits = `4410${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
    const number = `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;
    const [taken] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.number, number))
      .limit(1);
    if (!taken) return number;
  }
  throw new DomainError("internal_error", "Could not allocate an account number.", 500);
}

export async function openAccount(
  tx: Tx,
  ctx: RequestContext,
  params: {
    ownerId: string;
    name: string;
    type: "checking" | "savings" | "reserve";
    currency: CurrencyCode;
  },
): Promise<string> {
  const id = makeId(ctx, "acc");
  await tx.insert(accounts).values({
    id,
    ownerId: params.ownerId,
    kind: "customer",
    type: params.type,
    name: params.name,
    number: await generateAccountNumber(tx),
    currency: params.currency,
    createdAt: clock(ctx),
  });
  await recordAudit(tx, ctx, {
    action: "account.opened",
    entityType: "account",
    entityId: id,
    summary: `${params.name} (${params.currency}) opened.`,
    metadata: { type: params.type, currency: params.currency },
  });
  return id;
}

/** Registers a customer and opens their first account. */
export async function registerCustomer(
  db: DbOrTx,
  ctx: RequestContext,
  input: { name: string; email: string; password: string },
): Promise<User> {
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    if (existing) {
      throw new ConflictError("An account with this email already exists.", {
        email: "An account with this email already exists.",
      });
    }

    const at = clock(ctx);
    const [user] = await tx
      .insert(users)
      .values({
        id: makeId(ctx, "usr"),
        email: input.email,
        name: input.name,
        passwordHash,
        role: "customer",
        createdAt: at,
        updatedAt: at,
        lastLoginAt: at,
      })
      .returning();

    const actorCtx: RequestContext = {
      ...ctx,
      actor: { id: user.id, label: user.name, role: "customer" },
    };
    await recordAudit(tx, actorCtx, {
      action: "auth.registered",
      entityType: "user",
      entityId: user.id,
      summary: `${user.name} registered.`,
    });
    await openAccount(tx, actorCtx, {
      ownerId: user.id,
      name: "Primary Account",
      type: "checking",
      currency: "USD",
    });
    await notify(
      tx,
      actorCtx,
      user.id,
      "account",
      "Welcome to Aldera",
      "Your Primary Account is open. Add funds to make your first transfer.",
      "/accounts",
    );
    return user;
  });
}

/**
 * Verifies credentials and records the attempt. The same generic error is
 * returned for an unknown email and a wrong password.
 */
export async function authenticate(
  db: DbOrTx,
  ctx: RequestContext,
  email: string,
  password: string,
): Promise<User> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const valid = await verifyPassword(password, user?.passwordHash ?? (await decoyHash()));

  if (!user || !valid) {
    await recordAudit(db, ctx, {
      action: "auth.login_failed",
      entityType: "user",
      entityId: user?.id ?? null,
      actorLabel: email,
      summary: `Failed sign-in attempt for ${email}.`,
      metadata: { reason: user ? "wrong_password" : "unknown_email" },
    });
    throw new DomainError("unauthenticated", "Incorrect email or password.", 401);
  }

  if (user.status !== "active") {
    await recordAudit(db, ctx, {
      action: "auth.login_failed",
      entityType: "user",
      entityId: user.id,
      actorLabel: email,
      summary: `Sign-in blocked for suspended user ${email}.`,
      metadata: { reason: "suspended" },
    });
    throw new ForbiddenError(
      "This account is suspended. Contact support to restore access.",
    );
  }

  const at = clock(ctx);
  await db.update(users).set({ lastLoginAt: at }).where(eq(users.id, user.id));
  await recordAudit(
    db,
    { ...ctx, actor: { id: user.id, label: user.name, role: user.role } },
    {
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
      summary: `${user.name} signed in.`,
    },
  );
  return { ...user, lastLoginAt: at };
}

export async function updateProfile(
  db: DbOrTx,
  ctx: RequestContext,
  input: { name: string; company?: string; phone?: string },
): Promise<void> {
  const userId = requireUserId(ctx);
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!current) throw new NotFoundError("User");

    const next = {
      name: input.name,
      company: input.company || null,
      phone: input.phone || null,
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
      (key) => next[key] !== current[key],
    );
    if (changed.length === 0) return;

    await tx
      .update(users)
      .set({ ...next, updatedAt: clock(ctx) })
      .where(eq(users.id, userId));
    await recordAudit(tx, ctx, {
      action: "profile.updated",
      entityType: "user",
      entityId: userId,
      summary: `Profile updated (${changed.join(", ")}).`,
      metadata: { fields: changed },
    });
  });
}

export async function changePassword(
  db: DbOrTx,
  ctx: RequestContext,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const userId = requireUserId(ctx);
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new NotFoundError("User");

  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new ValidationError("Your current password is incorrect.", {
      currentPassword: "Your current password is incorrect.",
    });
  }

  const passwordHash = await hashPassword(input.newPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, updatedAt: clock(ctx) })
      .where(eq(users.id, userId));
    await recordAudit(tx, ctx, {
      action: "auth.password_changed",
      entityType: "user",
      entityId: userId,
      summary: "Password changed.",
    });
    await notify(
      tx,
      ctx,
      userId,
      "security",
      "Your password was changed",
      "If you did not make this change, contact support immediately.",
      "/settings",
    );
  });
}

export async function setTwoFactor(
  db: DbOrTx,
  ctx: RequestContext,
  enabled: boolean,
): Promise<void> {
  const userId = requireUserId(ctx);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ twoFactorEnabled: enabled, updatedAt: clock(ctx) })
      .where(eq(users.id, userId));
    await recordAudit(tx, ctx, {
      action: enabled ? "security.two_factor_enabled" : "security.two_factor_disabled",
      entityType: "user",
      entityId: userId,
      summary: `Two-step verification ${enabled ? "enabled" : "disabled"}.`,
    });
  });
}

export async function updatePreferences(
  db: DbOrTx,
  ctx: RequestContext,
  input: { notifyTransfers: boolean; notifySecurity: boolean },
): Promise<void> {
  const userId = requireUserId(ctx);
  await db
    .update(users)
    .set({ ...input, updatedAt: clock(ctx) })
    .where(eq(users.id, userId));
}

/**
 * Records a password-reset request. The response is identical whether or not
 * the email is registered, so the endpoint cannot be used to enumerate users.
 * (Email delivery is outside the scope of the demo.)
 */
export async function requestPasswordReset(
  db: DbOrTx,
  ctx: RequestContext,
  email: string,
): Promise<void> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  await recordAudit(db, ctx, {
    action: "auth.password_reset_requested",
    entityType: "user",
    entityId: user?.id ?? null,
    actorLabel: email,
    summary: `Password reset requested for ${email}.`,
  });
}

export async function recordLogout(db: DbOrTx, ctx: RequestContext): Promise<void> {
  if (!ctx.actor.id) return;
  await recordAudit(db, ctx, {
    action: "auth.logout",
    entityType: "user",
    entityId: ctx.actor.id,
    summary: `${ctx.actor.label} signed out.`,
  });
}

export async function countUsers(db: DbOrTx): Promise<number> {
  const [row] = await db.select({ count: sql<string>`count(*)::text` }).from(users);
  return Number(row?.count ?? 0);
}
