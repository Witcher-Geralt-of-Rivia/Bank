"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, SubmitButton } from "@/components/shared/client";
import { Callout } from "@/components/shared/page";
import { Input } from "@/components/ui/input";
import type { FieldErrors } from "@/lib/errors";
import { fieldErrorsOf, profileSchema } from "@/lib/validation";
import { updateProfileAction } from "@/server/actions/banking";

/** Editable profile details. The email identifies the sign-in and is shown read-only. */
export function ProfileForm({
  name: initialName,
  email,
  company: initialCompany,
  phone: initialPhone,
}: {
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [company, setCompany] = useState(initialCompany ?? "");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const values = { name, company, phone };
    const parsed = profileSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrorsOf(parsed.error));
      return;
    }
    setErrors({});

    startTransition(async () => {
      const result = await updateProfileAction(values);
      if (!result.ok) {
        const fieldErrors = result.error.fieldErrors ?? {};
        setErrors(fieldErrors);
        // Field-level problems are shown next to their inputs.
        setFormError(Object.keys(fieldErrors).length > 0 ? null : result.error.message);
        return;
      }
      toast.success("Perfil actualizado");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
      <Field label="Nombre completo" error={errors.name}>
        {(props) => (
          <Input
            {...props}
            name="name"
            autoComplete="name"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        )}
      </Field>
      <Field label="Correo electrónico" hint="Se usa para iniciar sesión. No se puede cambiar aquí.">
        {(props) => (
          <Input
            {...props}
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            readOnly
            className="bg-muted text-muted-foreground"
          />
        )}
      </Field>
      <Field label="Empresa" optional error={errors.company}>
        {(props) => (
          <Input
            {...props}
            name="company"
            autoComplete="organization"
            maxLength={80}
            value={company}
            onChange={(event) => setCompany(event.target.value)}
          />
        )}
      </Field>
      <Field label="Teléfono" optional error={errors.phone}>
        {(props) => (
          <Input
            {...props}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={32}
            placeholder="+1 (555) 000-0000"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        )}
      </Field>

      {formError ? (
        <Callout tone="danger" className="sm:col-span-2">
          {formError}
        </Callout>
      ) : null}

      <div className="sm:col-span-2">
        <SubmitButton pending={pending} pendingLabel="Guardando…" className="w-full sm:w-auto">
          Guardar cambios
        </SubmitButton>
      </div>
    </form>
  );
}
