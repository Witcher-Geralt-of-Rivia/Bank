import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { DatabaseNotConfiguredError, getDb } from "@/db/client";
import { env } from "@/lib/env";
import { isSessionConfigured } from "@/server/auth/token";

/**
 * Liveness and readiness probe. Confirms the database answers a query and
 * reports configuration, without exposing any customer data. It is also
 * called by the sign-in page to warm the database before the first request.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    const db = await getDb();
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({
      status: "ok",
      database: env.persistence,
      demoMode: env.demoMode,
      sessionConfigured: isSessionConfigured(),
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("[aldera] health check failed", error);
    return NextResponse.json(
      {
        status: "unavailable",
        reason: error instanceof DatabaseNotConfiguredError ? "database_not_configured" : "database_unreachable",
      },
      { status: 503 },
    );
  }
}
