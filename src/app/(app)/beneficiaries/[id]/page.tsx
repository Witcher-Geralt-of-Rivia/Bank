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

export const metadata: Metadata = { title: "Beneficiario" };

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
        back={{ href: "/beneficiaries", label: "Beneficiarios" }}
        title={beneficiary.name}
        description={beneficiary.nickname}
        actions={
          <>
            <RemoveBeneficiaryButton id={beneficiary.id} name={beneficiary.name} />
            <Button asChild size="lg">
              <Link href={`/transfers/new?to=${beneficiary.id}`}>
                <Send /> Enviar dinero
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-3">
        {/* First in the document so it leads on phones; the side column on wide screens. */}
        <Section title="Datos bancarios" className="xl:order-last">
          <dl className="-my-2.5 divide-y divide-border/70">
            <DetailRow label="Tipo">
              <BeneficiaryKindPill kind={beneficiary.kind} />
            </DetailRow>
            <DetailRow label="Banco">{beneficiary.bankName}</DetailRow>
            <DetailRow label="Número de cuenta">
              <span className="inline-flex items-center gap-1.5">
                <span className="tabular font-mono text-[0.8125rem]">{maskAccountNumber(beneficiary.accountNumber)}</span>
                <CopyButton value={beneficiary.accountNumber} label="Copiar el número de cuenta completo" />
              </span>
            </DetailRow>
            <DetailRow label="Código de ruta / SWIFT">
              {beneficiary.routingCode ? (
                <span className="tabular font-mono text-[0.8125rem]">{beneficiary.routingCode}</span>
              ) : (
                <Missing>{beneficiary.kind === "internal" ? "No requerido" : "No proporcionado"}</Missing>
              )}
            </DetailRow>
            <DetailRow label="País">{countryName(beneficiary.country)}</DetailRow>
            <DetailRow label="Moneda">
              {CURRENCIES[beneficiary.currency].name} ({beneficiary.currency})
            </DetailRow>
            <DetailRow label="Correo electrónico">{beneficiary.email ?? <Missing>No proporcionado</Missing>}</DetailRow>
            <DetailRow label="Agregado el">{formatDate(beneficiary.createdAt)}</DetailRow>
            <DetailRow label="Último uso">
              {beneficiary.lastUsedAt ? formatRelative(beneficiary.lastUsedAt, now) : <Missing>Aún sin usar</Missing>}
            </DetailRow>
          </dl>
          <p className="mt-5 rounded-lg bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            El número de cuenta completo no se muestra en pantalla. Usa el botón de copiar cuando necesites compararlo con una factura.
          </p>
        </Section>

        <div className="grid gap-6 xl:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-card p-5 shadow-card ring-1 ring-foreground/[0.07]">
              <p className="text-sm text-muted-foreground">Transferencias enviadas</p>
              <p className="heading tabular mt-2 text-2xl">{formatCount(beneficiary.transferCount)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Completadas o en tránsito</p>
            </div>
            <div className="rounded-xl bg-card p-5 shadow-card ring-1 ring-foreground/[0.07]">
              <p className="text-sm text-muted-foreground">Total enviado</p>
              <p className="heading tabular mt-2 text-2xl">{formatMoney(beneficiary.totalSentMinor, beneficiary.currency)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Las transferencias en revisión aún no se cuentan</p>
            </div>
          </div>

          <Section title="Transferencias a este beneficiario" flush>
            {transfers.length === 0 ? (
              <EmptyState
                icon={Send}
                title="Aún no hay transferencias"
                description={`El dinero que le envíes a ${beneficiary.name} aparecerá aquí.`}
              />
            ) : (
              <TransactionList rows={transfers} compact />
            )}
            {history.total > history.rows.length ? (
              <p className="border-t border-border/70 px-5 py-3 text-xs text-muted-foreground">
                Se muestran las {transfers.length} más recientes de {history.total} transferencias.{" "}
                <Link
                  href={`/transactions?q=${encodeURIComponent(beneficiary.name)}`}
                  className="font-medium text-accent-foreground underline-offset-4 outline-none hover:underline focus-visible:underline"
                >
                  Ver todas
                </Link>
              </p>
            ) : null}
          </Section>
        </div>
      </div>
    </>
  );
}
