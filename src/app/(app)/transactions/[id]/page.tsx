import { CircleX, Clock, Send, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LogoMark } from "@/components/brand/logo";
import { CopyButton } from "@/components/shared/client";
import { Callout, DetailRow, PageHeader, Section } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/status";
import { LedgerEntriesTable, StatusTimeline } from "@/components/transactions/detail";
import { PrintButton, StatusWatcher } from "@/components/transactions/receipt-actions";
import { TransactionAmount, TransactionIcon, transactionTypeLabel } from "@/components/transactions/transaction-list";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { TRANSACTION_STATUS_DESCRIPTIONS, categoryLabel, maskAccountNumber } from "@/lib/domain";
import { formatDateTime } from "@/lib/format";
import { requireCustomer } from "@/server/auth/session";
import { getTransactionForUser } from "@/server/queries/transactions";

export const metadata: Metadata = { title: "Transacción" };

type Props = { params: Promise<{ id: string }> };

export default async function TransactionPage({ params }: Props) {
  const user = await requireCustomer();
  const { id } = await params;
  const db = await getDb();

  // Returns null unless the transaction touches one of this customer's accounts.
  const detail = await getTransactionForUser(db, user.id, id);
  if (!detail) notFound();

  const { transaction: t, beneficiary, events, entries, related } = detail;
  const outgoing = t.direction === "out";

  const fromLabel = t.source
    ? t.source.ownerId === user.id
      ? `${t.source.name} ${maskAccountNumber(t.source.number)}`
      : (t.source.ownerName ?? "Cliente de Aldera")
    : (t.counterpartyName ?? "Cuenta externa");

  const toLabel = t.destination
    ? t.destination.ownerId === user.id
      ? `${t.destination.name} ${maskAccountNumber(t.destination.number)}`
      : (t.destination.ownerName ?? "Cliente de Aldera")
    : (t.counterpartyName ?? "Cuenta externa");

  return (
    <>
      <StatusWatcher transactionId={t.id} status={t.status} />
      <PageHeader
        back={{ href: "/transactions", label: "Transacciones" }}
        eyebrow={`Comprobante · ${t.reference}`}
        title={t.direction === "internal" ? t.description : t.counterparty}
        description={t.direction === "internal" ? t.counterparty : t.description}
        actions={
          <>
            <PrintButton />
            {outgoing && t.beneficiaryId && beneficiary && !beneficiary.archivedAt ? (
              <Button asChild size="lg">
                <Link href={`/transfers/new?to=${t.beneficiaryId}`}>
                  <Send /> Enviar de nuevo
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="grid gap-6 xl:col-span-2">
          <section aria-label="Resumen" className="rounded-xl bg-card shadow-card ring-1 ring-foreground/[0.07]">
            <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <TransactionIcon view={t} className="size-12 [&_svg]:size-5" />
                <div>
                  <p className="text-sm text-muted-foreground">{transactionTypeLabel(t)}</p>
                  <p className="mt-0.5 text-[2rem] leading-none font-semibold tracking-[-0.025em] sm:text-4xl">
                    <TransactionAmount view={t} className="font-[inherit]" />
                  </p>
                </div>
              </div>
              <div className="sm:text-right">
                <StatusBadge status={t.status} />
                <p className="mt-1.5 max-w-xs text-xs text-pretty text-muted-foreground">{TRANSACTION_STATUS_DESCRIPTIONS[t.status]}</p>
              </div>
            </div>

            {t.status === "failed" && t.failureReason ? (
              <div className="px-6 pb-6">
                <Callout tone="danger" icon={CircleX} title="Esta transferencia no se completó">
                  {t.failureReason}
                </Callout>
              </div>
            ) : null}
            {t.status === "pending" ? (
              <div className="px-6 pb-6">
                <Callout tone="warning" icon={Clock} title="En espera de revisión">
                  Nuestro equipo de operaciones revisa las transferencias de este monto a cuentas externas antes de enviarlas. El
                  monto queda retenido y se liberará automáticamente si la transferencia no se aprueba.
                </Callout>
              </div>
            ) : null}
            {related ? (
              <div className="px-6 pb-6">
                <Callout tone="neutral" icon={Undo2}>
                  {related.relation === "reversed_by" ? "Revertida por " : "Esta transacción revierte "}
                  <Link href={`/transactions/${related.id}`} className="font-medium text-foreground underline underline-offset-4">
                    {related.reference}
                  </Link>
                  . Ambos registros se conservan; ninguno se modifica.
                </Callout>
              </div>
            ) : null}

            <dl className="divide-y divide-border/70 border-t border-border/70 px-6 py-2">
              <DetailRow label="Origen">{fromLabel}</DetailRow>
              <DetailRow label="Destino">
                {toLabel}
                {beneficiary ? (
                  <span className="tabular block text-xs font-normal text-muted-foreground">
                    {beneficiary.bankName} · {maskAccountNumber(beneficiary.accountNumber)}
                  </span>
                ) : null}
              </DetailRow>
              <DetailRow label="Monto">
                <span className="tabular">
                  <TransactionAmount view={t} neutral className="font-medium text-foreground no-underline" /> {t.currency}
                </span>
              </DetailRow>
              <DetailRow label="Comisión">Sin comisión</DetailRow>
              <DetailRow label="Descripción">{t.description}</DetailRow>
              <DetailRow label="Categoría">{categoryLabel(t.category)}</DetailRow>
              <DetailRow label="Creada">
                <span className="tabular">{formatDateTime(t.createdAt)}</span>
              </DetailRow>
              {t.completedAt ? (
                <DetailRow label="Completada">
                  <span className="tabular">{formatDateTime(t.completedAt)}</span>
                </DetailRow>
              ) : null}
              <DetailRow label="Referencia">
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-mono text-[0.8125rem]">{t.reference}</span>
                  <CopyButton value={t.reference} label="Copiar referencia" />
                </span>
              </DetailRow>
              <DetailRow label="ID de transacción">
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-mono text-[0.8125rem] break-all">{t.id}</span>
                  <CopyButton value={t.id} label="Copiar ID de transacción" />
                </span>
              </DetailRow>
            </dl>

            <div className="flex items-center gap-2.5 rounded-b-xl border-t border-border/70 bg-muted/40 px-6 py-3.5 text-xs text-muted-foreground">
              <LogoMark className="size-5" />
              Emitido por Aldera · entorno de demostración, no se movieron fondos reales
            </div>
          </section>

          {entries.length > 0 ? (
            <Section
              title="Asientos contables en tus cuentas"
              description="El registro permanente de cómo esta transacción modificó tus saldos"
              flush
            >
              <LedgerEntriesTable entries={entries} currency={t.currency} />
            </Section>
          ) : null}
        </div>

        <Section title="Historial de estados" description="Cada cambio queda registrado y no se puede modificar">
          <StatusTimeline events={events} />
        </Section>
      </div>
    </>
  );
}
