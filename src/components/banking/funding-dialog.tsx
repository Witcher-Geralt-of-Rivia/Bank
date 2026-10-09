"use client";

import { ArrowDownToLine, ArrowUpFromLine, CircleCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, SubmitButton } from "@/components/shared/client";
import { Callout } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { maskAccountNumber } from "@/lib/domain";
import type { FieldErrors } from "@/lib/errors";
import { CURRENCIES, type CurrencyCode, MoneyError, formatMoney, parseAmount } from "@/lib/money";
import { depositAction, withdrawAction } from "@/server/actions/banking";

export type FundingAccount = {
  id: string;
  name: string;
  number: string;
  currency: CurrencyCode;
  /** Available balance in minor units, as a string for serialisation. */
  availableMinor: string;
  usable: boolean;
};

type Mode = "deposit" | "withdraw";

/**
 * Add money to, or withdraw money from, one of the customer's accounts.
 *
 * An idempotency key is created when the form opens and reused for every
 * submission of that form, so a double click or a retry after a dropped
 * connection can never post the movement twice.
 */
export function FundingDialog({
  accounts,
  defaultAccountId,
  defaultMode = "deposit",
  children,
}: {
  accounts: FundingAccount[];
  defaultAccountId?: string;
  defaultMode?: Mode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const usable = accounts.filter((account) => account.usable);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [accountId, setAccountId] = useState(defaultAccountId ?? usable[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; id: string } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [pending, startTransition] = useTransition();

  const account = usable.find((a) => a.id === accountId);

  function reset(nextMode: Mode = defaultMode) {
    setMode(nextMode);
    setAmount("");
    setDescription("");
    setErrors({});
    setFormError(null);
    setDone(null);
    setIdempotencyKey(crypto.randomUUID());
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!account) return;
    setFormError(null);

    let minor: bigint;
    try {
      minor = parseAmount(amount, account.currency);
      if (minor <= 0n) throw new MoneyError("negative", "El monto debe ser mayor que cero.");
    } catch (error) {
      setErrors({ amount: error instanceof MoneyError ? error.message : "Ingresa un monto válido." });
      return;
    }
    if (mode === "withdraw" && minor > BigInt(account.availableMinor)) {
      setErrors({ amount: "El monto supera el saldo disponible." });
      return;
    }
    setErrors({});

    startTransition(async () => {
      const action = mode === "deposit" ? depositAction : withdrawAction;
      const result = await action({ idempotencyKey, accountId: account.id, amount, description });
      if (!result.ok) {
        setErrors(result.error.fieldErrors ?? {});
        setFormError(result.error.fieldErrors?.amount ? null : result.error.message);
        return;
      }
      const text = formatMoney(minor, account.currency);
      setDone({ text, id: result.data.id });
      toast.success(mode === "deposit" ? `Depósito de ${text} en ${account.name}` : `Retiro de ${text} de ${account.name}`);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{done ? "Todo listo" : "Agregar o retirar dinero"}</DialogTitle>
          <DialogDescription>
            {done ? "El movimiento quedó registrado en el libro mayor." : "Mueve dinero entre esta cuenta y tu cuenta bancaria vinculada."}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center gap-1 py-4 text-center">
            <span className="mb-2 flex size-12 animate-pop items-center justify-center rounded-full bg-success-soft text-success">
              <CircleCheck className="size-6" />
            </span>
            <p className="heading text-2xl">{done.text}</p>
            <p className="text-sm text-muted-foreground">
              {mode === "deposit" ? "Depósito en" : "Retiro de"} {account?.name}
            </p>
            <div className="mt-5 flex w-full gap-2">
              <Button variant="outline" className="flex-1" onClick={() => reset(mode)}>
                Hacer otro
              </Button>
              <Button className="flex-1" onClick={() => setOpen(false)}>
                Listo
              </Button>
            </div>
          </div>
        ) : usable.length === 0 ? (
          <Callout tone="warning" title="No hay cuentas disponibles">
            Ninguna de tus cuentas puede enviar ni recibir fondos en este momento.
          </Callout>
        ) : (
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <Tabs value={mode} onValueChange={(value) => { setMode(value as Mode); setErrors({}); setFormError(null); }}>
              <TabsList className="w-full">
                <TabsTrigger value="deposit">
                  <ArrowDownToLine className="size-3.5" /> Agregar dinero
                </TabsTrigger>
                <TabsTrigger value="withdraw">
                  <ArrowUpFromLine className="size-3.5" /> Retirar
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <Field label="Cuenta" hint={account ? `Disponible: ${formatMoney(BigInt(account.availableMinor), account.currency)}` : undefined}>
              {(props) => (
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger {...props} className="w-full">
                    <SelectValue placeholder="Elige una cuenta" />
                  </SelectTrigger>
                  <SelectContent>
                    {usable.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} <span className="text-muted-foreground">{maskAccountNumber(a.number)}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <Field label="Monto" error={errors.amount}>
              {(props) => (
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                    {account ? CURRENCIES[account.currency].symbol : ""}
                  </span>
                  <Input
                    {...props}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className="tabular pr-14 pl-7"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-muted-foreground">
                    {account?.currency}
                  </span>
                </div>
              )}
            </Field>

            <Field label="Nota" optional error={errors.description}>
              {(props) => (
                <Input
                  {...props}
                  maxLength={140}
                  placeholder={mode === "deposit" ? "p. ej., aporte de capital de trabajo" : "p. ej., retiro del propietario"}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              )}
            </Field>

            {formError ? <Callout tone="danger">{formError}</Callout> : null}

            <SubmitButton size="lg" pending={pending} pendingLabel="Registrando…">
              {mode === "deposit" ? "Agregar dinero" : "Retirar"}
            </SubmitButton>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
