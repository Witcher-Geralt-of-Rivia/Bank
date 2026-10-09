import { jwtVerify } from "jose";
import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionKey } from "@/server/auth/token";

/**
 * Optimistic route protection.
 *
 * Runs before rendering and keeps anonymous visitors out of the application
 * shell. It is a convenience, not the security boundary: every page, Server Action and route handler
 * re-verifies the session and the user's role against the database.
 */

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/accounts",
  "/transactions",
  "/transfers",
  "/beneficiaries",
  "/insights",
  "/notifications",
  "/settings",
  "/admin",
];

async function hasValidSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, sessionKey(), { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isProtected) return NextResponse.next();

  if (!(await hasValidSession(request))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const response = NextResponse.redirect(url);
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  // Account data must never be stored by the browser or an intermediary.
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
