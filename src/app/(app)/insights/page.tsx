import { ArrowDownLeft, ArrowUpRight, ChartColumn, Scale, TrendingDown, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import type { ComponentType, ReactNode } from "react";
import { BalanceTrendChart } from "@/components/charts/balance-trend-chart";
import { CashFlowChart } from "@/components/charts/cash-flow-chart";
import { Money } from "@/components/shared/money";
import { EmptyState, PageHeader, Section } from "@/components/shared/page";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getDb } from "@/db/client";
import { categoryLabel } from "@/lib/domain";
import { formatDate, formatMonth, formatMonthYear, formatShortDate, initials, pluralize } from "@/lib/format";
import {
  BASE_CURRENCY,
  formatIndicativeRate,
  formatMoney,
  formatMoneyCompact,
  mulDiv,
  toApproximateNumber,
} from "@/lib/money";
import { niceRange, niceScale } from "@/lib/scale";
import { requireCustomer } from "@/server/auth/session";
import { listAccountsForUser } from "@/server/queries/accounts";
import {
  type CounterpartyTotal,
  getBalanceTrend,
  getFlowComparison,
  getMonthlyCashFlow,
  getSpendingByCategory,
  getTopCounterparties,
} from "@/server/queries/analytics";

export const metadata: Metadata = { title: "Insights" };

