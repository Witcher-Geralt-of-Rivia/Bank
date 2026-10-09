"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleDashed,
  Clock,
  Landmark,
  Search,
  ShieldCheck,
  Snowflake,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Field, SubmitButton } from "@/components/shared/client";
import { Callout } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/status";
import { StatusWatcher } from "@/components/transactions/receipt-actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CATEGORIES, type Category, TRANSFER_POLICY, type TransactionStatus } from "@/lib/domain";
import type { FieldErrors } from "@/lib/errors";
import { initials } from "@/lib/format";
import { CURRENCIES, type CurrencyCode, MoneyError, formatMoney, parseAmount, toDecimalString } from "@/lib/money";
import { cn } from "@/lib/utils";
import { type MovementReceipt, submitTransferAction } from "@/server/actions/banking";

export type WizardAccount = {
  id: string;
  name: string;
  maskedNumber: string;
  typeLabel: string;
  currency: CurrencyCode;
  availableMinor: string;
  usable: boolean;
};

export type WizardBeneficiary = {
  id: string;
  name: string;
  nickname: string | null;
  bankName: string;
  maskedNumber: string;
  currency: CurrencyCode;
  kind: "internal" | "external";
};

type Destination = { kind: "account"; id: string } | { kind: "beneficiary"; id: string };

const STEPS = ["Origen", "Destino", "Monto", "Revisión"] as const;

