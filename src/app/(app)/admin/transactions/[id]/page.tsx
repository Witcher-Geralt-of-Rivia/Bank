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

export const metadata: Metadata = { title: "Transacción" };

type Props = { params: Promise<{ id: string }> };

type RequestDetails = TransactionDetail["metadata"];

const CHANNEL_LABELS: Record<NonNullable<RequestDetails["channel"]>, string> = {
  web: "Aplicación web",
  api: "API",
  system: "Sistema",
};

const ROUTE_LABELS: Record<NonNullable<RequestDetails["route"]>, string> = {
  instant: "Instantánea, en el libro mayor de Aldera",
  network: "Red de pagos",
  review: "Revisión manual",
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
      ? "Aún no se ha registrado ningún asiento. Una transferencia en espera de revisión solo retiene los fondos en la cuenta de origen; los asientos se registran cuando se aprueba."
      : t.status === "failed"
        ? "No se registró ningún asiento. Los fondos solo estuvieron retenidos en la cuenta de origen, y esa retención ya se liberó."
        : "No se registraron asientos contables para esta transacción.";

  return (
    <>
      <PageHeader
        back={{ href: "/admin/transactions", label: "Monitoreo de transacciones" }}
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
          <Section title="Acciones disponibles">
            <TransactionActions
              id={t.id}
              status={t.status}
              type={t.type}
              role={user.role}
              amount={formatMoney(t.amountMinor, t.currency)}
            />
          </Section>

          <Section
            title="Asientos contables"
            description="Los asientos inmutables registrados para esta transacción; el total de débitos siempre es igual al total de créditos."
            flush
          >
            {entries.length > 0 ? (
              <LedgerEntriesTable entries={entries} currency={t.currency} showTotals />
            ) : (
              <p className="px-5 pb-5 text-sm text-pretty text-muted-foreground">{noEntriesNote}</p>
            )}
          </Section>

          <Section title="Detalles">
            <dl className="-my-2.5 divide-y divide-border/70">
              <DetailRow label="Tipo">{transactionTypeLabel(t)}</DetailRow>
              <DetailRow label="Monto">
                <Money minor={t.amountMinor} currency={t.currency} />
              </DetailRow>
              <DetailRow label="Moneda">
                {CURRENCIES[t.currency].name} ({t.currency})
              </DetailRow>
              {t.source ? (
                <DetailRow label="Cuenta de origen">
                  <Party account={t.source} />
                </DetailRow>
              ) : (
                <DetailRow label="Origen">{t.counterpartyName ?? "Cuenta externa"}</DetailRow>
              )}
              {t.destination ? (
                <DetailRow label="Cuenta de destino">
                  <Party account={t.destination} />
                </DetailRow>
              ) : beneficiary ? (
                <DetailRow label="Beneficiario">
                  {beneficiary.name}
                  <span className="tabular block text-xs font-normal text-muted-foreground">
                    {beneficiary.bankName} · {maskAccountNumber(beneficiary.accountNumber)}
                  </span>
                </DetailRow>
              ) : (
                <DetailRow label="Destino">{t.counterpartyName ?? "Cuenta externa"}</DetailRow>
              )}
              <DetailRow label="Categoría">{categoryLabel(t.category)}</DetailRow>
              <DetailRow label="Iniciada por">{initiatedByName ?? "Sistema"}</DetailRow>
              <DetailRow label="Creada">
                <span className="tabular">{formatDateTime(t.createdAt)}</span>
              </DetailRow>
              {t.completedAt ? (
                <DetailRow label="Completada">
                  <span className="tabular">{formatDateTime(t.completedAt)}</span>
                </DetailRow>
              ) : null}
              {t.failureReason ? <DetailRow label="Motivo de la falla">{t.failureReason}</DetailRow> : null}
              <DetailRow label="ID de transacción">
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-mono text-[0.8125rem] break-all">{t.id}</span>
                  <CopyButton value={t.id} label="Copiar ID de transacción" />
                </span>
              </DetailRow>
              {related ? (
                <DetailRow label={related.relation === "reverses" ? "Revierte" : "Revertida por"}>
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
          <Section title="Historial de estados" description="Cada cambio queda registrado y no se puede modificar">
            <StatusTimeline events={events} />
          </Section>

          {hasRequestDetails ? (
            <Section title="Metadatos de la solicitud" description="Capturados al crear la transacción">
              <dl className="-my-2.5 divide-y divide-border/70">
                {request.channel ? <DetailRow label="Canal">{CHANNEL_LABELS[request.channel]}</DetailRow> : null}
                {request.route ? <DetailRow label="Ruta">{ROUTE_LABELS[request.route]}</DetailRow> : null}
                {request.ip ? (
                  <DetailRow label="Dirección IP">
                    <span className="tabular">{request.ip}</span>
                  </DetailRow>
                ) : null}
                {request.userAgent ? <DetailRow label="Dispositivo">{describeUserAgent(request.userAgent)}</DetailRow> : null}
              </dl>
            </Section>
          ) : null}
        </div>
      </div>
    </>
  );
}
