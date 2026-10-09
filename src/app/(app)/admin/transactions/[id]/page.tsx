import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TransactionActions } from "@/components/admin/transaction-actions";
import { CopyButton } from "@/components/shared/client";
import { Money } from "@/components/shared/money";
import { DetailRow, PageHeader, Section } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/status";
import { LedgerEntriesTable, StatusTimeline } from "@/components/transactions/detail";
import { TransactionAmount, transactionTypeLabel } from "@/components/transactions/transaction-list";
import { getDb } from "@/db/client";
import { TRANSACTION_STATUS_DESCRIPTIONS, categoryLabel, isStaff, maskAccountNumber } from "@/lib/domain";
import { describeUserAgent, formatDateTime } from "@/lib/format";
import { CURRENCIES, formatMoney } from "@/lib/money";
import { requireUser } from "@/server/auth/session";
import { type AccountRef, type TransactionDetail, getTransactionForStaff } from "@/server/queries/transactions";

export const metadata: Metadata = { title: "Transaction" };

type Props = { params: Promise<{ id: string }> };

type RequestDetails = TransactionDetail["metadata"];

const CHANNEL_LABELS: Record<NonNullable<RequestDetails["channel"]>, string> = {
  web: "Web app",
  api: "API",
  system: "System",
};

const ROUTE_LABELS: Record<NonNullable<RequestDetails["route"]>, string> = {
  instant: "Instant, on the Aldera ledger",
  network: "Payment network",
  review: "Manual review",
};

/** An account on the platform: who owns it, then which account it is. */
function Party({ account }: { account: AccountRef }) {
  return (
    <>
      {account.ownerName ?? "Aldera"}
      <span className="tabular block text-xs font-normal text-muted-foreground">
        {account.name} · {maskAccountNumber(account.number)}
      </span>
    </>
  );
}

export default async function AdminTransactionPage({ params }: Props) {
  const user = await requireUser();
  if (!isStaff(user.role)) notFound();
  const { id } = await params;
  const db = await getDb();

  const detail = await getTransactionForStaff(db, id);
  if (!detail) notFound();

  const { transaction: t, beneficiary, events, entries, related, initiatedByName, metadata: request } = detail;
  const hasRequestDetails = Boolean(request.channel || request.route || request.ip || request.userAgent);

  // A hold reserves funds without posting anything, so a transfer that is
  // waiting for review, or was rejected during it, has no ledger entries.
  const noEntriesNote =
    t.status === "pending"
      ? "Nothing has been posted yet. A transfer awaiting review only holds the funds on the source account; the entries are written when it is approved."
      : t.status === "failed"
        ? "Nothing was posted. The funds were only ever held on the source account, and that hold has been released."
        : "No ledger entries were posted for this transaction.";

  return (
    <>
      <PageHeader
        back={{ href: "/admin/transactions", label: "Transaction monitoring" }}
        eyebrow={t.reference}
        title={t.description}
        description={
          <span className="flex flex-col items-start gap-2 sm:flex-row sm:items-baseline sm:gap-3">
            <StatusBadge status={t.status} />
            <span>{TRANSACTION_STATUS_DESCRIPTIONS[t.status]}</span>
          </span>
        }
        actions={
          <div className="sm:text-right">
            <p className="text-sm text-muted-foreground">{transactionTypeLabel(t)}</p>
            <p className="mt-0.5 text-[2rem] leading-none font-semibold tracking-[-0.025em] sm:text-4xl">
              <TransactionAmount view={t} neutral className="font-[inherit]" />
            </p>
          </div>
        }
      />

      {/* Explicit columns let a track be narrower than its content, so on phones the ledger table scrolls inside its card. */}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <div className="grid grid-cols-1 gap-6 xl:col-span-2">
          <Section title="Available actions">
            <TransactionActions
              id={t.id}
              status={t.status}
              type={t.type}
              role={user.role}
              amount={formatMoney(t.amountMinor, t.currency)}
            />
          </Section>

          <Section
            title="Ledger entries"
            description="The immutable postings recorded for this transaction; total debits always equal total credits."
            flush
          >
            {entries.length > 0 ? (
              <LedgerEntriesTable entries={entries} currency={t.currency} showTotals />
            ) : (
              <p className="px-5 pb-5 text-sm text-pretty text-muted-foreground">{noEntriesNote}</p>
            )}
          </Section>

          <Section title="Details">
            <dl className="-my-2.5 divide-y divide-border/70">
              <DetailRow label="Type">{transactionTypeLabel(t)}</DetailRow>
              <DetailRow label="Amount">
                <Money minor={t.amountMinor} currency={t.currency} />
              </DetailRow>
              <DetailRow label="Currency">
                {CURRENCIES[t.currency].name} ({t.currency})
              </DetailRow>
              {t.source ? (
                <DetailRow label="Source account">
                  <Party account={t.source} />
                </DetailRow>
              ) : (
                <DetailRow label="Source">{t.counterpartyName ?? "External account"}</DetailRow>
              )}
              {t.destination ? (
                <DetailRow label="Destination account">
                  <Party account={t.destination} />
                </DetailRow>
              ) : beneficiary ? (
                <DetailRow label="Beneficiary">
                  {beneficiary.name}
                  <span className="tabular block text-xs font-normal text-muted-foreground">
                    {beneficiary.bankName} · {maskAccountNumber(beneficiary.accountNumber)}
                  </span>
                </DetailRow>
              ) : (
                <DetailRow label="Destination">{t.counterpartyName ?? "External account"}</DetailRow>
              )}
              <DetailRow label="Category">{categoryLabel(t.category)}</DetailRow>
              <DetailRow label="Initiated by">{initiatedByName ?? "System"}</DetailRow>
              <DetailRow label="Created">
                <span className="tabular">{formatDateTime(t.createdAt)}</span>
              </DetailRow>
              {t.completedAt ? (
                <DetailRow label="Completed">
                  <span className="tabular">{formatDateTime(t.completedAt)}</span>
                </DetailRow>
              ) : null}
              {t.failureReason ? <DetailRow label="Failure reason">{t.failureReason}</DetailRow> : null}
              <DetailRow label="Transaction ID">
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-mono text-[0.8125rem] break-all">{t.id}</span>
                  <CopyButton value={t.id} label="Copy transaction ID" />
                </span>
              </DetailRow>
              {related ? (
                <DetailRow label={related.relation === "reverses" ? "Reverses" : "Reversed by"}>
                  <Link
                    href={`/admin/transactions/${related.id}`}
                    className="text-accent-foreground underline-offset-4 outline-none hover:underline focus-visible:underline"
                  >
                    {related.reference}
                  </Link>
                </DetailRow>
              ) : null}
            </dl>
          </Section>
        </div>

        <div className="grid grid-cols-1 gap-6">
          <Section title="Status history" description="Each change is recorded and cannot be altered">
            <StatusTimeline events={events} />
          </Section>

          {hasRequestDetails ? (
            <Section title="Request metadata" description="Captured when the transaction was created">
              <dl className="-my-2.5 divide-y divide-border/70">
                {request.channel ? <DetailRow label="Channel">{CHANNEL_LABELS[request.channel]}</DetailRow> : null}
                {request.route ? <DetailRow label="Route">{ROUTE_LABELS[request.route]}</DetailRow> : null}
                {request.ip ? (
                  <DetailRow label="IP address">
                    <span className="tabular">{request.ip}</span>
                  </DetailRow>
                ) : null}
                {request.userAgent ? <DetailRow label="Device">{describeUserAgent(request.userAgent)}</DetailRow> : null}
              </dl>
            </Section>
          ) : null}
        </div>
      </div>
    </>
  );
}