const PAYMENT_CATEGORIES: Category[] = [
  "contractors",
  "payroll",
  "rent",
  "software",
  "utilities",
  "insurance",
  "travel",
  "marketing",
  "office",
  "taxes",
  "other",
];

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-6 flex items-center gap-2 sm:gap-3" aria-label="Progreso">
      {STEPS.map((label, index) => {
        const done = index < step;
        const current = index === step;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3" aria-current={current ? "step" : undefined}>
            <span
              className={cn(
                "tabular flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                done && "bg-primary text-primary-foreground",
                current && "bg-accent text-accent-foreground ring-2 ring-primary/40",
                !done && !current && "bg-muted text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span className={cn("hidden truncate text-sm sm:block", current ? "font-medium" : "text-muted-foreground")}>{label}</span>
            {index < STEPS.length - 1 ? <span aria-hidden="true" className={cn("h-px flex-1", done ? "bg-primary/50" : "bg-border")} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** A selectable row backed by a real radio input, so it works with a keyboard. */
function Choice({
  name,
  checked,
  disabled,
  onSelect,
  leading,
  title,
  subtitle,
  trailing,
}: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  leading: React.ReactNode;
  title: React.ReactNode;
  subtitle: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring/60",
        checked ? "border-primary/60 bg-accent/50" : "border-border",
        disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:border-primary/40",
      )}
    >
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onSelect} className="sr-only" />
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
      {trailing}
      <span
        aria-hidden="true"
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
      >
        {checked ? <Check className="size-3" /> : null}
      </span>
    </label>
  );
}

function CurrencyChip({ currency }: { currency: CurrencyCode }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-xs font-semibold tracking-wide text-accent-foreground">
      {currency}
    </span>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}

export function TransferWizard({
  accounts,
  beneficiaries,
  initialSourceId,
  initialBeneficiaryId,
}: {
  accounts: WizardAccount[];
  beneficiaries: WizardBeneficiary[];
  initialSourceId?: string;
  initialBeneficiaryId?: string;
}) {
  const router = useRouter();
  const usableAccounts = accounts.filter((a) => a.usable);

  // Work out a sensible starting point from the link that opened the page.
  const initial = useMemo(() => {
    const beneficiary = beneficiaries.find((b) => b.id === initialBeneficiaryId);
    const requested = usableAccounts.find((a) => a.id === initialSourceId);
    const matching = beneficiary ? usableAccounts.find((a) => a.currency === beneficiary.currency) : undefined;
    const source = requested && (!beneficiary || requested.currency === beneficiary.currency) ? requested : (matching ?? requested);
    const destination: Destination | null = beneficiary && source?.currency === beneficiary.currency ? { kind: "beneficiary", id: beneficiary.id } : null;
    return {
      sourceId: source?.id ?? (usableAccounts.length === 1 ? usableAccounts[0].id : ""),
      destination,
      step: destination ? 2 : source ? 1 : 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- evaluated once, from the initial props
  }, []);

  const [step, setStep] = useState(initial.step);
  const [sourceId, setSourceId] = useState(initial.sourceId);
  const [destination, setDestination] = useState<Destination | null>(initial.destination);
  const [tab, setTab] = useState<"beneficiaries" | "accounts">(beneficiaries.length > 0 ? "beneficiaries" : "accounts");
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<Category | "">("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [receipt, setReceipt] = useState<MovementReceipt | null>(null);
  const [liveStatus, setLiveStatus] = useState<TransactionStatus | null>(null);
  const [pending, startTransition] = useTransition();

  const source = accounts.find((a) => a.id === sourceId);
  const destinationAccount = destination?.kind === "account" ? accounts.find((a) => a.id === destination.id) : undefined;
  const destinationBeneficiary = destination?.kind === "beneficiary" ? beneficiaries.find((b) => b.id === destination.id) : undefined;
  const destinationName = destinationAccount?.name ?? destinationBeneficiary?.name ?? "";
  const external = destinationBeneficiary?.kind === "external";

  let amountMinor: bigint | null = null;
  if (source && amount.trim()) {
    try {
      amountMinor = parseAmount(amount, source.currency);
    } catch {
      amountMinor = null;
    }
  }
  const needsReview = Boolean(external && amountMinor !== null && amountMinor >= TRANSFER_POLICY.reviewThresholdMinor);
  const arrival = !destination
    ? null
    : !external
      ? { icon: Zap, text: "Al instante", detail: "Se liquida de inmediato en el libro mayor de Aldera." }
      : needsReview
        ? { icon: ShieldCheck, text: "Después de la revisión", detail: "Queda retenida mientras nuestro equipo de operaciones la revisa y luego se envía al banco receptor." }
        : { icon: Clock, text: "Normalmente en 1 día hábil", detail: "Se envía al banco receptor a través de la red de pagos." };

  const filteredBeneficiaries = beneficiaries.filter((b) => {
    const term = search.trim().toLowerCase();
    return !term || `${b.name} ${b.nickname ?? ""} ${b.bankName}`.toLowerCase().includes(term);
  });

  function chooseSource(id: string) {
    setSourceId(id);
    const next = accounts.find((a) => a.id === id);
    // A destination in another currency, or the account itself, no longer applies.
    const currentCurrency = destinationAccount?.currency ?? destinationBeneficiary?.currency;
    if (destination && (currentCurrency !== next?.currency || (destination.kind === "account" && destination.id === id))) {
      setDestination(null);
    }
  }

  function validateAmountStep(): boolean {
    const next: FieldErrors = {};
    if (!source) return false;
    try {
      const minor = parseAmount(amount, source.currency);
      if (minor <= 0n) next.amount = "El monto debe ser mayor que cero.";
      else if (minor > BigInt(source.availableMinor)) {
        next.amount = `Supera el saldo disponible en ${source.name}: ${formatMoney(BigInt(source.availableMinor), source.currency)}.`;
      } else if (minor > TRANSFER_POLICY.maxAmountMinor) {
        next.amount = `El límite por transferencia es de ${formatMoney(TRANSFER_POLICY.maxAmountMinor, source.currency)}.`;
      }
    } catch (error) {
      next.amount = error instanceof MoneyError ? error.message : "Ingresa un monto válido.";
    }
    if (!description.trim()) next.description = "Agrega una descripción breve para que ambas partes reconozcan esta transferencia.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goToReview() {
    if (!validateAmountStep()) return;
    setFormError(null);
    // One key per reviewed instruction: resubmitting it can never pay twice.
    setIdempotencyKey(crypto.randomUUID());
    setStep(3);
  }

  function submit() {
    if (!source || !destination) return;
    setFormError(null);
    startTransition(async () => {
      const result = await submitTransferAction({
        idempotencyKey,
        sourceAccountId: source.id,
        destination:
          destination.kind === "account"
            ? { kind: "account", accountId: destination.id }
            : { kind: "beneficiary", beneficiaryId: destination.id },
        amount,
        description,
        category: destination.kind === "beneficiary" && category ? category : undefined,
      });
      if (!result.ok) {
        const fields = result.error.fieldErrors ?? {};
        if (fields.amount || fields.description) {
          setErrors(fields);
          setStep(2);
        } else {
          setFormError(result.error.message);
        }
        return;
      }
      setReceipt(result.data);
      setLiveStatus(result.data.status);
      setStep(4);
      router.refresh();
    });
  }

  function restart() {
    setStep(0);
    setDestination(null);
    setAmount("");
    setDescription("");
    setCategory("");
    setErrors({});
    setFormError(null);
    setReceipt(null);
    setLiveStatus(null);
  }

  if (usableAccounts.length === 0) {
    return (
      <Callout tone="warning" icon={Snowflake} title="Ninguna cuenta puede enviar dinero en este momento">
        Ninguna de tus cuentas está activa. Comunícate con soporte si crees que se trata de un error.
      </Callout>
    );
  }

  // --- confirmation ---------------------------------------------------------
  if (step === 4 && receipt && source && amountMinor !== null) {
    const status = liveStatus ?? receipt.status;
    const heading =
      status === "completed" ? "Transferencia completada" : status === "pending" ? "Enviada a revisión" : status === "failed" ? "Transferencia no completada" : "Transferencia enviada";
    const message =
      status === "completed"
        ? `${destinationName} ya recibió los fondos.`
        : status === "pending"
          ? "El monto queda retenido en tu cuenta. Te avisaremos en cuanto se apruebe."
          : status === "failed"
            ? "Los fondos ya están de vuelta en tu cuenta."
            : "Va en camino al banco receptor. Esta página se actualizará cuando se liquide.";

    return (
      <div className="mx-auto max-w-lg">
        <StatusWatcher transactionId={receipt.id} status={status} onChange={setLiveStatus} />
        <div className="animate-rise overflow-hidden rounded-2xl bg-card shadow-raised ring-1 ring-foreground/[0.07]">
          <div className="flex flex-col items-center px-6 pt-10 pb-8 text-center">
            <span
              className={cn(
                "mb-5 flex size-16 animate-pop items-center justify-center rounded-full",
                status === "pending" ? "bg-warning-soft text-warning" : status === "processing" ? "bg-info-soft text-info" : "bg-success-soft text-success",
              )}
            >
              {status === "pending" ? (
                <Clock className="size-7" />
              ) : status === "processing" ? (
                <CircleDashed className="size-7 animate-spin [animation-duration:3s]" />
              ) : (
                <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12.5 10 17.5 19 7.5" strokeDasharray="24" className="animate-draw" />
                </svg>
              )}
            </span>
            <h2 className="heading text-xl" aria-live="polite">
              {heading}
            </h2>
            <p className="mt-4 text-[2.5rem] leading-none font-semibold tracking-[-0.03em]">{formatMoney(amountMinor, source.currency)}</p>
            <p className="mt-2 text-sm text-muted-foreground">para {destinationName}</p>
            <p className="mt-4 max-w-sm text-sm text-pretty text-muted-foreground">{message}</p>
          </div>

          <dl className="divide-y divide-border/70 border-t border-border/70 px-6 py-1">
            <SummaryRow label="Estado">
              <StatusBadge status={status} />
            </SummaryRow>
            <SummaryRow label="Origen">
              {source.name} <span className="tabular font-normal text-muted-foreground">{source.maskedNumber}</span>
            </SummaryRow>
            <SummaryRow label="Referencia">
              <span className="font-mono text-[0.8125rem]">{receipt.reference}</span>
            </SummaryRow>
          </dl>

          {receipt.replayed ? (
            <div className="px-6 pb-4">
              <Callout tone="info">Esta instrucción ya se había recibido, así que no se envió por segunda vez.</Callout>
            </div>
          ) : null}

          <div className="grid gap-2 border-t border-border/70 bg-muted/40 p-4 sm:grid-cols-2">
            <Button asChild size="lg">
              <Link href={`/transactions/${receipt.id}`}>Ver comprobante</Link>
            </Button>
            <Button variant="outline" size="lg" onClick={restart}>
              Hacer otra transferencia
            </Button>
          </div>
        </div>
        <p className="mt-4 text-center text-sm">
          <Link href="/dashboard" className="text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:underline">
            Volver al resumen
          </Link>
        </p>
      </div>
    );
  }

  // --- steps ----------------------------------------------------------------
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="rounded-xl bg-card p-5 shadow-card ring-1 ring-foreground/[0.07] sm:p-6">
        <Stepper step={step} />

        {step === 0 ? (
          <fieldset>
            <legend className="heading text-lg">¿Desde qué cuenta envías?</legend>
            <p className="mt-1 text-sm text-muted-foreground">Puedes enviar hasta el saldo disponible.</p>
            <div className="mt-5 grid gap-2.5">
              {accounts.map((account) => (
                <Choice
                  key={account.id}
                  name="source"
                  checked={sourceId === account.id}
                  disabled={!account.usable}
                  onSelect={() => chooseSource(account.id)}
                  leading={<CurrencyChip currency={account.currency} />}
                  title={account.name}
                  subtitle={
                    account.usable ? (
                      <>
                        <span className="tabular sm:hidden">
                          {formatMoney(BigInt(account.availableMinor), account.currency)} disponible · {account.maskedNumber}
                        </span>
                        <span className="hidden sm:inline">
                          {account.typeLabel} · {account.maskedNumber}
                        </span>
                      </>
                    ) : (
                      "Congelada · no puede enviar dinero"
                    )
                  }
                  trailing={
                    <span className="mr-1 hidden text-right sm:block">
                      <span className="tabular block text-sm font-medium">{formatMoney(BigInt(account.availableMinor), account.currency)}</span>
                      <span className="block text-xs text-muted-foreground">disponible</span>
                    </span>
                  }
                />
              ))}
            </div>
            <div className="mt-6 flex justify-end">
              <Button size="lg" disabled={!source} onClick={() => setStep(1)}>
                Continuar <ArrowRight />
              </Button>
            </div>
          </fieldset>
        ) : null}

        {step === 1 && source ? (
          <div>
            <h2 className="heading text-lg">¿A quién le envías?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Envías desde una cuenta en {source.currency}, así que solo puedes elegir destinos en {source.currency}.
            </p>
            <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} className="mt-5">
              <TabsList className="w-full sm:w-fit">
                <TabsTrigger value="beneficiaries">
                  <Users className="size-3.5" /> Beneficiarios
                </TabsTrigger>
                <TabsTrigger value="accounts">
                  <Wallet className="size-3.5" /> Mis cuentas
                </TabsTrigger>
              </TabsList>

              <TabsContent value="beneficiaries" className="mt-3">
                {beneficiaries.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                    <p className="text-sm font-medium">Aún no tienes beneficiarios</p>
                    <p className="mt-1 text-sm text-muted-foreground">Guarda a las personas y empresas a las que les pagas para enviarles dinero.</p>
                    <Button asChild variant="outline" size="sm" className="mt-4">
                      <Link href="/beneficiaries">Agregar un beneficiario</Link>
                    </Button>
                  </div>
                ) : (
                  <>
                    {beneficiaries.length > 5 ? (
                      <div className="relative mb-2.5">
                        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="search"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Buscar beneficiarios"
                          aria-label="Buscar beneficiarios"
                          className="pl-9"
                        />
                      </div>
                    ) : null}
                    <div role="radiogroup" aria-label="Beneficiario" className="grid gap-2.5">
                      {filteredBeneficiaries.map((b) => {
                        const mismatch = b.currency !== source.currency;
                        return (
                          <Choice
                            key={b.id}
                            name="destination"
                            checked={destination?.kind === "beneficiary" && destination.id === b.id}
                            disabled={mismatch}
                            onSelect={() => setDestination({ kind: "beneficiary", id: b.id })}
                            leading={
                              <Avatar className="size-10">
                                <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">{initials(b.name)}</AvatarFallback>
                              </Avatar>
                            }
                            title={b.name}
                            subtitle={mismatch ? `Solo acepta ${b.currency}` : `${b.bankName} · ${b.maskedNumber}`}
                            trailing={
                              b.kind === "internal" && !mismatch ? (
                                <span className="mr-1 hidden items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[0.6875rem] font-medium text-success sm:inline-flex">
                                  <Zap className="size-3" /> Al instante
                                </span>
                              ) : (
                                <span className="mr-1 text-xs font-medium text-muted-foreground">{b.currency}</span>
                              )
                            }
                          />
                        );
                      })}
                      {filteredBeneficiaries.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Ningún beneficiario coincide con “{search}”.</p> : null}
                    </div>
                    <p className="mt-3 text-sm">
                      <Link href="/beneficiaries" className="font-medium text-accent-foreground underline-offset-4 outline-none hover:underline focus-visible:underline">
                        Agregar un nuevo beneficiario
                      </Link>
                    </p>
                  </>
                )}
              </TabsContent>

              <TabsContent value="accounts" className="mt-3">
                {accounts.length < 2 ? (
                  <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">No tienes otra cuenta a la que transferir dinero.</p>
                ) : (
                  <div role="radiogroup" aria-label="Tus cuentas" className="grid gap-2.5">
                    {accounts
                      .filter((a) => a.id !== source.id)
                      .map((account) => {
                        const mismatch = account.currency !== source.currency;
                        return (
                          <Choice
                            key={account.id}
                            name="destination"
                            checked={destination?.kind === "account" && destination.id === account.id}
                            disabled={mismatch || !account.usable}
                            onSelect={() => setDestination({ kind: "account", id: account.id })}
                            leading={<CurrencyChip currency={account.currency} />}
                            title={account.name}
                            subtitle={!account.usable ? "Congelada · no puede recibir dinero" : mismatch ? `Cuenta en ${account.currency}` : `${account.typeLabel} · ${account.maskedNumber}`}
                          />
                        );
                      })}
                  </div>
                )}
              </TabsContent>
            </Tabs>

            <div className="mt-6 flex justify-between gap-3">
              <Button variant="ghost" size="lg" onClick={() => setStep(0)}>
                <ArrowLeft /> Atrás
              </Button>
              <Button size="lg" disabled={!destination} onClick={() => setStep(2)}>
                Continuar <ArrowRight />
              </Button>
            </div>
          </div>
        ) : null}

        {step === 2 && source ? (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              goToReview();
            }}
          >
            <h2 className="heading text-lg">¿Cuánto envías?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Para <span className="font-medium text-foreground">{destinationName}</span>, desde {source.name}
            </p>

            <div className="mt-5 grid gap-5">
              <Field
                label="Monto"
                error={errors.amount}
                hint={
                  <span className="flex items-center justify-between gap-3">
                    <span>
                      Disponible: <span className="tabular">{formatMoney(BigInt(source.availableMinor), source.currency)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setAmount(toDecimalString(BigInt(source.availableMinor), source.currency))}
                      className="font-medium text-accent-foreground underline-offset-4 outline-none hover:underline focus-visible:underline"
                    >
                      Usar todo el saldo
                    </button>
                  </span>
                }
              >
                {(props) => (
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-2xl font-medium text-muted-foreground">
                      {CURRENCIES[source.currency].symbol}
                    </span>
                    <Input
                      {...props}
                      autoFocus
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.00"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      className="tabular h-16 pr-16 pl-10 text-3xl font-semibold tracking-[-0.02em] md:text-3xl"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-medium text-muted-foreground">{source.currency}</span>
                  </div>
                )}
              </Field>

              <Field label="Descripción" error={errors.description} hint="Visible para ti e incluida en el comprobante.">
                {(props) => (
                  <Input
                    {...props}
                    maxLength={140}
                    placeholder="p. ej., Factura 2026-041"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                )}
              </Field>

              {destination?.kind === "beneficiary" ? (
                <Field label="Categoría" optional hint="Se usa para organizar tus gastos en Análisis.">
                  {(props) => (
                    <Select value={category} onValueChange={(value) => setCategory(value as Category)}>
                      <SelectTrigger {...props} className="w-full">
                        <SelectValue placeholder="Elige una categoría" />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_CATEGORIES.map((key) => (
                          <SelectItem key={key} value={key}>
                            {CATEGORIES[key]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
              ) : null}

              {needsReview ? (
                <Callout tone="warning" icon={ShieldCheck} title="Esta transferencia pasará por revisión">
                  Nuestro equipo de operaciones revisa las transferencias externas de {formatMoney(TRANSFER_POLICY.reviewThresholdMinor, source.currency)} o
                  más antes de enviarlas. Mientras tanto, el monto queda retenido.
                </Callout>
              ) : null}
            </div>

            <div className="mt-6 flex justify-between gap-3">
              <Button type="button" variant="ghost" size="lg" onClick={() => setStep(1)}>
                <ArrowLeft /> Atrás
              </Button>
              <Button type="submit" size="lg">
                Revisar <ArrowRight />
              </Button>
            </div>
          </form>
        ) : null}

        {step === 3 && source && amountMinor !== null ? (
          <div>
            <h2 className="heading text-lg">Revisa y confirma</h2>
            <p className="mt-1 text-sm text-muted-foreground">Revisa los detalles. Una vez confirmada, la transferencia queda registrada en el libro mayor.</p>

            <div className="mt-5 rounded-xl border border-border bg-background px-5 py-6 text-center">
              <p className="text-sm text-muted-foreground">Vas a enviar</p>
              <p className="mt-1.5 text-[2.5rem] leading-none font-semibold tracking-[-0.03em]">{formatMoney(amountMinor, source.currency)}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                a <span className="font-medium text-foreground">{destinationName}</span>
              </p>
            </div>

            <dl className="mt-3 divide-y divide-border/70">
              <SummaryRow label="Origen">
                {source.name} <span className="tabular font-normal text-muted-foreground">{source.maskedNumber}</span>
              </SummaryRow>
              <SummaryRow label="Destino">
                {destinationName}
                <span className="tabular block text-xs font-normal text-muted-foreground">
                  {destinationBeneficiary ? `${destinationBeneficiary.bankName} · ${destinationBeneficiary.maskedNumber}` : destinationAccount?.maskedNumber}
                </span>
              </SummaryRow>
              <SummaryRow label="Descripción">{description}</SummaryRow>
              {category && destination?.kind === "beneficiary" ? <SummaryRow label="Categoría">{CATEGORIES[category]}</SummaryRow> : null}
              <SummaryRow label="Comisión">Sin comisión</SummaryRow>
              <SummaryRow label="Llegada">{arrival?.text}</SummaryRow>
              <SummaryRow label="Saldo posterior">
                <span className="tabular">{formatMoney(BigInt(source.availableMinor) - amountMinor, source.currency)}</span>{" "}
                <span className="font-normal text-muted-foreground">disponible</span>
              </SummaryRow>
            </dl>

            {formError ? (
              <Callout tone="danger" className="mt-4" title="La transferencia no se envió">
                {formError} Puedes intentarlo de nuevo sin riesgo: esta instrucción no se procesará dos veces.
              </Callout>
            ) : null}

            <div className="mt-6 flex flex-col-reverse justify-between gap-3 sm:flex-row">
              <Button variant="ghost" size="lg" disabled={pending} onClick={() => setStep(2)}>
                <ArrowLeft /> Editar
              </Button>
              <SubmitButton type="button" size="xl" pending={pending} pendingLabel="Enviando…" onClick={submit}>
                Confirmar y enviar {formatMoney(amountMinor, source.currency)}
              </SubmitButton>
            </div>
          </div>
        ) : null}
      </div>

      {/* Running summary */}
      <aside className="rounded-xl bg-card p-5 shadow-card ring-1 ring-foreground/[0.07] lg:sticky lg:top-24">
        <h2 className="text-sm font-semibold">Resumen de la transferencia</h2>
        <dl className="mt-2 divide-y divide-border/70">
          <SummaryRow label="Origen">{source ? source.name : <span className="font-normal text-muted-foreground">Sin seleccionar</span>}</SummaryRow>
          <SummaryRow label="Destino">{destinationName || <span className="font-normal text-muted-foreground">Sin seleccionar</span>}</SummaryRow>
          <SummaryRow label="Monto">
            {source && amountMinor !== null && amountMinor > 0n ? (
              <span className="tabular">{formatMoney(amountMinor, source.currency)}</span>
            ) : (
              <span className="font-normal text-muted-foreground">—</span>
            )}
          </SummaryRow>
        </dl>
        {arrival ? (
          <div className="mt-4 flex gap-3 rounded-lg bg-muted px-3 py-3">
            <arrival.icon className="mt-0.5 size-4 shrink-0 text-accent-foreground" />
            <div>
              <p className="text-sm font-medium">{arrival.text}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{arrival.detail}</p>
            </div>
          </div>
        ) : null}
        <p className="mt-4 flex gap-2 text-xs leading-relaxed text-muted-foreground">
          <Landmark className="mt-0.5 size-3.5 shrink-0" />
          Cada transferencia se registra con asientos contables cuadrados y lleva una clave única, por lo que nunca puede aplicarse dos veces.
        </p>
      </aside>
    </div>
  );
}
