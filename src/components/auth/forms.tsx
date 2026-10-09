"use client";

import { ArrowRight, Building2, CircleCheck, LoaderCircle, ShieldCheck, User } from "lucide-react";
import Link from "next/link";
import { type ComponentType, useActionState, useEffect, useState } from "react";
import { Field, PasswordInput, SubmitButton } from "@/components/shared/client";
import { Callout } from "@/components/shared/page";
import { Input } from "@/components/ui/input";
import { ROLE_LABELS, type Role } from "@/lib/domain";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation";
import {
  type FormState,
  demoLoginAction,
  forgotPasswordAction,
  loginAction,
  registerAction,
} from "@/server/actions/auth";

function errorsOf(state: FormState) {
  return state && !state.ok ? (state.error.fieldErrors ?? {}) : {};
}

function FormError({ state }: { state: FormState }) {
  if (!state || state.ok) return null;
  // Field-level problems are shown next to their inputs.
  if (state.error.fieldErrors && Object.keys(state.error.fieldErrors).length > 0) return null;
  return <Callout tone="danger">{state.error.message}</Callout>;
}

/** Starts the database early so the first sign-in does not pay for a cold start. */
function useWarmup() {
  useEffect(() => {
    fetch("/api/health", { cache: "no-store" }).catch(() => {});
  }, []);
}

export function LoginForm() {
  const [state, action] = useActionState(loginAction, null);
  const errors = errorsOf(state);
  useWarmup();

  return (
    <form action={action} className="grid gap-4" noValidate>
      <Field label="Correo electrónico" error={errors.email}>
        {(props) => <Input {...props} name="email" type="email" autoComplete="username" placeholder="tu@empresa.com" required />}
      </Field>
      <Field label="Contraseña" error={errors.password}>
        {(props) => <PasswordInput {...props} name="password" autoComplete="current-password" required />}
      </Field>
      <div className="-mt-1 flex justify-end">
        <Link href="/forgot-password" className="text-sm font-medium text-accent-foreground underline-offset-4 outline-none hover:underline focus-visible:underline">
          ¿Olvidaste tu contraseña?
        </Link>
      </div>
      <FormError state={state} />
      <SubmitButton size="xl" pendingLabel="Iniciando sesión…">
        Iniciar sesión <ArrowRight />
      </SubmitButton>
    </form>
  );
}

const DEMO_ICONS: Record<Role, ComponentType<{ className?: string }>> = {
  customer: User,
  operator: Building2,
  admin: ShieldCheck,
};

export function DemoAccess({
  accounts,
  password,
}: {
  accounts: { role: Role; email: string; name: string; description: string }[];
  password: string;
}) {
  const [state, action, pending] = useActionState(demoLoginAction, null);
  const [chosen, setChosen] = useState<Role | null>(null);

  return (
    <section aria-labelledby="demo-heading" className="rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <h2 id="demo-heading" className="text-sm font-semibold">
          Explora la demostración
        </h2>
        <span className="rounded-full bg-accent px-2 py-0.5 text-[0.6875rem] font-semibold text-accent-foreground">Un clic</span>
      </div>
      <p className="mt-1 text-[0.8125rem] text-muted-foreground">Inicia sesión como un usuario de ejemplo para ver cada lado de la plataforma.</p>

      <form action={action} className="mt-3 grid gap-2">
        {accounts.map((account) => {
          const Icon = DEMO_ICONS[account.role];
          const busy = pending && chosen === account.role;
          return (
            <button
              key={account.role}
              type="submit"
              name="role"
              value={account.role}
              disabled={pending}
              onClick={() => setChosen(account.role)}
              className="group flex items-center gap-3 rounded-lg border border-border/80 bg-background px-3 py-2.5 text-left transition-colors outline-none hover:border-primary/40 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Icon className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {ROLE_LABELS[account.role]} <span className="font-normal text-muted-foreground">· {account.name}</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">{account.description}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </button>
          );
        })}
      </form>

      {state && !state.ok ? (
        <Callout tone="danger" className="mt-3">
          {state.error.message}
        </Callout>
      ) : null}

      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer rounded outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
          ¿Prefieres escribir las credenciales?
        </summary>
        <dl className="mt-2 grid gap-1 rounded-lg bg-muted px-3 py-2.5 font-mono text-[0.75rem]">
          {accounts.map((account) => (
            <div key={account.role} className="flex justify-between gap-3">
              <dt className="font-sans">{ROLE_LABELS[account.role]}</dt>
              <dd className="truncate text-foreground">{account.email}</dd>
            </div>
          ))}
          <div className="mt-1 flex justify-between gap-3 border-t border-border pt-1.5">
            <dt className="font-sans">Contraseña</dt>
            <dd className="text-foreground">{password}</dd>
          </div>
        </dl>
      </details>
    </section>
  );
}

export function RegisterForm() {
  const [state, action] = useActionState(registerAction, null);
  const errors = errorsOf(state);
  useWarmup();

  return (
    <form action={action} className="grid gap-4" noValidate>
      <Field label="Nombre completo" error={errors.name}>
        {(props) => <Input {...props} name="name" autoComplete="name" placeholder="Ada Lovelace" required />}
      </Field>
      <Field label="Correo electrónico de trabajo" error={errors.email}>
        {(props) => <Input {...props} name="email" type="email" autoComplete="email" placeholder="tu@empresa.com" required />}
      </Field>
      <Field
        label="Contraseña"
        error={errors.password}
        hint={`Al menos ${PASSWORD_MIN_LENGTH} caracteres, con una letra y un número.`}
      >
        {(props) => <PasswordInput {...props} name="password" autoComplete="new-password" required />}
      </Field>
      <div className="grid gap-1.5">
        <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            name="terms"
            aria-invalid={Boolean(errors.terms)}
            className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary"
          />
          <span>Entiendo que este es un entorno de demostración y que no se abrirá ninguna cuenta real.</span>
        </label>
        {errors.terms ? (
          <p role="alert" className="text-[0.8125rem] text-danger">
            {errors.terms}
          </p>
        ) : null}
      </div>
      <FormError state={state} />
      <SubmitButton size="xl" pendingLabel="Abriendo tu cuenta…">
        Abrir cuenta <ArrowRight />
      </SubmitButton>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(forgotPasswordAction, null);
  const errors = errorsOf(state);

  if (state?.ok) {
    return (
      <div className="animate-rise rounded-xl border border-border bg-card p-6 text-center shadow-card">
        <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
          <CircleCheck className="size-6" />
        </span>
        <p className="font-medium">Revisa tu bandeja de entrada</p>
        <p className="mt-1.5 text-sm text-pretty text-muted-foreground">{state.data.message}</p>
        <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Esta demostración no envía correos. La solicitud se guardó en el registro de auditoría.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-4" noValidate>
      <Field label="Correo electrónico" error={errors.email}>
        {(props) => <Input {...props} name="email" type="email" autoComplete="email" placeholder="tu@empresa.com" required />}
      </Field>
      <FormError state={state} />
      <SubmitButton size="xl" pendingLabel="Enviando…">
        Enviar instrucciones
      </SubmitButton>
    </form>
  );
}
