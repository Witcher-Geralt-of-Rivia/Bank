import {
  Activity,
  CircleCheck,
  CircleDashed,
  Clock,
  Landmark,
  ListChecks,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Users,
  Wallet,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuditActionPill } from "@/components/admin/audit-action";
import { CurrencyProof } from "@/components/admin/currency-proof";
import { Callout, EmptyState, PageHeader, Section, StatTile } from "@/components/shared/page";
import { type Tone, transactionStatusTone } from "@/components/shared/status";
import { TransactionList } from "@/components/transactions/transaction-list";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { TRANSACTION_STATUSES, TRANSACTION_STATUS_LABELS, isStaff } from "@/lib/domain";
import { formatBasisPoints, formatCount, formatDateTime, formatRelative, formatShortDate, pluralize } from "@/lib/format";
import { BASE_CURRENCY, changeInBasisPoints, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { verifyAuditChain } from "@/server/audit";
import { requireUser } from "@/server/auth/session";
import { checkLedgerIntegrity } from "@/server/ledger/integrity";
import { getOperationsOverview, recentAuditLogs } from "@/server/queries/admin";
import { listAllTransactions } from "@/server/queries/transactions";

export const metadata: Metadata = { title: "Resumen de operaciones" };

const WEEK = 7 * 24 * 60 * 60 * 1000;

const TONE_FILLS: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  info: "bg-info",
  danger: "bg-danger",
  neutral: "bg-neutral",
  muted: "bg-muted-foreground",
};

const shareFmt = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

/** Relative time for use mid-sentence; calendar dates keep their capital. */
function relativeInline(date: Date, now: Date): string {
  const text = formatRelative(date, now);
  return now.getTime() - date.getTime() < WEEK ? text.toLowerCase() : text;
}

/** Busier or quieter is neither good nor bad here, so the change stays in ink. */
function Change({ current, previous }: { current: number; previous: number }) {
  const bps = changeInBasisPoints(BigInt(current), BigInt(previous));
  if (bps === null) return <span>Sin periodo anterior para comparar</span>;
  const Icon = bps > 0n ? TrendingUp : TrendingDown;
  return (
    <span className="flex items-center gap-1">
      <span className="inline-flex items-center gap-0.5 font-medium text-foreground">
        {bps === 0n ? null : <Icon className="size-3.5" />}
        <span className="tabular">{formatBasisPoints(bps)}</span>
      </span>
      vs. 24 horas previas
    </span>
  );
}

/** One figure from the integrity report, with its verdict in words. */
function IntegrityCheck({
  label,
  value,
  note,
  passed,
}: {
  label: string;
  value: string;
  note: string;
  /** Omit for a plain figure that is not itself a check. */
  passed?: boolean;
}) {
  const Icon = passed === false ? TriangleAlert : CircleCheck;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1">
        <span className="block text-lg leading-6 font-semibold tracking-[-0.01em]">{value}</span>
        <span
          className={cn(
            "mt-1 flex items-center gap-1 text-xs",
            passed === undefined ? "text-muted-foreground" : passed ? "text-success" : "text-danger",
          )}
        >
          {passed === undefined ? null : <Icon className="size-3.5 shrink-0" />}
          {note}
        </span>
      </dd>
    </div>
  );
}

