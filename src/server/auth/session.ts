import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { type User, users } from "@/db/schema";
import { type Role, isStaff } from "@/lib/domain";
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors";
import type { RequestContext } from "../context";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, sessionKey } from "./token";

/**
 * Sessions are stateless: a signed, HTTP-only cookie carries the user id, and
 * every request re-reads the user from the database. Suspending a user or
 * changing their role therefore takes effect on their next request, not when
 * the cookie expires.
 */

export type SessionUser = Omit<User, "passwordHash">;

export async function createSession(user: Pick<User, "id" | "role">): Promise<void> {
  const token = await new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(sessionKey());

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in user, or null. Resolved at most once per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  let userId: string | undefined;
  try {
    const { payload } = await jwtVerify(token, sessionKey(), { algorithms: ["HS256"] });
    userId = payload.sub;
  } catch {
    return null;
  }
  if (!userId) return null;

  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.status !== "active") return null;

  // The password hash never leaves this module.
  const { passwordHash: _passwordHash, ...safe } = user;
  void _passwordHash;
  return safe;
});

/** For pages: sends anonymous visitors to the sign-in screen. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For customer banking pages: staff are sent to the operations console. */
export async function requireCustomer(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "customer") redirect("/admin");
  return user;
}

export function homeFor(role: Role): string {
  return isStaff(role) ? "/admin" : "/dashboard";
}

/** For Server Actions and route handlers: throws instead of redirecting. */
export async function requireActionUser(roles?: readonly Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError("Tu sesión expiró. Inicia sesión de nuevo.");
  if (roles && !roles.includes(user.role)) throw new ForbiddenError();
  return user;
}

export async function clientInfo(): Promise<{ ip?: string; userAgent?: string }> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: forwarded || h.get("x-real-ip") || undefined,
    userAgent: h.get("user-agent")?.slice(0, 400) || undefined,
  };
}

/** Builds the domain-layer context for the current request. */
export async function requestContext(user: SessionUser | null): Promise<RequestContext> {
  return {
    actor: user
      ? { id: user.id, label: user.name, role: user.role }
      : { id: null, label: "Anónimo", role: "system" },
    channel: "web",
    ...(await clientInfo()),
  };
}
