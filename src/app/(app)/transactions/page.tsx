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

export const metadata: Metadata = { title: "Transactions" };

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
        title="Transactions"
        description="Every movement across your accounts. Select a transaction to see its receipt, status history and ledger entries."
        actions={
          <>
            <Button asChild variant="outline" size="lg">
              <a href={`/api/transactions/export${queryString(params)}`} download>
                <Download /> Export CSV
              </a>
            </Button>
            <Button asChild size="lg">
              <Link href="/transfers/new">
                <Send /> Send money
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
              title="No transactions match these filters"
              description="Try a different search term, widen the date range or clear the filters."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/transactions">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Send}
              title="No transactions yet"
              description="Add money to an account or send your first transfer and it will appear here."
            />
          )
        ) : (
          <>
            <p className="px-5 pt-4 pb-1 text-xs text-muted-foreground" aria-live="polite">
              {result.total.toLocaleString("en-US")} {result.total === 1 ? "transaction" : "transactions"}
              {filtered ? " match your filters" : ""}
            </p>
            <TransactionList rows={result.rows} />
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              total={result.total}
              noun="transactions"
              hrefFor={(page) => `/transactions${queryString(params, page)}`}
            />
          </>
        )}
      </Section>
    </>
  );
}