export default async function OperationsOverviewPage() {
  const user = await requireUser();
  if (!isStaff(user.role)) notFound();
  const db = await getDb();
  const now = new Date();

  const [overview, ledger, chain, queue, audit] = await Promise.all([
    getOperationsOverview(db, now),
    checkLedgerIntegrity(db),
    verifyAuditChain(db),
    listAllTransactions(db, { status: "pending", pageSize: 5, order: "oldest" }),
    recentAuditLogs(db, 8),
  ]);

  // --- transactions by status ---
  // Lifecycle order. It is fixed, so a segment never changes colour or place.
  const statuses = TRANSACTION_STATUSES.map((status) => ({
    status,
    label: TRANSACTION_STATUS_LABELS[status],
    count: overview.statusCounts[status],
    fill: TONE_FILLS[transactionStatusTone(status)],
  }));
  const statusTotal = statuses.reduce((sum, s) => sum + s.count, 0);

  // --- daily activity ---
  const days = overview.daily.map((day) => {
    const label = formatShortDate(new Date(`${day.date}T00:00:00.000Z`));
    const failed = day.failed > 0 ? `, ${pluralize(day.failed, "fallida")}` : "";
    return { ...day, label, title: `${label}: ${pluralize(day.count, "transacción", "transacciones")}${failed}` };
  });
  const dailyTotal = days.reduce((sum, day) => sum + day.count, 0);
  const busiest = days.reduce((best, day) => (day.count > best.count ? day : best), days[0]);
  const dailyMax = Math.max(1, busiest.count);
  const lastDay = days.length - 1;
  const middleDay = Math.floor(days.length / 2);

  return (
    <>
      <PageHeader
        title="Resumen de operaciones"
        description="El estado de la plataforma en este momento: quiénes son clientes de Aldera, cuánto dinero hay depositado, qué está en movimiento y si los libros contables y el registro de auditoría siguen demostrando su integridad."
      />

      <div className="grid grid-cols-1 gap-6">
        {/* Key figures */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatTile
            label="Clientes"
            icon={Users}
            value={formatCount(overview.customers)}
            footer={
              <span className="text-xs text-muted-foreground">
                {overview.suspendedUsers > 0
                  ? pluralize(overview.suspendedUsers, "usuario suspendido", "usuarios suspendidos")
                  : "Ningún usuario suspendido"}
              </span>
            }
          />
          <StatTile
            label="Cuentas activas"
            icon={Wallet}
            value={formatCount(overview.activeAccounts)}
            footer={
              <span className="text-xs text-muted-foreground">
                {overview.frozenAccounts > 0
                  ? pluralize(overview.frozenAccounts, "cuenta congelada", "cuentas congeladas")
                  : "Ninguna cuenta congelada"}
              </span>
            }
          />
          <StatTile
            label="Depósitos de clientes"
            icon={Landmark}
            value={formatMoney(overview.depositsBaseMinor, BASE_CURRENCY)}
            footer={<span className="text-xs text-muted-foreground">En todas las cuentas de clientes · equivalente en {BASE_CURRENCY}</span>}
          />
          <StatTile
            label="Transacciones · 24 horas"
            icon={Activity}
            value={formatCount(overview.last24h.count)}
            footer={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span>
                  <span className="tabular">{formatMoney(overview.last24h.volumeBaseMinor, BASE_CURRENCY)}</span> de volumen
                </span>
                <Change current={overview.last24h.count} previous={overview.previous24h.count} />
              </span>
            }
          />
          <StatTile
            label="En espera de revisión"
            icon={Clock}
            value={formatCount(overview.awaitingReview.count)}
            footer={
              <span className="text-xs text-muted-foreground">
                {overview.awaitingReview.count > 0 ? (
                  <>
                    <span className="tabular">{formatMoney(overview.awaitingReview.valueBaseMinor, BASE_CURRENCY)}</span> retenidos
                    {overview.awaitingReview.oldestAt ? ` · la más antigua: ${relativeInline(overview.awaitingReview.oldestAt, now)}` : null}
                  </>
                ) : (
                  "No hay nada en espera de una decisión"
                )}
              </span>
            }
          />
          <StatTile
            label="En tránsito"
            icon={CircleDashed}
            value={formatCount(overview.inTransit.count)}
            footer={
              <span className="text-xs text-muted-foreground">
                {overview.inTransit.count > 0 ? (
                  <>
                    <span className="tabular">{formatMoney(overview.inTransit.valueBaseMinor, BASE_CURRENCY)}</span> en camino a los
                    bancos receptores
                  </>
                ) : (
                  "No hay nada en tránsito"
                )}
              </span>
            }
          />
        </div>

        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
          <div className="grid grid-cols-1 gap-6 xl:col-span-2">
            {/* Ledger integrity */}
            <Section
              title="Integridad del libro mayor"
              description={`Recalculada directamente a partir de los asientos contables · ${formatDateTime(ledger.checkedAt)}`}
            >
              {ledger.healthy ? (
                <Callout tone="success" icon={ShieldCheck} title="El libro mayor está cuadrado">
                  Cada movimiento de dinero se registra dos veces: como débito en una cuenta y como crédito igual en otra. Por eso,
                  cuando los totales coinciden y el saldo neto es cero, queda demostrado que no se creó ni se perdió dinero.
                </Callout>
              ) : (
                <Callout tone="danger" icon={ShieldAlert} title="El libro mayor requiere atención">
                  Al menos una de las verificaciones de abajo no se superó. Esto significa que los asientos registrados ya no
                  explican por completo los saldos, y debe investigarse antes de que se mueva más dinero.
                </Callout>
              )}

              <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-3">
                <IntegrityCheck label="Asientos contables" value={formatCount(ledger.entryCount)} note="Se releyeron todos los asientos" />
                <IntegrityCheck
                  label="Transacciones descuadradas"
                  value={formatCount(ledger.unbalancedTransactions)}
                  passed={ledger.unbalancedTransactions === 0}
                  note={ledger.unbalancedTransactions === 0 ? "Cada transacción cuadra" : "Débitos y créditos no coinciden"}
                />
                <IntegrityCheck
                  label="Cuentas con diferencias"
                  value={formatCount(ledger.driftedAccounts)}
                  passed={ledger.driftedAccounts === 0}
                  note={ledger.driftedAccounts === 0 ? "Cada saldo coincide con sus asientos" : "El saldo no coincide con sus asientos"}
                />
              </dl>

              {ledger.currencies.length > 0 ? (
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  {ledger.currencies.map((totals) => (
                    <CurrencyProof
                      key={totals.currency}
                      currency={totals.currency}
                      rows={[
                        { label: "Total de débitos", minor: totals.debitMinor },
                        { label: "Total de créditos", minor: totals.creditMinor },
                      ]}
                      result={{ label: "Neto de todos los saldos", minor: totals.netBalanceMinor }}
                      passed={totals.debitMinor === totals.creditMinor && totals.netBalanceMinor === 0n}
                    />
                  ))}
                </div>
              ) : null}
            </Section>

            {/* Review queue */}
            <Section
              title="Cola de revisión"
              description={
                queue.total > 0
                  ? `${pluralize(queue.total, "transferencia")} en espera de una decisión`
                  : "Transferencias retenidas hasta que operaciones tome una decisión"
              }
              flush
              action={
                <Button asChild variant="link" size="sm" className="h-auto p-0">
                  <Link href="/admin/transactions?status=pending">Ver todo</Link>
                </Button>
              }
            >
              {queue.rows.length === 0 ? (
                <EmptyState
                  icon={ListChecks}
                  title="Nada por revisar"
                  description="Las transferencias externas que superan el umbral de revisión esperan aquí hasta que alguien las apruebe o las rechace."
                />
              ) : (
                <TransactionList rows={queue.rows} staff compact basePath="/admin/transactions" />
              )}
            </Section>
          </div>

          <div className="grid grid-cols-1 gap-6">
            {/* Audit chain */}
            <Section
              title="Cadena de auditoría"
              action={
                <Button asChild variant="link" size="sm" className="h-auto p-0">
                  <Link href="/admin/audit">Registro de auditoría</Link>
                </Button>
              }
            >
              <div className="flex gap-3">
                <span
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                    chain.valid ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
                  )}
                >
                  {chain.valid ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {chain.valid
                      ? `Íntegra · ${pluralize(chain.checked, "registro verificado", "registros verificados")}`
                      : `Rota en el registro #${chain.brokenAtSeq}`}
                  </p>
                  <p className="mt-0.5 text-[0.8125rem] leading-snug text-pretty text-muted-foreground">
                    {chain.valid
                      ? "Cada registro incluye el hash del anterior, de modo que un registro modificado o eliminado rompería la cadena."
                      : `${pluralize(chain.checked, "registro revisado", "registros revisados")}. Este registro ya no coincide con su hash almacenado o con su enlace al registro anterior.`}
                  </p>
                </div>
              </div>
            </Section>

            {/* Transactions by status */}
            <Section
              title="Transacciones por estado"
              description={`${pluralize(statusTotal, "transacción", "transacciones")} hasta la fecha`}
              action={
                <Button asChild variant="link" size="sm" className="h-auto p-0">
                  <Link href="/admin/transactions">Monitoreo</Link>
                </Button>
              }
            >
              {statusTotal === 0 ? (
                <EmptyState icon={CircleDashed} title="Aún no hay transacciones" description="La distribución por estado aparecerá aquí cuando empiece a moverse dinero." className="py-8" />
              ) : (
                <>
                  <div
                    role="img"
                    aria-label={`Proporción de transacciones por estado. ${statuses.map((s) => `${s.label}: ${formatCount(s.count)}`).join(", ")}.`}
                    className="flex h-3 gap-0.5"
                  >
                    {statuses
                      .filter((s) => s.count > 0)
                      .map((s) => (
                        <span
                          key={s.status}
                          title={`${s.label}: ${formatCount(s.count)} · ${shareFmt.format(s.count / statusTotal)}`}
                          className={cn("min-w-1 first:rounded-l-[4px] last:rounded-r-[4px]", s.fill)}
                          style={{ flex: `${s.count} 1 0%` }}
                        />
                      ))}
                  </div>
                  <ul aria-label="Leyenda" className="mt-4 grid gap-2">
                    {statuses.map((s) => (
                      <li key={s.status} className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className={cn("size-2.5 shrink-0 rounded-[3px]", s.fill)} aria-hidden="true" />
                          <span className="truncate">{s.label}</span>
                        </span>
                        <span className="tabular font-medium">{formatCount(s.count)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Section>

            {/* Daily activity */}
            <Section title="Actividad de los últimos 14 días" description="Transacciones creadas por día">
              {dailyTotal === 0 ? (
                <EmptyState icon={Activity} title="Aún no hay actividad" description="Los volúmenes diarios aparecerán aquí cuando empiece a moverse dinero." className="py-8" />
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    <span className="text-sm font-medium text-foreground">{formatCount(dailyTotal)}</span> en total · día más activo:{" "}
                    {busiest.label}, con {formatCount(busiest.count)}
                  </p>
                  <ol aria-label="Transacciones por día" className="mt-4 flex h-24 border-b border-chart-axis">
                    {days.map((day) => (
                      <li
                        key={day.date}
                        title={day.title}
                        className="flex min-w-0 flex-1 items-end justify-center rounded-t-md px-[3px] transition-colors hover:bg-foreground/[0.04]"
                      >
                        <span
                          aria-hidden="true"
                          className={cn("w-full max-w-6 rounded-t-[4px] bg-chart-in", day.count > 0 && "min-h-0.5")}
                          style={{ height: `${(day.count / dailyMax) * 100}%` }}
                        />
                        <span className="sr-only">{day.title}</span>
                      </li>
                    ))}
                  </ol>
                  <div aria-hidden="true" className="mt-1.5 flex text-[11px] leading-4 text-muted-foreground">
                    {days.map((day, index) => (
                      <span
                        key={day.date}
                        className={cn(
                          "tabular flex min-w-0 flex-1 whitespace-nowrap",
                          index === 0 ? "justify-start" : index === lastDay ? "justify-end" : "justify-center",
                        )}
                      >
                        {index === 0 || index === middleDay || index === lastDay ? day.label : null}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </Section>
          </div>
        </div>

        {/* Recent audit activity */}
        <Section
          title="Actividad de auditoría reciente"
          description="Los registros de auditoría más recientes"
          flush
          action={
            <Button asChild variant="link" size="sm" className="h-auto p-0">
              <Link href="/admin/audit">Ver todo</Link>
            </Button>
          }
        >
          {audit.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="Aún no hay registros de auditoría"
              description="Los inicios de sesión, los movimientos de dinero y las acciones de operaciones se registran aquí a medida que ocurren."
            />
          ) : (
            <ul className="divide-y divide-border/70 border-t border-border/70">
              {audit.map((record) => (
                <li
                  key={record.seq}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 md:grid-cols-[16.5rem_minmax(0,1fr)_minmax(0,11rem)_7rem]"
                >
                  <AuditActionPill action={record.action} />
                  <span className="tabular text-xs text-muted-foreground md:order-last md:text-right">
                    {formatRelative(record.createdAt, now)}
                  </span>
                  <span className="col-span-2 truncate text-sm md:col-span-1">{record.summary}</span>
                  <span className="col-span-2 truncate text-xs text-muted-foreground md:col-span-1 md:text-sm">{record.actorLabel}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
