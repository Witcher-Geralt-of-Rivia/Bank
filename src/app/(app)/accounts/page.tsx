import { ChevronRight, Plus, Send, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FundingDialog } from "@/components/banking/funding-dialog";
import { Money } from "@/components/shared/money";
import { EmptyState, PageHeader, Section } from "@/components/shared/page";
import { AccountStatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { ACCOUNT_TYPE_LABELS, maskAccountNumber } from "@/lib/domain";
import { formatDate, pluralize } from "@/lib/format";
import { BASE_CURRENCY, CURRENCIES, formatIndicativeRate, formatMoney } from "@/lib/money";
import { requireCustomer } from "@/server/auth/session";
import { listAccountsForUser, summariseBalances } from "@/server/queries/accounts";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const user = await requireCustomer();
  const db = await getDb();
  const accounts = await listAccountsForUser(db, user.id);
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

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Balances are calculated from the ledger: the current balance is every posted entry, and the available balance subtracts funds reserved for transfers under review."
        actions={
          <>
            <FundingDialog accounts={fundingAccounts}>
              <Button variant="outline" size="lg">
                <Plus /> Add money
              </Button>
            </FundingDialog>
            <Button asChild size="lg">
              <Link href="/transfers/new">
                <Send /> Send money
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-card p-5 shadow-card ring-1 ring-foreground/[0.07]">
          <p className="text-sm text-muted-foreground">Total balance{multiCurrency ? ` · ${BASE_CURRENCY} equivalent` : ""}</p>
          <p className="heading mt-2 text-2xl">{formatMoney(summary.totalBaseMinor, BASE_CURRENCY)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{pluralize(accounts.length, "account")}</p>
        </div>
        <div className="rounded-xl bg-card p-5 shadow-card ring-1 ring-foreground/[0.07]">
          <p className="text-sm text-muted-foreground">Available now</p>
          <p className="heading mt-2 text-2xl">{formatMoney(summary.availableBaseMinor, BASE_CURRENCY)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {summary.heldBaseMinor > 0n ? `${formatMoney(summary.heldBaseMinor, BASE_CURRENCY)} reserved for pending transfers` : "Nothing reserved"}
          </p>
        </div>
        <div className="rounded-xl bg-card p-5 shadow-card ring-1 ring-foreground/[0.07]">
          <p className="text-sm text-muted-foreground">By currency</p>
          <dl className="mt-2 grid gap-1">
            {summary.byCurrency.map((bucket) => (
              <div key={bucket.currency} className="flex items-baseline justify-between gap-3">
                <dt className="text-sm">{CURRENCIES[bucket.currency].name}</dt>
                <dd className="tabular text-sm font-medium">{formatMoney(bucket.postedMinor, bucket.currency)}</dd>
              </div>
            ))}
          </dl>
          {multiCurrency ? (
            <p className="mt-2 text-xs text-muted-foreground">Indicative rate: 1 EUR = {formatIndicativeRate("EUR")} USD</p>
          ) : null}
        </div>
      </div>

      <Section flush>
        {accounts.length === 0 ? (
          <EmptyState icon={Wallet} title="No accounts yet" description="Your accounts will appear here once they are opened." />
        ) : (
          <ul className="divide-y divide-border/70">
            {accounts.map((account) => (
              <li key={account.id}>
                <Link
                  href={`/accounts/${account.id}`}
                  className="group grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-4 transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/60 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-xs font-semibold tracking-wide text-accent-foreground">
                      {account.currency}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{account.name}</span>
                      <span className="tabular block truncate text-xs text-muted-foreground">
                        {ACCOUNT_TYPE_LABELS[account.type]} · {maskAccountNumber(account.number)}
                        <span className="hidden lg:inline"> · Opened {formatDate(account.createdAt)}</span>
                      </span>
                    </span>
                  </div>

                  <div className="hidden md:block">
                    <AccountStatusBadge status={account.status} />
                  </div>

                  <div className="hidden text-right md:block">
                    <p className="text-xs text-muted-foreground">Available</p>
                    <Money minor={account.availableMinor} currency={account.currency} className="text-sm" />
                  </div>

                  <div className="text-right">
                    <p className="hidden text-xs text-muted-foreground md:block">Current balance</p>
                    <Money minor={account.postedMinor} currency={account.currency} className="font-semibold md:text-sm" />
                    <div className="mt-0.5 md:hidden">
                      {account.status !== "active" ? (
                        <AccountStatusBadge status={account.status} />
                      ) : account.heldMinor > 0n ? (
                        <span className="text-xs text-muted-foreground">
                          <Money minor={account.availableMinor} currency={account.currency} /> available
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <ChevronRight className="hidden size-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 md:block" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
