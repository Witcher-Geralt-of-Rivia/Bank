import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { accounts } from "@/db/schema";
import { DomainError, NotFoundError, ValidationError } from "@/lib/errors";
import { MoneyError, parseAmount, toDecimalString } from "@/lib/money";
import { fieldErrorsOf, transferSchema } from "@/lib/validation";
import { getCurrentUser, requestContext } from "@/server/auth/session";
import { createTransfer } from "@/server/ledger/service";
import { limiters } from "@/server/rate-limit";

/**
 * POST /api/v1/transfers
 *
 * The same transfer operation the web flow uses, exposed over HTTP for
 * integrations. Authenticated by the session cookie.
 *
 * The `Idempotency-Key` header is required. Repeating a request with the same
 * key returns the original transfer (HTTP 200 and `Idempotent-Replayed: true`)
 * instead of creating another; reusing a key with a different body is a 409.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new DomainError("unauthenticated", "Sign in to continue.", 401);
    if (user.role !== "customer") {
      throw new DomainError("forbidden", "Only account holders can create transfers.", 403);
    }

    // A cross-site page cannot send a custom header without a CORS preflight,
    // which this route never approves.
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey) throw new ValidationError("The Idempotency-Key header is required.");

    const limit = limiters.movement.check(user.id);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: { code: "rate_limited", message: "Too many requests." } },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = transferSchema.safeParse({ ...(body as object | null), idempotencyKey });
    if (!parsed.success) {
      throw new ValidationError("The request body is invalid.", fieldErrorsOf(parsed.error));
    }

    const db = await getDb();
    const [source] = await db
      .select({ currency: accounts.currency, ownerId: accounts.ownerId })
      .from(accounts)
      .where(eq(accounts.id, parsed.data.sourceAccountId))
      .limit(1);
    if (!source || source.ownerId !== user.id) throw new NotFoundError("Source account");

    let amountMinor: bigint;
    try {
      amountMinor = parseAmount(parsed.data.amount, source.currency);
    } catch (error) {
      if (error instanceof MoneyError) throw new ValidationError(error.message, { amount: error.message });
      throw error;
    }

    const ctx = { ...(await requestContext(user)), channel: "api" as const };
    const { transaction, replayed } = await createTransfer(db, ctx, {
      idempotencyKey,
      sourceAccountId: parsed.data.sourceAccountId,
      destination: parsed.data.destination,
      amountMinor,
      description: parsed.data.description,
      category: parsed.data.category,
    });

    return NextResponse.json(
      {
        id: transaction.id,
        reference: transaction.reference,
        type: transaction.type,
        status: transaction.status,
        // Amounts cross the wire as exact decimal strings, never as floats.
        amount: toDecimalString(transaction.amountMinor, transaction.currency),
        currency: transaction.currency,
        description: transaction.description,
        createdAt: transaction.createdAt.toISOString(),
      },
      { status: replayed ? 200 : 201, headers: { "Idempotent-Replayed": String(replayed) } },
    );
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message, fields: error.fieldErrors } },
        { status: error.status },
      );
    }
    const correlationId = crypto.randomUUID().slice(0, 8);
    console.error(`[aldera] POST /api/v1/transfers failed (${correlationId})`, error);
    return NextResponse.json(
      { error: { code: "internal_error", message: `Unexpected error. Reference ${correlationId}.` } },
      { status: 500 },
    );
  }
}
