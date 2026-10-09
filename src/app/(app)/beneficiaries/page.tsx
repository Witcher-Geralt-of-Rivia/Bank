import { Plus, Send, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AddBeneficiaryDialog } from "@/components/beneficiaries/add-beneficiary-dialog";
import { BeneficiaryKindPill } from "@/components/beneficiaries/kind-pill";
import { Money } from "@/components/shared/money";
import { EmptyState, PageHeader, Section } from "@/components/shared/page";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { maskAccountNumber } from "@/lib/domain";
import { formatCount, formatRelative, initials } from "@/lib/format";
import { requireCustomer } from "@/server/auth/session";
import { listBeneficiaries } from "@/server/queries/misc";

export const metadata: Metadata = { title: "Beneficiarios" };

export default async function BeneficiariesPage() {
  const user = await requireCustomer();
  const db = await getDb();
  const beneficiaries = await listBeneficiaries(db, user.id);
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Beneficiarios"
        description="Las personas y empresas a las que les pagas. Las transferencias a clientes de Aldera se liquidan al instante; las que van a otros bancos suelen liquidarse en un día hábil."
        actions={
          <AddBeneficiaryDialog>
            <Button size="lg">
              <Plus /> Agregar beneficiario
            </Button>
          </AddBeneficiaryDialog>
        }
      />

      {beneficiaries.length === 0 ? (
        <Section flush>
          <EmptyState
            icon={Users}
            title="Aún no tienes beneficiarios"
            description="Guarda a las personas y empresas a las que les pagas para enviarles dinero en un par de toques."
            action={
              <AddBeneficiaryDialog>
                <Button>
                  <Plus /> Agregar beneficiario
                </Button>
              </AddBeneficiaryDialog>
            }
          />
        </Section>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {beneficiaries.map((b) => (
            <li
              key={b.id}
              className="relative flex flex-col rounded-xl bg-card p-5 shadow-card ring-1 ring-foreground/[0.07] transition-shadow duration-200 hover:shadow-raised"
            >
              <div className="flex items-center gap-3">
                <Avatar className="size-10">
                  <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">{initials(b.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-medium">
                    {/* The whole card opens the detail page; "Send" sits above this link. */}
                    <Link
                      href={`/beneficiaries/${b.id}`}
                      className="block truncate outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring/60"
                    >
                      {b.name}
                    </Link>
                  </h2>
                  {b.nickname ? <p className="truncate text-xs text-muted-foreground">{b.nickname}</p> : null}
                </div>
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground">
                  {b.currency}
                </span>
              </div>

              <div className="mt-4">
                <BeneficiaryKindPill kind={b.kind} />
                <p className="tabular mt-2 truncate text-sm text-muted-foreground">
                  <span className="text-foreground">{b.bankName}</span> · {maskAccountNumber(b.accountNumber)}
                </p>
              </div>

              <dl className="mt-4 mb-4 grid grid-cols-2 gap-4 border-t border-border/70 pt-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Transferencias</dt>
                  <dd className="tabular mt-1 text-sm font-medium">{formatCount(b.transferCount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Total enviado</dt>
                  <dd className="mt-1 text-sm font-medium">
                    <Money minor={b.totalSentMinor} currency={b.currency} />
                  </dd>
                </div>
              </dl>

              <div className="mt-auto flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-xs text-muted-foreground">
                  {b.lastUsedAt ? `Último uso · ${formatRelative(b.lastUsedAt, now)}` : "Aún sin usar"}
                </p>
                <Button asChild variant="outline" size="sm" className="relative z-10">
                  <Link href={`/transfers/new?to=${b.id}`} aria-label={`Enviar dinero a ${b.name}`}>
                    <Send /> Enviar
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
