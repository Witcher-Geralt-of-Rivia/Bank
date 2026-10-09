"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, PasswordInput, SubmitButton } from "@/components/shared/client";
import { Callout } from "@/components/shared/page";
import type { FieldErrors } from "@/lib/errors";
import { PASSWORD_MIN_LENGTH, changePasswordSchema, fieldErrorsOf } from "@/lib/validation";
import { changePasswordAction } from "@/server/actions/banking";

const EMPTY = { currentPassword: "", newPassword: "", confirmPassword: "" };

/**
 * Changes the password of the signed-in user. The current password is asked
 * for again, so an unattended session cannot be used to take over the profile.
 */
export function PasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Bumped after a successful change so the inputs remount with their contents hidden again.
  const [revision, setRevision] = useState(0);
  const [pending, startTransition] = useTransition();

  function bind(key: keyof typeof EMPTY) {
    return {
      name: key,
      value: values[key],
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        setValues((current) => ({ ...current, [key]: event.target.value })),
    };
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const parsed = changePasswordSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrorsOf(parsed.error));
      return;
    }
    setErrors({});

    startTransition(async () => {
      const result = await changePasswordAction(values);
      if (!result.ok) {
        const fieldErrors = result.error.fieldErrors ?? {};
        setErrors(fieldErrors);
        // Field-level problems are shown next to their inputs.
        setFormError(Object.keys(fieldErrors).length > 0 ? null : result.error.message);
        return;
      }
      setValues(EMPTY);
      setRevision((current) => current + 1);
      toast.success("Contraseña cambiada");
      router.refresh();
    });
  }

  return (
    <form key={revision} onSubmit={submit} className="grid max-w-md gap-4" noValidate>
      {/* Tells password managers which sign-in the new password belongs to. */}
      <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />

      <Field label="Contraseña actual" error={errors.currentPassword}>
        {(props) => <PasswordInput {...props} {...bind("currentPassword")} autoComplete="current-password" required />}
      </Field>
      <Field
        label="Nueva contraseña"
        error={errors.newPassword}
        hint={`Al menos ${PASSWORD_MIN_LENGTH} caracteres, con una letra y un número.`}
      >
        {(props) => <PasswordInput {...props} {...bind("newPassword")} autoComplete="new-password" required />}
      </Field>
      <Field label="Confirmar nueva contraseña" error={errors.confirmPassword}>
        {(props) => <PasswordInput {...props} {...bind("confirmPassword")} autoComplete="new-password" required />}
      </Field>

      {formError ? <Callout tone="danger">{formError}</Callout> : null}

      <SubmitButton pending={pending} pendingLabel="Cambiando…" className="w-full justify-self-start sm:w-auto">
        Cambiar contraseña
      </SubmitButton>
    </form>
  );
}
