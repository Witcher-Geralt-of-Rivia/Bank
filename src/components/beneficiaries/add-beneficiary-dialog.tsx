"use client";

import { ChevronDown, Landmark, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BENEFICIARY_COUNTRIES } from "@/components/beneficiaries/countries";
import { Field, SubmitButton } from "@/components/shared/client";
import { Callout } from "@/components/shared/page";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BeneficiaryKind } from "@/lib/domain";
import type { FieldErrors } from "@/lib/errors";
import { CURRENCIES, CURRENCY_CODES } from "@/lib/money";
import { cn } from "@/lib/utils";
import { beneficiarySchema, fieldErrorsOf } from "@/lib/validation";
import { createBeneficiaryAction } from "@/server/actions/banking";

type Values = {
  name: string;
  nickname: string;
  bankName: string;
  accountNumber: string;
  routingCode: string;
  country: string;
  currency: string;
  email: string;
};

const EMPTY: Values = {
  name: "",
  nickname: "",
  bankName: "",
  accountNumber: "",
  routingCode: "",
  country: "US",
  currency: "USD",
  email: "",
};

/** A native select dressed like the other form controls. */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        className={cn(
          "h-10 w-full appearance-none rounded-lg border border-input bg-card pr-9 pl-3 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

/**
 * Saves a new beneficiary: an account at another bank, or another Aldera
 * customer found by account number.
 *
 * The shared schema gives instant feedback here; the server validates the same
 * input again and resolves the Aldera account, so its field errors are mapped
 * back onto the form.
 */
export function AddBeneficiaryDialog({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<BeneficiaryKind>("external");
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const internal = kind === "internal";

  function reset() {
    setKind("external");
    setValues(EMPTY);
    setErrors({});
    setFormError(null);
  }

  function bind(key: keyof Values) {
    return {
      value: values[key],
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setValues((current) => ({ ...current, [key]: event.target.value })),
    };
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    // An Aldera account is identified by its number alone: the bank is implied.
    const payload = internal
      ? {
          kind,
          name: values.name,
          nickname: values.nickname,
          accountNumber: values.accountNumber,
          country: "US",
          currency: values.currency,
        }
      : { kind, ...values };

    const parsed = beneficiarySchema.safeParse(payload);
    const problems: FieldErrors = parsed.success ? {} : fieldErrorsOf(parsed.error);
    if (internal) {
      // The shared message mentions IBANs, which do not apply to an Aldera account.
      if (values.accountNumber.trim().length < 6) problems.accountNumber = "Ingresa su número de cuenta de Aldera.";
    } else if (values.bankName.trim().length < 2) {
      // The schema leaves the bank optional because Aldera beneficiaries have none to enter.
      problems.bankName ??= "Ingresa el nombre del banco.";
    }
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      return;
    }
    setErrors({});

    startTransition(async () => {
      const result = await createBeneficiaryAction(payload);
      if (!result.ok) {
        const fieldErrors = result.error.fieldErrors ?? {};
        setErrors(fieldErrors);
        // Field-level problems are shown next to their inputs.
        setFormError(Object.keys(fieldErrors).length > 0 ? null : result.error.message);
        return;
      }
      toast.success(`${result.data.name} se agregó a tus beneficiarios`);
      setOpen(false);
      router.refresh();
    });
  }

  const currencyField = (
    <Field
      label="Moneda"
      error={errors.currency}
      hint={internal ? "Debe coincidir con la moneda de su cuenta." : undefined}
    >
      {(props) => (
        <NativeSelect {...props} {...bind("currency")}>
          {CURRENCY_CODES.map((code) => (
            <option key={code} value={code}>
              {code} · {CURRENCIES[code].name}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) reset();
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Agregar un beneficiario</DialogTitle>
          <DialogDescription>Guarda a una persona o empresa a la que le pagas. Podrás enviarle dinero en cuanto la agregues.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Tabs
            value={kind}
            onValueChange={(value) => {
              setKind(value as BeneficiaryKind);
              setErrors({});
              setFormError(null);
            }}
          >
            <TabsList className="w-full">
              <TabsTrigger value="external" className="px-2 sm:px-3">
                <Landmark className="size-3.5" /> Otro banco
              </TabsTrigger>
              <TabsTrigger value="internal" className="px-2 sm:px-3">
                <Zap className="size-3.5" /> Cliente de Aldera
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre" error={errors.name}>
              {(props) => (
                <Input {...props} {...bind("name")} autoComplete="off" maxLength={80} placeholder="Persona o empresa" />
              )}
            </Field>
            <Field label="Alias" optional error={errors.nickname}>
              {(props) => (
                <Input {...props} {...bind("nickname")} autoComplete="off" maxLength={40} placeholder="p. ej., Alquiler del estudio" />
              )}
            </Field>

            {internal ? (
              <>
                <Field label="Número de cuenta de Aldera" error={errors.accountNumber} hint="El número de 12 dígitos de su cuenta.">
                  {(props) => (
                    <Input
                      {...props}
                      {...bind("accountNumber")}
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={40}
                      placeholder="0000 0000 0000"
                      className="tabular"
                    />
                  )}
                </Field>
                {currencyField}
              </>
            ) : (
              <>
                <Field label="Nombre del banco" error={errors.bankName}>
                  {(props) => <Input {...props} {...bind("bankName")} autoComplete="off" maxLength={80} />}
                </Field>
                <Field label="País" error={errors.country}>
                  {(props) => (
                    <NativeSelect {...props} {...bind("country")} autoComplete="off">
                      {BENEFICIARY_COUNTRIES.map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.name}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                <Field label="Número de cuenta o IBAN" error={errors.accountNumber} className="sm:col-span-2">
                  {(props) => (
                    <Input
                      {...props}
                      {...bind("accountNumber")}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={40}
                      className="tabular"
                    />
                  )}
                </Field>
                <Field label="Código de ruta o SWIFT" optional error={errors.routingCode}>
                  {(props) => (
                    <Input
                      {...props}
                      {...bind("routingCode")}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={20}
                      className="tabular"
                    />
                  )}
                </Field>
                {currencyField}
                <Field label="Correo electrónico" optional error={errors.email} className="sm:col-span-2">
                  {(props) => (
                    <Input
                      {...props}
                      {...bind("email")}
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      maxLength={254}
                      placeholder="nombre@empresa.com"
                    />
                  )}
                </Field>
              </>
            )}
          </div>

          {internal ? (
            <Callout tone="info" icon={Zap}>
              Las transferencias a clientes de Aldera se liquidan al instante.
            </Callout>
          ) : null}

          {formError ? <Callout tone="danger">{formError}</Callout> : null}

          <SubmitButton size="lg" pending={pending} pendingLabel="Agregando…">
            Agregar beneficiario
          </SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
