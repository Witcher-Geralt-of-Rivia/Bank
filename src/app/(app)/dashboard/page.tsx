import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowUpRight,
  CircleDashed,
  Clock,
  Plus,
  Send,
  ShieldAlert,
  ShieldCheck,
  Snowflake,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType } from "react";
import { AccountCard } from "@/components/banking/account-card";
import { FundingDialog } from "@/components/banking/funding-dialog";
import { CashFlowChart } from "@/components/charts/cash-flow-chart";
import { EmptyState, Section, StatTile } from "@/components/shared/page";
import { TransactionList } from "@/components/transactions/transaction-list";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { formatBasisPoints, formatLongDate, formatMonth, formatMonthYear, formatRelative, initials, pluralize } from "@/lib/format";
import {
  BASE_CURRENCY,
  changeInBasisPoints,
  formatIndicativeRate,
  formatMoney,
  formatMoneyCompact,
  toApproximateNumber,
} from "@/lib/money";
import { niceScale } from "@/lib/scale";
import { cn } from "@/lib/utils";
import { requireCustomer } from "@/server/auth/session";
import { listAccountsForUser, summariseBalances } from "@/server/queries/accounts";
import { getFlowComparison, getMonthlyCashFlow } from "@/server/queries/analytics";
import { getOpenTransferCounts, listBeneficiaries, listSignInActivity } from "@/server/queries/misc";
import { recentTransactionsForUser } from "@/server/queries/transactions";

export const metadata: Metadata = { title: "Overview" };

function Delta({ bps, upIsGood }: { bps: bigint | null; upIsGood: boolean }) {
  if (bps === null) return <span className="text-xs text-muted-foreground">No earlier period to compare</span>;
  const up = bps > 0n;
  const flat = bps === 0n;
  const good = flat ? null : up === upIsGood;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className={cn("inline-flex items-center gap-0.5 font-medium", good === true && "text-success", good === false && "text-danger")}>
        {flat ? null : <Icon className="size-3.5" />}
        <span className="tabular">{formatBasisPoints(bps)}</span>
      </span>
      vs previous 30 days
    </span>
  );
}

type Notice = {
  key: string;
  tone: "warning" | "info" | "danger" | "success";
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
  href: string;
  action: string;
};

const NOTICE_TONES = {
  warning: "bg-warning-soft text-warning",
  info: "bg-info-soft text-info",
  danger: "bg-danger-soft text-danger",
  success: "bg-success-soft text-success",
} as const;

