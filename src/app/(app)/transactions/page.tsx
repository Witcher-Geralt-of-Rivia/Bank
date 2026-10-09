import { Download, SearchX, Send } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageHeader, Pagination, Section } from "@/components/shared/page";
import { TransactionFilterBar } from "@/components/transactions/filter-bar";
import { TransactionList } from "@/components/transactions/transaction-list";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { maskAccountNumber } from "@/lib/domain";
import { requireCustomer } from "@/server/auth/session";
import { listAccountsForUser } from "@/server/queries/accounts";
import { listTransactionsForUser, parseTransactionFilters } from "@/server/queries/transactions";

export const metadata: Metadata = { title: "Transacciones" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Rebuilds the query string from the raw parameters, replacing the page. */
function queryString(params: Record<string, string | string[] | undefined>, page?: number): string {
  const next = new URLSearchParams();
  for (const key of ["q", "type", "status", "account", "from", "to"]) {
    const value = params[key];
    const text = Array.isArray(value) ? value[0] : value;
    if (text) next.set(key, text);
  }
  if (page && page > 1) next.set("page", String(page));
  const query = next.toString();
  return query ? `?${query}` : "";
}

export default async function TransactionsPage({ searchParams }: Props) {
  const user = await requireCustomer();
  const params = await searchParams;
  const db = await getDb();

  const filters = parseTransactionFilters(params);
  const [accounts, result] = await Promise.all([
    listAccountsForUser(db, user.id),
    listTransactionsForUser(db, user.id, filters),
  ]);
  const filtered = Boolean(filters.q || filters.type || filters.status || filters.accountId || filters.from || filters.to);

  return (
    <>
      <PageHeader
        title="Transacciones"
        description="Todos los movimientos de tus cuentas. Selecciona una transacción para ver su comprobante, su historial de estados y sus asientos contables."
        actions={
          <>
            <Button asChild variant="outline" size="lg">
              <a href={`/api/transactions/export${queryString(params)}`} download>
                <Download /> Exportar CSV
              </a>
            </Button>
            <Button asChild size="lg">
              <Link href="/transfers/new">
                <Send /> Enviar dinero
              </Link>
            </Button>
          </>
        }
      />

      <Section flush>
        <Suspense fallback={<div className="h-[7.5rem] border-b border-border/70" />}>
          <TransactionFilterBar
            accounts={accounts.map((a) => ({ id: a.id, label: `${a.name} ${maskAccountNumber(a.number)}` }))}
          />
        </Suspense>

        {result.rows.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="Ninguna transacción coincide con estos filtros"
              description="Prueba con otro término de búsqueda, amplía el rango de fechas o limpia los filtros."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/transactions">Limpiar filtros</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Send}
              title="Aún no hay transacciones"
              description="Agrega dinero a una cuenta o envía tu primera transferencia y aparecerá aquí."
            />
          )
        ) : (
          <>
            <p className="px-5 pt-4 pb-1 text-xs text-muted-foreground" aria-live="polite">
              {result.total.toLocaleString("en-US")} {result.total === 1 ? "transacción" : "transacciones"}
              {filtered ? (result.total === 1 ? " coincide con tus filtros" : " coinciden con tus filtros") : ""}
            </p>
            <TransactionList rows={result.rows} />
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              total={result.total}
              noun={result.total === 1 ? "transacción" : "transacciones"}
              hrefFor={(page) => `/transactions${queryString(params, page)}`}
            />
          </>
        )}
      </Section>
    </>
  );
}
