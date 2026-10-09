import { ChevronDown, ListChecks, Search, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, PageHeader, Pagination, Section } from "@/components/shared/page";
import { TransactionList } from "@/components/transactions/transaction-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDb } from "@/db/client";
import {
  TRANSACTION_STATUSES,
  TRANSACTION_STATUS_LABELS,
  TRANSACTION_TYPES,
  TRANSACTION_TYPE_LABELS,
  type TransactionStatus,
  isStaff,
} from "@/lib/domain";
import { formatCount, pluralize, toIsoDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { getOperationsOverview } from "@/server/queries/admin";
import { listAllTransactions, parseTransactionFilters } from "@/server/queries/transactions";

export const metadata: Metadata = { title: "Monitoreo de transacciones" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const BASE_PATH = "/admin/transactions";
const DAY = 24 * 60 * 60 * 1000;

/** The filters in force, as they are written in the URL. */
type Applied = Record<"q" | "type" | "status" | "account" | "from" | "to", string | undefined>;

/** Link to this page with the applied filters kept and some of them replaced. */
function hrefWith(applied: Applied, changes: Partial<Applied> & { page?: number } = {}): string {
  const { page, ...filters } = changes;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...applied, ...filters })) {
    if (value) params.set(key, value);
  }
  if (page && page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${BASE_PATH}?${query}` : BASE_PATH;
}

export default async function AdminTransactionsPage({ searchParams }: Props) {
  const user = await requireUser();
  if (!isStaff(user.role)) notFound();
  const db = await getDb();

  const filters = parseTransactionFilters(await searchParams);
  const [result, overview] = await Promise.all([listAllTransactions(db, filters), getOperationsOverview(db)]);

  // Only validated values are carried from one link to the next.
  const applied: Applied = {
    q: filters.q,
    type: filters.type,
    status: filters.status,
    account: filters.accountId,
    from: filters.from ? toIsoDate(filters.from) : undefined,
    // The parsed upper bound is exclusive; the URL holds the inclusive day.
    to: filters.to ? toIsoDate(new Date(filters.to.getTime() - DAY)) : undefined,
  };
  const filtered = Object.values(applied).some(Boolean);

  const tabs: { status: TransactionStatus | undefined; label: string; count: number }[] = [
    { status: undefined, label: "Todas", count: TRANSACTION_STATUSES.reduce((sum, status) => sum + overview.statusCounts[status], 0) },
    ...TRANSACTION_STATUSES.map((status) => ({
      status,
      label: TRANSACTION_STATUS_LABELS[status],
      count: overview.statusCounts[status],
    })),
  ];

  return (
    <>
      <PageHeader
        title="Monitoreo de transacciones"
        description="Todos los movimientos de la plataforma, de todos los clientes. Selecciona una transacción para ver sus asientos contables y su historial de estados, y para actuar sobre ella."
      />

      <div className="mb-4 flex flex-col gap-3">
        {/* Keyed by the applied filters so the fields follow the URL when a tab or "Clear" changes it. */}
        <form
          key={`${applied.q ?? ""}|${applied.type ?? ""}|${applied.status ?? ""}`}
          action={BASE_PATH}
          method="get"
          role="search"
          className="flex flex-col gap-2 sm:flex-row lg:max-w-3xl"
        >
          {(["status", "account", "from", "to"] as const).map((key) =>
            applied[key] ? <input key={key} type="hidden" name={key} value={applied[key]} /> : null,
          )}
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              name="q"
              defaultValue={applied.q ?? ""}
              maxLength={80}
              placeholder="Buscar por descripción, contraparte, referencia o ID"
              aria-label="Buscar transacciones"
              className="pl-9"
            />
          </div>
          <div className="relative sm:w-52">
            <select
              name="type"
              defaultValue={applied.type ?? ""}
              aria-label="Tipo"
              className="h-10 w-full appearance-none rounded-lg border border-input bg-card pr-9 pl-3 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
            >
              <option value="">Todos los tipos</option>
              {TRANSACTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TRANSACTION_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="outline" size="lg" className="flex-1 sm:flex-none">
              Buscar
            </Button>
            {filtered ? (
              <Button asChild variant="ghost" size="lg">
                <Link href={BASE_PATH}>Limpiar</Link>
              </Button>
            ) : null}
          </div>
        </form>

        <nav
          aria-label="Filtrar por estado"
          className="-mx-4 -my-1 flex gap-2 overflow-x-auto px-4 py-1 sm:-mx-6 sm:px-6 md:mx-0 md:flex-wrap md:px-0"
        >
          {tabs.map((tab) => {
            const active = tab.status === filters.status;
            return (
              <Link
                key={tab.label}
                href={hrefWith(applied, { status: tab.status })}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground ring-1 ring-foreground/[0.07] hover:bg-muted hover:text-foreground",
                )}
              >
                {tab.label}
                <span className={cn("tabular text-xs font-normal", active ? "text-primary-foreground/75" : "text-muted-foreground/80")}>
                  {formatCount(tab.count)}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>

      <Section flush>
        {result.rows.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="Ninguna transacción coincide con estos filtros"
              description="Prueba con otro término de búsqueda, tipo o estado, o limpia los filtros."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href={BASE_PATH}>Limpiar filtros</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={ListChecks}
              title="Aún no hay transacciones"
              description="Los movimientos aparecerán aquí en cuanto los clientes empiecen a usar sus cuentas."
            />
          )
        ) : (
          <>
            <p className="px-5 pt-4 pb-1 text-xs text-muted-foreground" aria-live="polite">
              {pluralize(result.total, "transacción", "transacciones")}
              {filtered ? (result.total === 1 ? " coincide con tus filtros" : " coinciden con tus filtros") : ""}
            </p>
            <TransactionList rows={result.rows} staff basePath={BASE_PATH} />
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              total={result.total}
              noun="transacciones"
              hrefFor={(page) => hrefWith(applied, { page })}
            />
          </>
        )}
      </Section>
    </>
  );
}