export default async function DashboardPage() {
  const user = await requireCustomer();
  const db = await getDb();
  const now = new Date();

  const [accounts, flow, months, recent, beneficiaries, signIns] = await Promise.all([
    listAccountsForUser(db, user.id),
    getFlowComparison(db, user.id, 30, now),
    getMonthlyCashFlow(db, user.id, 6, now),
    recentTransactionsForUser(db, user.id, 7),
    listBeneficiaries(db, user.id),
    listSignInActivity(db, user.id, 12),
  ]);
  const open = await getOpenTransferCounts(db, accounts.map((a) => a.id));
  const summary = summariseBalances(accounts);
  const multiCurrency = summary.byCurrency.length > 1;

  const fundingAccounts = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    number: a.number,
    currency: a.currency,
    availableMinor: a.availableMinor.toString(),
    usable: a.status === "active",
  }));

  // --- cash-flow chart ---
  const chartMax = Math.max(1, ...months.map((m) => Math.max(toApproximateNumber(m.inMinor, BASE_CURRENCY), toApproximateNumber(m.outMinor, BASE_CURRENCY))));
  const tickLabels = Object.fromEntries(
    niceScale(chartMax, 4).ticks.map((tick) => [String(tick), formatMoneyCompact(BigInt(Math.round(tick * 100)), BASE_CURRENCY)]),
  );
  const chartData = months.map((m) => ({
    label: formatMonth(m.month),
    title: formatMonthYear(m.month),
    inValue: toApproximateNumber(m.inMinor, BASE_CURRENCY),
    outValue: toApproximateNumber(m.outMinor, BASE_CURRENCY),
    inText: formatMoney(m.inMinor, BASE_CURRENCY),
    outText: formatMoney(m.outMinor, BASE_CURRENCY),
    netText: formatMoney(m.inMinor - m.outMinor, BASE_CURRENCY, { sign: "always" }),
    partial: m.isCurrent,
  }));
  const hasActivity = months.some((m) => m.inMinor > 0n || m.outMinor > 0n);

  // --- notices ---
  const notices: Notice[] = [];
  if (open.pending > 0) {
    const held = [...open.pendingByCurrency].map(([currency, total]) => formatMoney(total, currency)).join(" and ");
    notices.push({
      key: "pending",
      tone: "warning",
      icon: Clock,
      title: `${pluralize(open.pending, "transfer")} awaiting review`,
      body: `${held} is reserved until our operations team makes a decision.`,
      href: "/transactions?status=pending",
      action: "View",
    });
  }
  if (open.processing > 0) {
    notices.push({
      key: "processing",
      tone: "info",
      icon: CircleDashed,
      title: `${pluralize(open.processing, "transfer")} in transit`,
      body: "On the way to the receiving bank. External transfers usually settle within one business day.",
      href: "/transactions?status=processing",
      action: "Track",
    });
  }
  const frozen = accounts.filter((a) => a.status === "frozen");
  if (frozen.length > 0) {
    notices.push({
      key: "frozen",
      tone: "info",
      icon: Snowflake,
      title: `${frozen[0].name} is frozen`,
      body: "This account cannot send or receive funds. Contact support for details.",
      href: `/accounts/${frozen[0].id}`,
      action: "Details",
    });
  }
  const failedSignIn = signIns.find((s) => !s.success && now.getTime() - s.at.getTime() < 7 * 24 * 60 * 60 * 1000);
  if (failedSignIn) {
    notices.push({
      key: "signin",
      tone: "danger",
      icon: ShieldAlert,
      title: "Blocked sign-in attempt",
      body: `Someone entered a wrong password for your profile ${formatRelative(failedSignIn.at, now).toLowerCase()}. If this wasn't you, change your password.`,
      href: "/settings?tab=security",
      action: "Review",
    });
  }
  if (!user.twoFactorEnabled) {
    notices.push({
      key: "2fa",
      tone: "warning",
      icon: ShieldCheck,
      title: "Two-step verification is off",
      body: "Add a second layer of protection to your sign-in.",
      href: "/settings?tab=security",
      action: "Turn on",
    });
  }

  return (
    <div className="grid gap-6">
      {/* Greeting */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{formatLongDate(now)}</p>
          <h1 className="heading mt-1 text-2xl sm:text-[1.75rem] sm:leading-9">Welcome back, {user.name.split(" ")[0]}</h1>
        </div>
        <div className="flex gap-2">
          <FundingDialog accounts={fundingAccounts}>
            <Button variant="outline" size="lg" className="flex-1 sm:flex-none">
              <Plus /> Add money
            </Button>
          </FundingDialog>
          <Button asChild size="lg" className="flex-1 sm:flex-none">
            <Link href="/transfers/new">
              <Send /> Send money
            </Link>
          </Button>
        </div>
      </div>

      {/* Total balance */}
      <section
        aria-label="Total balance"
        className="relative overflow-hidden rounded-2xl bg-sidebar p-6 text-sidebar-foreground shadow-raised sm:p-8"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-sidebar-primary/10 blur-3xl"
        />
        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="eyebrow text-sidebar-muted">Total balance{multiCurrency ? ` · ${BASE_CURRENCY} equivalent` : ""}</p>
            <p className="mt-3 text-[2.75rem] leading-none font-semibold tracking-[-0.03em] sm:text-[3.5rem]">
              {formatMoney(summary.totalBaseMinor, BASE_CURRENCY)}
            </p>
            <p className="mt-3 text-sm text-sidebar-muted">
              Across {pluralize(accounts.length, "account")}
              {summary.heldBaseMinor > 0n ? (
                <>
                  {" "}
                  · <span className="text-sidebar-foreground">{formatMoney(summary.heldBaseMinor, BASE_CURRENCY)}</span> reserved for pending
                  transfers
                </>
              ) : null}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:flex sm:gap-10">
            {summary.byCurrency.map((bucket) => (
              <div key={bucket.currency}>
                <dt className="text-xs text-sidebar-muted">
                  {bucket.currency} · {pluralize(bucket.accounts, "account")}
                </dt>
                <dd className="tabular mt-1 text-lg font-medium">{formatMoney(bucket.postedMinor, bucket.currency)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Key figures */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Available balance"
          icon={ArrowDownToLine}
          value={formatMoney(summary.availableBaseMinor, BASE_CURRENCY)}
          footer={<span className="text-xs text-muted-foreground">Ready to spend or transfer now</span>}
        />
        <StatTile
          label="Money in · 30 days"
          icon={ArrowDownLeft}
          value={formatMoney(flow.current.inMinor, BASE_CURRENCY)}
          footer={<Delta bps={changeInBasisPoints(flow.current.inMinor, flow.previous.inMinor)} upIsGood />}
        />
        <StatTile
          label="Money out · 30 days"
          icon={ArrowUpRight}
          value={formatMoney(flow.current.outMinor, BASE_CURRENCY)}
          footer={<Delta bps={changeInBasisPoints(flow.current.outMinor, flow.previous.outMinor)} upIsGood={false} />}
        />
        <StatTile
          label="Transactions · 30 days"
          icon={CircleDashed}
          value={flow.current.count.toLocaleString("en-US")}
          footer={
            <span className="text-xs text-muted-foreground">
              <span className="tabular">{formatMoney(flow.current.volumeMinor, BASE_CURRENCY)}</span> total volume
            </span>
          }
        />
      </div>

      {/* Accounts */}
      <section aria-labelledby="accounts-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="accounts-heading" className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
            Accounts
          </h2>
          <Button asChild variant="link" size="sm" className="h-auto p-0">
            <Link href="/accounts">View all</Link>
          </Button>
        </div>
        <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-4">
          {accounts.map((account) => (
            <AccountCard key={account.id} account={account} className="snap-start" />
          ))}
        </div>
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="grid gap-6 xl:col-span-2">
        {/* Cash flow */}
        <Section
          title="Cash flow"
          description="Money entering and leaving your accounts, last 6 months"
          action={
            <Button asChild variant="link" size="sm" className="h-auto p-0">
              <Link href="/insights">Insights</Link>
            </Button>
          }
        >
          {hasActivity ? (
            <CashFlowChart
              data={chartData}
              formatTick={tickLabels}
              currencyNote={
                multiCurrency
                  ? `Shown in ${BASE_CURRENCY}. EUR converted at an indicative 1 EUR = ${formatIndicativeRate("EUR")} USD. Transfers between your own accounts are excluded.`
                  : "Transfers between your own accounts are excluded."
              }
            />
          ) : (
            <EmptyState icon={CircleDashed} title="No activity yet" description="Your cash flow will appear here once money starts moving through your accounts." />
          )}
        </Section>

        {/* Recent transactions */}
        <Section
          title="Recent transactions"
          flush
          action={
            <Button asChild variant="link" size="sm" className="h-auto p-0">
              <Link href="/transactions">View all</Link>
            </Button>
          }
        >
          {recent.length === 0 ? (
            <EmptyState
              icon={ArrowDownToLine}
              title="No transactions yet"
              description="Add money to your account to get started. Every movement will be listed here."
            />
          ) : (
            <TransactionList rows={recent} showYear={false} compact />
          )}
        </Section>

        </div>
        <div className="grid gap-6">
        {/* Notices */}
        <Section title="Needs your attention" description="Security and account notices">
          {notices.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="You're all set" description="No transfers are waiting and your security settings look good." className="py-8" />
          ) : (
            <ul className="-my-1 divide-y divide-border/70">
              {notices.map((notice) => (
                <li key={notice.key} className="flex gap-3 py-3.5">
                  <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", NOTICE_TONES[notice.tone])}>
                    <notice.icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{notice.title}</p>
                    <p className="mt-0.5 text-[0.8125rem] leading-snug text-pretty text-muted-foreground">{notice.body}</p>
                    <Link
                      href={notice.href}
                      className="mt-1.5 inline-block text-[0.8125rem] font-medium text-accent-foreground underline-offset-4 outline-none hover:underline focus-visible:underline"
                    >
                      {notice.action}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
        {/* Quick transfer */}
        <Section title="Quick transfer" description="Send to someone you pay often">
          {beneficiaries.length === 0 ? (
            <EmptyState
              icon={Send}
              title="No beneficiaries yet"
              description="Save the people and businesses you pay to send money in a couple of taps."
              className="py-8"
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/beneficiaries">Add a beneficiary</Link>
                </Button>
              }
            />
          ) : (
            <>
              <ul className="-mx-2 grid gap-0.5">
                {beneficiaries.slice(0, 5).map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/transfers/new?to=${b.id}`}
                      className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors outline-none hover:bg-muted focus-visible:bg-muted"
                    >
                      <Avatar className="size-9">
                        <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">{initials(b.name)}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{b.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {b.nickname ?? b.bankName} · {b.currency}
                        </span>
                      </span>
                      <Send className="size-4 text-muted-foreground/50 transition-colors group-hover:text-primary" />
                    </Link>
                  </li>
                ))}
              </ul>
              <Button asChild variant="outline" className="mt-4 w-full">
                <Link href="/transfers/new">New transfer</Link>
              </Button>
            </>
          )}
        </Section>
        </div>
      </div>
    </div>
  );
}
