import { Send } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { countryName } from "@/components/beneficiaries/countries";
import { BeneficiaryKindPill } from "@/components/beneficiaries/kind-pill";
import { RemoveBeneficiaryButton } from "@/components/beneficiaries/remove-beneficiary-button";
import { CopyButton } from "@/components/shared/client";
import { DetailRow, EmptyState, PageHeader, Section } from "@/components/shared/page";
import { TransactionList } from "@/components/transactions/transaction-list";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { maskAccountNumber } from "@/lib/domain";
import { formatCount, formatDate, formatRelative } from "@/lib/format";
import { CURRENCIES, formatMoney } from "@/lib/money";
import { requireCustomer } from "@/server/auth/session";
import { getBeneficiary } from "@/server/queries/misc";
import { listTransactionsForUser } from "@/server/queries/transactions";

export const metadata: Metadata = { title: "Beneficiary" };

type Props = { params: Promise<{ id: string }> };

function Missing({ children }: { children: string }) {
  return <span className="font-normal text-muted-foreground">{children}</span>;
}

export default async function BeneficiaryPage({ params }: Props) {
  const user = await requireCustomer();
  const { id } = await params;
  const db = await getDb();

  // Scoped to the signed-in customer: someone else's beneficiary id is a 404.
  const beneficiary = await getBeneficiary(db, user.id, id);
  if (!beneficiary) notFound();

  const history = await listTransactionsForUser(db, user.id, { beneficiaryId: beneficiary.id, pageSize: 25 });
  const transfers = history.rows;
  const now = new Date();

  return (
    <>
      <PageHeader
        back={{ href: "/beneficiaries", label: "Beneficiaries" }}
        title={beneficiary.name}
        description={beneficiary.nickname}
        actions={
          <>
            <RemoveBeneficiaryButton id={beneficiary.id} name={beneficiary.name} />
            <Button asChild size="lg">
              <Link href={`/transfers/new?to=${beneficiary.id}`}>
                <Send /> Send money
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-3">
        {/* First in the document so it leads on phones; the side column on wide screens. */}
        <Section title="Bank details" className="xl:order-last">
          <dl className="-my-2.5 divide-y divide-border/70">
            <DetailRow label="Type">
              <BeneficiaryKindPill kind={beneficiary.kind} />
            </DetailRow>
            <DetailRow label="Bank">{beneficiary.bankName}</DetailRow>
            <DetailRow label="Account number">
              <span className="inline-flex items-center gap-1.5">
                <span className="tabular font-mono text-[0.8125rem]">{maskAccountNumber(beneficiary.accountNumber)}</span>
                <CopyButton value={beneficiary.accountNumber} label="Copy full account number" />
              </span>
            </DetailRow>
            <DetailRow label="Routing / SWIFT">
              {beneficiary.routingCode ? (
                <span className="tabular font-mono text-[0.8125rem]">{beneficiary.routingCode}</span>
              ) : (
                <Missing>{beneficiary.kind === "internal" ? "Not required" : "Not provided"}</Missing>
              )}
            </DetailRow>
            <DetailRow label="Country">{countryName(beneficiary.country)}</DetailRow>
            <DetailRow label="Currency">
              {CURRENCIES[beneficiary.currency].name} ({beneficiary.currency})
            </DetailRow>
            <DetailRow label="Email">{beneficiary.email ?? <Missing>Not provided</Missing>}</DetailRow>
            <DetailRow label="Added on">{formatDate(beneficiary.createdAt)}</DetailRow>
            <DetailRow label="Last used">
              {beneficiary.lastUsedAt ? formatRelative(beneficiary.lastUsedAt, now) : <Missing>Never used</Missing>}
            </DetailRow>
          </dl>
          <p className="mt-5 rounded-lg bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            The full account number is hidden on screen. Use the copy button when you need to check it against an invoice.
          </p>
        </Section>

        <div className="grid gap-6 xl:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-card p-5 shadow-card ring-1 ring-foreground/[0.07]">
              <p className="text-sm text-muted-foreground">Transfers sent</p>
              <p className="heading tabular mt-2 text-2xl">{formatCount(beneficiary.transferCount)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Completed or in transit</p>
            </div>
            <div className="rounded-xl bg-card p-5 shadow-card ring-1 ring-foreground/[0.07]">
              <p className="text-sm text-muted-foreground">Total sent</p>
              <p className="heading tabular mt-2 text-2xl">{formatMoney(beneficiary.totalSentMinor, beneficiary.currency)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Transfers under review are not counted yet</p>
            </div>
          </div>

          <Section title="Transfers to this beneficiary" flush>
            {transfers.length === 0 ? (
              <EmptyState
                icon={Send}
                title="No transfers yet"
                description={`Money you send to ${beneficiary.name} will be listed here.`}
              />
            ) : (
              <TransactionList rows={transfers} compact />
            )}
            {history.total > history.rows.length ? (
              <p className="border-t border-border/70 px-5 py-3 text-xs text-muted-foreground">
                Showing the {transfers.length} most recent of {history.total} transfers.{" "}
                <Link
                  href={`/transactions?q=${encodeURIComponent(beneficiary.name)}`}
                  className="font-medium text-accent-foreground underline-offset-4 outline-none hover:underline focus-visible:underline"
                >
                  See them all
                </Link>
              </p>
            ) : null}
          </Section>
        </div>
      </div>
    </>
  );
}
