import { jwtVerify } from "jose";
import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionKey } from "@/server/auth/token";

/**
 * Runs before every page request and does two things.
 *
 * 1. Content-Security-Policy. A fresh nonce is generated per request and only
 *    scripts carrying it may run, so injected markup cannot execute code.
 *    Next.js reads the nonce from the request header and applies it to its
 *    own scripts, which is why every page is rendered per request.
 *
 * 2. Optimistic route protection. Anonymous visitors are kept out of the
 *    application shell. This is a convenience, not the security boundary:
 *    every page, Server Action and route handler re-verifies the session and
 *    the user's role against the database.
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

function contentSecurityPolicy(nonce: string, secure: boolean): string {
  const development = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    // React needs eval only for its development-time debugging aids.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes position charts and popovers; they cannot carry a nonce.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${development ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    ...(secure ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

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

  if (isProtected && !(await hasValidSession(request))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const response = NextResponse.redirect(url);
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const secure =
    request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const policy = contentSecurityPolicy(nonce, secure);

  // The policy travels on the request so the renderer can read the nonce,
  // and on the response so the browser enforces it.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  if (isProtected) {
    // Account data must never be stored by the browser or an intermediary.
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
