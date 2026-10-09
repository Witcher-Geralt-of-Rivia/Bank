import "server-only";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { accounts, users } from "@/db/schema";
import { ACCOUNT_STATUS_LABELS, ROLE_LABELS, type Role } from "@/lib/domain";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "../audit";
import { type RequestContext, assertAdmin, assertStaff, clock } from "../context";
import { notify } from "../ledger/service";

function requireReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    throw new ValidationError("Se requiere un motivo para esta acción.", {
      reason: "Ingresa un motivo.",
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
    if (!account || account.kind !== "customer") throw new NotFoundError("la cuenta");
    if (account.status === "closed") {
      throw new InvalidStateError("Una cuenta cerrada no se puede modificar.");
    }
    if (account.status === status) {
      throw new InvalidStateError(`La cuenta ya está ${ACCOUNT_STATUS_LABELS[status].toLowerCase()}.`);
    }

    await tx.update(accounts).set({ status }).where(eq(accounts.id, accountId));
    await recordAudit(tx, ctx, {
      action: status === "frozen" ? "account.frozen" : "account.unfrozen",
      entityType: "account",
      entityId: accountId,
      summary: `Cuenta ${status === "frozen" ? "congelada" : "descongelada"}: ${account.name}.`,
      metadata: { reason: note, previousStatus: account.status },
    });
    await notify(
      tx,
      ctx,
      account.ownerId,
      "account",
      status === "frozen" ? "Cuenta congelada" : "Cuenta reactivada",
      status === "frozen"
        ? `Tu cuenta “${account.name}” fue congelada y no puede enviar ni recibir fondos. Comunícate con soporte para obtener más información.`
        : `Tu cuenta “${account.name}” vuelve a estar activa.`,
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
    throw new InvalidStateError("No puedes cambiar el estado de tu propio usuario.");
  }

  await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!user) throw new NotFoundError("el usuario");
    if (user.status === status) {
      throw new InvalidStateError(`El usuario ya está ${status === "suspended" ? "suspendido" : "activo"}.`);
    }

    await tx
      .update(users)
      .set({ status, updatedAt: clock(ctx) })
      .where(eq(users.id, userId));
    await recordAudit(tx, ctx, {
      action: status === "suspended" ? "user.suspended" : "user.reactivated",
      entityType: "user",
      entityId: userId,
      summary: `Usuario ${status === "suspended" ? "suspendido" : "reactivado"}: ${user.name}.`,
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
    throw new InvalidStateError("No puedes cambiar tu propio rol.");
  }

  await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!user) throw new NotFoundError("el usuario");
    if (user.role === role) {
      throw new InvalidStateError(`El usuario ya tiene el rol de ${ROLE_LABELS[role].toLowerCase()}.`);
    }

    await tx
      .update(users)
      .set({ role, updatedAt: clock(ctx) })
      .where(eq(users.id, userId));
    await recordAudit(tx, ctx, {
      action: "user.role_changed",
      entityType: "user",
      entityId: userId,
      summary: `El rol de ${user.name} cambió de ${ROLE_LABELS[user.role].toLowerCase()} a ${ROLE_LABELS[role].toLowerCase()}.`,
      metadata: { reason: note, from: user.role, to: role },
    });
  });
}
