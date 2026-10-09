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

export const metadata: Metadata = { title: "Operations overview" };

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
  if (bps === null) return <span>No earlier period to compare</span>;
  const Icon = bps > 0n ? TrendingUp : TrendingDown;
  return (
    <span className="flex items-center gap-1">
      <span className="inline-flex items-center gap-0.5 font-medium text-foreground">
        {bps === 0n ? null : <Icon className="size-3.5" />}
        <span className="tabular">{formatBasisPoints(bps)}</span>
      </span>
      vs previous 24 hours
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
    const failed = day.failed > 0 ? `, ${formatCount(day.failed)} failed` : "";
    return { ...day, label, title: `${label}: ${pluralize(day.count, "transaction")}${failed}` };
  });
  const dailyTotal = days.reduce((sum, day) => sum + day.count, 0);
  const busiest = days.reduce((best, day) => (day.count > best.count ? day : best), days[0]);
  const dailyMax = Math.max(1, busiest.count);
  const lastDay = days.length - 1;
  const middleDay = Math.floor(days.length / 2);

  return (
    <>
      <PageHeader
        title="Operations overview"
        description="The state of the platform right now: who banks with Aldera, how much is held, what is moving, and whether the books and the audit trail still prove themselves."
      />

      <div className="grid grid-cols-1 gap-6">
        {/* Key figures */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatTile
            label="Customers"
            icon={Users}
            value={formatCount(overview.customers)}
            footer={
              <span className="text-xs text-muted-foreground">
                {overview.suspendedUsers > 0 ? `${pluralize(overview.suspendedUsers, "user")} suspended` : "No suspended users"}
              </span>
            }
          />
          <StatTile
            label="Active accounts"
            icon={Wallet}
            value={formatCount(overview.activeAccounts)}
            footer={
              <span className="text-xs text-muted-foreground">
                {overview.frozenAccounts > 0 ? `${pluralize(overview.frozenAccounts, "account")} frozen` : "No frozen accounts"}
              </span>
            }
          />
          <StatTile
            label="Customer deposits held"
            icon={Landmark}
            value={formatMoney(overview.depositsBaseMinor, BASE_CURRENCY)}
            footer={<span className="text-xs text-muted-foreground">Across all customer accounts · {BASE_CURRENCY} equivalent</span>}
          />
          <StatTile
            label="Transactions · 24 hours"
            icon={Activity}
            value={formatCount(overview.last24h.count)}
            footer={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span>
                  <span className="tabular">{formatMoney(overview.last24h.volumeBaseMinor, BASE_CURRENCY)}</span> volume
                </span>
                <Change current={overview.last24h.count} previous={overview.previous24h.count} />
              </span>
            }
          />
          <StatTile
            label="Awaiting review"
            icon={Clock}
            value={formatCount(overview.awaitingReview.count)}
            footer={
              <span className="text-xs text-muted-foreground">
                {overview.awaitingReview.count > 0 ? (
                  <>
                    <span className="tabular">{formatMoney(overview.awaitingReview.valueBaseMinor, BASE_CURRENCY)}</span> reserved
                    {overview.awaitingReview.oldestAt ? ` · oldest submitted ${relativeInline(overview.awaitingReview.oldestAt, now)}` : null}
                  </>
                ) : (
                  "Nothing is waiting for a decision"
                )}
              </span>
            }
          />
          <StatTile
            label="In transit"
            icon={CircleDashed}
            value={formatCount(overview.inTransit.count)}
            footer={
              <span className="text-xs text-muted-foreground">
                {overview.inTransit.count > 0 ? (
                  <>
                    <span className="tabular">{formatMoney(overview.inTransit.valueBaseMinor, BASE_CURRENCY)}</span> on the way to
                    receiving banks
                  </>
                ) : (
                  "Nothing is in transit"
                )}
              </span>
            }
          />
        </div>

        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
          <div className="grid grid-cols-1 gap-6 xl:col-span-2">
            {/* Ledger integrity */}
            <Section
              title="Ledger integrity"
              description={`Recalculated from the raw ledger entries · ${formatDateTime(ledger.checkedAt)}`}
            >
              {ledger.healthy ? (
                <Callout tone="success" icon={ShieldCheck} title="The ledger is balanced">
                  Every movement of money is recorded twice, as a debit on one account and an equal credit on another, so matching
                  totals and a zero net balance prove that no money has been created or lost.
                </Callout>
              ) : (
                <Callout tone="danger" icon={ShieldAlert} title="The ledger needs attention">
                  At least one check below did not pass, which means the recorded entries no longer fully explain the balances and
                  should be investigated before more money moves.
                </Callout>
              )}

              <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-3">
                <IntegrityCheck label="Ledger entries" value={formatCount(ledger.entryCount)} note="Every entry was re-read" />
                <IntegrityCheck
                  label="Unbalanced transactions"
                  value={formatCount(ledger.unbalancedTransactions)}
                  passed={ledger.unbalancedTransactions === 0}
                  note={ledger.unbalancedTransactions === 0 ? "Every transaction balances" : "Debits and credits differ"}
                />
                <IntegrityCheck
                  label="Drifted accounts"
                  value={formatCount(ledger.driftedAccounts)}
                  passed={ledger.driftedAccounts === 0}
                  note={ledger.driftedAccounts === 0 ? "Every balance matches its entries" : "Balance differs from its entries"}
                />
              </dl>

              {ledger.currencies.length > 0 ? (
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  {ledger.currencies.map((totals) => (
                    <CurrencyProof
                      key={totals.currency}
                      currency={totals.currency}
                      rows={[
                        { label: "Total debits", minor: totals.debitMinor },
                        { label: "Total credits", minor: totals.creditMinor },
                      ]}
                      result={{ label: "Net of all balances", minor: totals.netBalanceMinor }}
                      passed={totals.debitMinor === totals.creditMinor && totals.netBalanceMinor === 0n}
                    />
                  ))}
                </div>
              ) : null}
            </Section>

            {/* Review queue */}
            <Section
              title="Review queue"
              description={
                queue.total > 0 ? `${pluralize(queue.total, "transfer")} waiting for a decision` : "Transfers held for a decision by operations"
              }
              flush
              action={
                <Button asChild variant="link" size="sm" className="h-auto p-0">
                  <Link href="/admin/transactions?status=pending">View all</Link>
                </Button>
              }
            >
              {queue.rows.length === 0 ? (
                <EmptyState
                  icon={ListChecks}
                  title="Nothing to review"
                  description="External transfers above the review threshold wait here until someone approves or rejects them."
                />
              ) : (
                <TransactionList rows={queue.rows} staff compact basePath="/admin/transactions" />
              )}
            </Section>
          </div>

          <div className="grid grid-cols-1 gap-6">
            {/* Audit chain */}
            <Section
              title="Audit chain"
              action={
                <Button asChild variant="link" size="sm" className="h-auto p-0">
                  <Link href="/admin/audit">Audit log</Link>
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
                    {chain.valid ? `Intact · ${pluralize(chain.checked, "record")} verified` : `Broken at record #${chain.brokenAtSeq}`}
                  </p>
                  <p className="mt-0.5 text-[0.8125rem] leading-snug text-pretty text-muted-foreground">
                    {chain.valid
                      ? "Each record carries the hash of the one before it, so an edited or deleted record would break the chain."
                      : `${pluralize(chain.checked, "record")} checked. This record no longer matches its stored hash or its link to the record before it.`}
                  </p>
                </div>
              </div>
            </Section>

            {/* Transactions by status */}
            <Section
              title="Transactions by status"
              description={`${pluralize(statusTotal, "transaction")} to date`}
              action={
                <Button asChild variant="link" size="sm" className="h-auto p-0">
                  <Link href="/admin/transactions">Monitoring</Link>
                </Button>
              }
            >
              {statusTotal === 0 ? (
                <EmptyState icon={CircleDashed} title="No transactions yet" description="The split by status will appear here once money starts moving." className="py-8" />
              ) : (
                <>
                  <div
                    role="img"
                    aria-label={`Share of transactions by status. ${statuses.map((s) => `${s.label}: ${formatCount(s.count)}`).join(", ")}.`}
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
                  <ul aria-label="Legend" className="mt-4 grid gap-2">
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
            <Section title="Activity, last 14 days" description="Transactions created per day">
              {dailyTotal === 0 ? (
                <EmptyState icon={Activity} title="No activity yet" description="Daily volumes will appear here once money starts moving." className="py-8" />
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    <span className="text-sm font-medium text-foreground">{formatCount(dailyTotal)}</span> in total · busiest day{" "}
                    {busiest.label} with {formatCount(busiest.count)}
                  </p>
                  <ol aria-label="Transactions per day" className="mt-4 flex h-24 border-b border-chart-axis">
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
          title="Recent audit activity"
          description="The latest records written to the audit log"
          flush
          action={
            <Button asChild variant="link" size="sm" className="h-auto p-0">
              <Link href="/admin/audit">View all</Link>
            </Button>
          }
        >
          {audit.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No audit records yet"
              description="Sign-ins, money movements and operations actions are recorded here as they happen."
            />
          ) : (
            <ul className="divide-y divide-border/70 border-t border-border/70">
              {audit.map((record) => (
                <li
                  key={record.seq}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 md:grid-cols-[14.5rem_minmax(0,1fr)_minmax(0,11rem)_6.5rem]"
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
