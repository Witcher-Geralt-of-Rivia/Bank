import { ArrowDownLeft, ArrowUpRight, Minus, Plus, ReceiptText, Send, Snowflake } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FundingDialog } from "@/components/banking/funding-dialog";
import { CopyButton } from "@/components/shared/client";
import { Money } from "@/components/shared/money";
import { Callout, DetailRow, EmptyState, PageHeader, Pagination, Section } from "@/components/shared/page";
import { AccountStatusBadge, StatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { ACCOUNT_TYPE_LABELS, TRANSACTION_TYPE_LABELS, maskAccountNumber } from "@/lib/domain";
import { formatDate, formatShortDate, formatTime } from "@/lib/format";
import { CURRENCIES } from "@/lib/money";
import { requireCustomer } from "@/server/auth/session";
import { accountFlow, getAccountForUser, listStatementLines } from "@/server/queries/accounts";

export const metadata: Metadata = { title: "Account" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AccountPage({ params, searchParams }: Props) {
  const user = await requireCustomer();
  const { id } = await params;
  const query = await searchParams;
  const db = await getDb();

  // Scoped to the signed-in customer: someone else's account id is a 404.
  const account = await getAccountForUser(db, user.id, id);
  if (!account) notFound();

  const page = Number(Array.isArray(query.page) ? query.page[0] : query.page) || 1;
  const since = new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000);
  const [statement, flow] = await Promise.all([
    listStatementLines(db, account.id, { page, pageSize: 15 }),
    accountFlow(db, account.id, since),
  ]);

  const usable = account.status === "active";
  const fundingAccount = [
    {
      id: account.id,
      name: account.name,
      number: account.number,
      currency: account.currency,
      availableMinor: account.availableMinor.toString(),
      usable,
    },
  ];

  return (
    <>
      <PageHeader
        back={{ href: "/accounts", label: "Accounts" }}
        eyebrow={`${ACCOUNT_TYPE_LABELS[account.type]} · ${account.currency}`}
        title={account.name}
        actions={
          usable ? (
            <>
              <FundingDialog accounts={fundingAccount} defaultAccountId={account.id}>
                <Button variant="outline" size="lg">
                  <Plus /> Add money
                </Button>
              </FundingDialog>
              <FundingDialog accounts={fundingAccount} defaultAccountId={account.id} defaultMode="withdraw">
                <Button variant="outline" size="lg">
                  <Minus /> Withdraw
                </Button>
              </FundingDialog>
              <Button asChild size="lg">
                <Link href={`/transfers/new?from=${account.id}`}>
                  <Send /> Send
                </Link>
              </Button>
            </>
          ) : null
        }
      />

      {account.status === "frozen" ? (
        <Callout tone="info" icon={Snowflake} title="This account is frozen" className="mb-6">
          It cannot send or receive funds until our operations team restores it. Your balance is safe and your history remains available.
        </Callout>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="grid gap-6 xl:col-span-2">
          <section aria-label="Balance" className="rounded-xl bg-card p-6 shadow-card ring-1 ring-foreground/[0.07]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="eyebrow text-muted-foreground">Current balance</p>
                <p className="mt-2 text-[2.5rem] leading-none font-semibold tracking-[-0.03em] sm:text-5xl">
                  <Money minor={account.postedMinor} currency={account.currency} className="font-[inherit]" />
                </p>
              </div>
              <AccountStatusBadge status={account.status} />
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border/70 pt-5 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Available</dt>
                <dd className="mt-1 font-medium">
                  <Money minor={account.availableMinor} currency={account.currency} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Reserved</dt>
                <dd className="mt-1 font-medium">
                  <Money minor={account.heldMinor} currency={account.currency} />
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ArrowDownLeft className="size-3.5 text-success" /> In · 30 days
                </dt>
                <dd className="mt-1 font-medium">
                  <Money minor={flow.inMinor} currency={account.currency} />
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ArrowUpRight className="size-3.5" /> Out · 30 days
                </dt>
                <dd className="mt-1 font-medium">
                  <Money minor={flow.outMinor} currency={account.currency} />
                </dd>
              </div>
            </dl>
          </section>

          <Section
            title="Statement"
            description="Every entry posted to this account, with the balance it produced"
            flush
          >
            {statement.lines.length === 0 ? (
              <EmptyState
                icon={ReceiptText}
                title="No entries yet"
                description="Once money moves in or out of this account, each ledger entry will be listed here."
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/70 text-xs text-muted-foreground">
                        <th scope="col" className="h-10 pr-4 pl-5 text-left font-medium">Date</th>
                        <th scope="col" className="h-10 px-4 text-left font-medium">Description</th>
                        <th scope="col" className="hidden h-10 px-4 text-right font-medium sm:table-cell">Debit</th>
                        <th scope="col" className="hidden h-10 px-4 text-right font-medium sm:table-cell">Credit</th>
                        <th scope="col" className="h-10 px-4 text-right font-medium sm:hidden">Amount</th>
                        <th scope="col" className="h-10 pr-5 pl-4 text-right font-medium">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statement.lines.map((line) => {
                        const credit = line.direction === "credit";
                        return (
                          <tr key={line.seq} className="group relative border-b border-border/50 transition-colors last:border-0 hover:bg-muted/50">
                            <td className="py-3 pr-4 pl-5 align-top whitespace-nowrap">
                              <span className="tabular block">{formatShortDate(line.createdAt)}</span>
                              <span className="tabular block text-xs text-muted-foreground">{formatTime(line.createdAt)}</span>
                            </td>
                            <td className="max-w-[16rem] px-4 py-3 align-top">
                              <Link
                                href={`/transactions/${line.transactionId}`}
                                className="block outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring/60"
                              >
                                <span className="block truncate font-medium">{line.counterpartyName ?? line.description}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {line.memo ?? (line.counterpartyName ? line.description : TRANSACTION_TYPE_LABELS[line.type])}
                                </span>
                              </Link>
                              {line.status !== "completed" ? <StatusBadge status={line.status} className="mt-1.5 h-5 px-1.5 text-[0.6875rem]" /> : null}
                            </td>
                            <td className="hidden px-4 py-3 text-right align-top sm:table-cell">
                              {credit ? <span className="text-muted-foreground/50">—</span> : <Money minor={line.amountMinor} currency={account.currency} />}
                            </td>
                            <td className="hidden px-4 py-3 text-right align-top sm:table-cell">
                              {credit ? <Money minor={line.amountMinor} currency={account.currency} className="text-success" /> : <span className="text-muted-foreground/50">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right align-top sm:hidden">
                              <Money minor={credit ? line.amountMinor : -line.amountMinor} currency={account.currency} sign="always" tone="flow" className="font-medium" />
                            </td>
                            <td className="py-3 pr-5 pl-4 text-right align-top text-muted-foreground">
                              <Money minor={line.balanceAfterMinor} currency={account.currency} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={statement.page}
                  pageCount={statement.pageCount}
                  total={statement.total}
                  noun="entries"
                  hrefFor={(p) => `/accounts/${account.id}?page=${p}`}
                />
              </>
            )}
          </Section>
        </div>

        <Section title="Account details">
          <dl className="-my-2.5 divide-y divide-border/70">
            <DetailRow label="Account holder">{user.name}</DetailRow>
            <DetailRow label="Account number">
              <span className="inline-flex items-center gap-1.5">
                <span className="tabular font-mono text-[0.8125rem]">{maskAccountNumber(account.number)}</span>
                <CopyButton value={account.number} label="Copy full account number" />
              </span>
            </DetailRow>
            <DetailRow label="Type">{ACCOUNT_TYPE_LABELS[account.type]}</DetailRow>
            <DetailRow label="Currency">
              {CURRENCIES[account.currency].name} ({account.currency})
            </DetailRow>
            <DetailRow label="Status">
              <AccountStatusBadge status={account.status} />
            </DetailRow>
            <DetailRow label="Opened">{formatDate(account.createdAt)}</DetailRow>
            <DetailRow label="Ledger entries">{statement.total.toLocaleString("en-US")}</DetailRow>
          </dl>
          <p className="mt-5 rounded-lg bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            The full number is hidden on screen. Use the copy button to share it with someone who needs to pay you.
          </p>
        </Section>
      </div>
    </>
  );
}