function Figure({
  label,
  icon: Icon,
  value,
  note,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  value: ReactNode;
  note: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-card p-5 shadow-card ring-1 ring-foreground/[0.07]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="size-4 text-muted-foreground/70" />
      </div>
      <p className="heading mt-3 text-2xl">{value}</p>
      <p className="mt-1.5 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function CounterpartyList({ rows, sign }: { rows: CounterpartyTotal[]; sign: "in" | "out" }) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nothing in this period.</p>;
  }
  return (
    <ul className="-my-1 divide-y divide-border/70">
      {rows.map((row) => (
        <li key={row.name} className="flex items-center gap-3 py-3">
          <Avatar className="size-9">
            <AvatarFallback className="bg-muted text-xs font-semibold text-muted-foreground">{initials(row.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{row.name}</p>
            <p className="text-xs text-muted-foreground">
              {pluralize(row.count, "payment")} · last {formatShortDate(row.lastAt)}
            </p>
          </div>
          <Money
            minor={sign === "in" ? row.totalMinor : -row.totalMinor}
            currency={BASE_CURRENCY}
            sign="always"
            tone="flow"
            className="text-sm font-medium"
          />
        </li>
      ))}
    </ul>
  );
}

export default async function InsightsPage() {
  const user = await requireCustomer();
  const db = await getDb();
  const now = new Date();

  const [accounts, flow, months, categories, payees, payers, trend] = await Promise.all([
    listAccountsForUser(db, user.id),
    getFlowComparison(db, user.id, 90, now),
    getMonthlyCashFlow(db, user.id, 6, now),
    getSpendingByCategory(db, user.id, 90, now),
    getTopCounterparties(db, user.id, "out", 90, 5, now),
    getTopCounterparties(db, user.id, "in", 90, 5, now),
    getBalanceTrend(db, user.id, 90, now),
  ]);

  const multiCurrency = new Set(accounts.map((a) => a.currency)).size > 1;
  const hasActivity = months.some((m) => m.inMinor > 0n || m.outMinor > 0n);
  const net = flow.current.inMinor - flow.current.outMinor;
  const note = multiCurrency
    ? `All figures in ${BASE_CURRENCY}; EUR converted at an indicative 1 EUR = ${formatIndicativeRate("EUR")} USD. Transfers between your own accounts are excluded.`
    : "Transfers between your own accounts are excluded.";

  // --- cash-flow chart ---
  const flowMax = Math.max(1, ...months.map((m) => Math.max(toApproximateNumber(m.inMinor, BASE_CURRENCY), toApproximateNumber(m.outMinor, BASE_CURRENCY))));
  const flowTicks = Object.fromEntries(
    niceScale(flowMax, 4).ticks.map((tick) => [String(tick), formatMoneyCompact(BigInt(Math.round(tick * 100)), BASE_CURRENCY)]),
  );
  const flowData = months.map((m) => ({
    label: formatMonth(m.month),
    title: formatMonthYear(m.month),
    inValue: toApproximateNumber(m.inMinor, BASE_CURRENCY),
    outValue: toApproximateNumber(m.outMinor, BASE_CURRENCY),
    inText: formatMoney(m.inMinor, BASE_CURRENCY),
    outText: formatMoney(m.outMinor, BASE_CURRENCY),
    netText: formatMoney(m.inMinor - m.outMinor, BASE_CURRENCY, { sign: "always" }),
    partial: m.isCurrent,
  }));

  // --- balance trend ---
  const trendData = trend.map((point) => {
    const date = new Date(`${point.date}T00:00:00.000Z`);
    return {
      value: toApproximateNumber(point.balanceMinor, BASE_CURRENCY),
      text: formatMoney(point.balanceMinor, BASE_CURRENCY),
      title: formatDate(date),
      label: formatShortDate(date),
    };
  });
  const trendValues = trendData.map((d) => d.value);
  const trendTicks =
    trendValues.length > 0
      ? Object.fromEntries(
          niceRange(Math.min(...trendValues), Math.max(...trendValues), 4).ticks.map((tick) => [
            String(tick),
            formatMoneyCompact(BigInt(Math.round(tick * 100)), BASE_CURRENCY),
          ]),
        )
      : {};
  const first = trend[0]?.balanceMinor ?? 0n;
  const last = trend[trend.length - 1]?.balanceMinor ?? 0n;
  const change = last - first;

  const largest = categories[0]?.totalMinor ?? 0n;
  const totalSpend = categories.reduce((sum, c) => sum + c.totalMinor, 0n);

  if (!hasActivity && trend.every((p) => p.balanceMinor === 0n)) {
    return (
      <>
        <PageHeader title="Insights" description="Where your money comes from and where it goes." />
        <Section>
          <EmptyState
            icon={ChartColumn}
            title="Nothing to analyse yet"
            description="Once money starts moving through your accounts, you will see your cash flow, spending by category and balance trend here."
          />
        </Section>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Insights" description="Where your money comes from and where it goes, based on settled and in-transit transactions." />

      <div className="grid gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Figure
            label="Money in · 90 days"
            icon={ArrowDownLeft}
            value={formatMoney(flow.current.inMinor, BASE_CURRENCY)}
            note={`${formatMoney(flow.previous.inMinor, BASE_CURRENCY)} in the 90 days before`}
          />
          <Figure
            label="Money out · 90 days"
            icon={ArrowUpRight}
            value={formatMoney(flow.current.outMinor, BASE_CURRENCY)}
            note={`${formatMoney(flow.previous.outMinor, BASE_CURRENCY)} in the 90 days before`}
          />
          <Figure
            label="Net cash flow · 90 days"
            icon={Scale}
            value={formatMoney(net, BASE_CURRENCY, { sign: "always" })}
            note={net >= 0n ? "More came in than went out" : "More went out than came in"}
          />
        </div>

        <Section
          title="Balance trend"
          description="Combined end-of-day balance across your accounts, last 90 days"
          action={
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {change === 0n ? null : change > 0n ? <TrendingUp className="size-3.5 text-success" /> : <TrendingDown className="size-3.5 text-danger" />}
              <span className="tabular font-medium text-foreground">{formatMoney(change, BASE_CURRENCY, { sign: "always" })}</span>
              <span className="hidden sm:inline">over the period</span>
            </span>
          }
        >
          {trendData.length > 1 ? <BalanceTrendChart data={trendData} formatTick={trendTicks} /> : null}
        </Section>

        <div className="grid items-start gap-6 xl:grid-cols-2">
          <Section title="Cash flow by month" description="Money in against money out, last 6 months">
            <CashFlowChart data={flowData} formatTick={flowTicks} />
          </Section>

          <Section title="Spending by category" description="Outgoing payments, last 90 days">
            {categories.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No outgoing payments in this period.</p>
            ) : (
              <ul className="grid gap-3.5">
                {categories.slice(0, 9).map((category) => {
                  // Bar length as a whole-number percentage of the largest category.
                  const width = largest > 0n ? Number(mulDiv(category.totalMinor, 100n, largest)) : 0;
                  const share = totalSpend > 0n ? Number(mulDiv(category.totalMinor, 1000n, totalSpend)) / 10 : 0;
                  return (
                    <li key={category.category}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="truncate font-medium">{categoryLabel(category.category)}</span>
                        <span className="shrink-0">
                          <span className="tabular font-medium">{formatMoney(category.totalMinor, BASE_CURRENCY)}</span>
                          <span className="tabular ml-2 inline-block w-11 text-right text-xs text-muted-foreground">{share.toFixed(1)}%</span>
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 rounded-full bg-chart-out/10" aria-hidden="true">
                        <div className="h-full rounded-full bg-chart-out" style={{ width: `${Math.max(width, 1.5)}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>

        <div className="grid items-start gap-6 xl:grid-cols-2">
          <Section title="Who pays you" description="Largest sources of incoming money, last 90 days">
            <CounterpartyList rows={payers} sign="in" />
          </Section>
          <Section title="Who you pay" description="Largest recipients of outgoing money, last 90 days">
            <CounterpartyList rows={payees} sign="out" />
          </Section>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">{note}</p>
      </div>
    </>
  );
}
