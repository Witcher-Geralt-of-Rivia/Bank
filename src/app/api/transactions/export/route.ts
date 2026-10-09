import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { TRANSACTION_STATUS_LABELS, TRANSACTION_TYPE_LABELS } from "@/lib/domain";
import { toDecimalString } from "@/lib/money";
import { getCurrentUser } from "@/server/auth/session";
import { limiters } from "@/server/rate-limit";
import { listTransactionsForUser, parseTransactionFilters } from "@/server/queries/transactions";

const MAX_ROWS = 1000;

const DIRECTION_LABELS = { in: "Ingreso", out: "Egreso", internal: "Interna" } as const;

/** Quotes a CSV field and neutralises spreadsheet formula injection. */
function cell(value: string | null | undefined): string {
  let text = value ?? "";
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * CSV export of the signed-in customer's transactions, honouring the same
 * filters as the list. The query is scoped to accounts the customer owns.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (user.role !== "customer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const limit = limiters.mutation.check(`export:${user.id}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const filters = parseTransactionFilters(Object.fromEntries(request.nextUrl.searchParams));
  const db = await getDb();

  const lines = [
    ["Fecha (UTC)", "Referencia", "Tipo", "Estado", "Contraparte", "Descripción", "Cuenta", "Sentido", "Monto", "Moneda"].join(","),
  ];
  for (let page = 1; lines.length <= MAX_ROWS; page++) {
    const result = await listTransactionsForUser(db, user.id, { ...filters, page, pageSize: 100 });
    for (const row of result.rows) {
      const signed = row.direction === "out" ? -row.amountMinor : row.amountMinor;
      lines.push(
        [
          cell(row.createdAt.toISOString()),
          cell(row.reference),
          cell(TRANSACTION_TYPE_LABELS[row.type]),
          cell(TRANSACTION_STATUS_LABELS[row.status]),
          cell(row.counterparty),
          cell(row.description),
          cell(row.ownAccount?.name),
          cell(DIRECTION_LABELS[row.direction]),
          // Exact decimal string from integer minor units.
          toDecimalString(signed, row.currency),
          row.currency,
        ].join(","),
      );
    }
    if (page >= result.pageCount) break;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="aldera-transacciones-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
