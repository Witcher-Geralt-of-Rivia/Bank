import "server-only";
import { type Role, isStaff } from "@/lib/domain";
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors";
import { type IdPrefix, newId, newReference } from "./ids";

/** Who is performing an operation. `system` is the platform itself. */
export type Actor = {
  id: string | null;
  label: string;
  role: Role | "system";
};

export const SYSTEM_ACTOR: Actor = { id: null, label: "Sistema", role: "system" };

/**
 * Everything the domain layer needs to know about the caller. It is built
 * once at the edge (Server Action, route handler, job) and passed down, so
 * services never read cookies or headers themselves and can be tested as
 * plain functions.
 */
export type RequestContext = {
  actor: Actor;
  ip?: string;
  userAgent?: string;
  channel?: "web" | "api" | "system";
  /** Overrides the clock; used by the seed and by tests. */
  now?: Date;
  /** Overrides id generation so seeded demo data is identical on every boot. */
  ids?: IdSource;
};

export type IdSource = {
  id(prefix: IdPrefix): string;
  reference(): string;
};

export function makeId(ctx: RequestContext, prefix: IdPrefix): string {
  return ctx.ids?.id(prefix) ?? newId(prefix);
}

export function makeReference(ctx: RequestContext): string {
  return ctx.ids?.reference() ?? newReference();
}

export function systemContext(now?: Date): RequestContext {
  return { actor: SYSTEM_ACTOR, channel: "system", now };
}

export function clock(ctx: RequestContext): Date {
  return ctx.now ?? new Date();
}

/** The acting user's id, or an error if the caller is not a signed-in user. */
export function requireUserId(ctx: RequestContext): string {
  if (!ctx.actor.id) throw new UnauthenticatedError();
  return ctx.actor.id;
}

export function assertCustomer(ctx: RequestContext): string {
  const id = requireUserId(ctx);
  if (ctx.actor.role !== "customer") {
    throw new ForbiddenError("Solo los titulares de cuentas pueden mover sus propios fondos.");
  }
  return id;
}

/** Operators and administrators, plus the platform itself. */
export function assertStaff(ctx: RequestContext): void {
  if (ctx.actor.role === "system") return;
  if (!isStaff(ctx.actor.role)) throw new ForbiddenError();
}

export function assertAdmin(ctx: RequestContext): void {
  if (ctx.actor.role !== "admin") {
    throw new ForbiddenError("Esta acción requiere un administrador.");
  }
}

export function assertSystem(ctx: RequestContext): void {
  if (ctx.actor.role !== "system") throw new ForbiddenError();
}
