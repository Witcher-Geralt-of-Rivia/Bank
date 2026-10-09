"use client";

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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/errors";

/**
 * Confirmation dialog for a sensitive operations action.
 *
 * Every such action is recorded in the audit log together with the reason
 * entered here, so the dialog asks for one before anything happens. Use it
 * from a Client Component that imports the Server Action it should call.
 */
export function ReasonDialog({
  trigger,
  title,
  description,
  confirmLabel,
  pendingLabel = "Procesando…",
  destructive = false,
  reasonLabel = "Motivo",
  reasonPlaceholder = "Queda anotado en el registro de auditoría",
  reasonRequired = true,
  successMessage,
  onConfirm,
  children,
}: {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  destructive?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  /** When false the note is optional and may be submitted empty. */
  reasonRequired?: boolean;
  successMessage: string;
  onConfirm: (reason: string) => Promise<ActionResult<unknown>>;
  /** Optional extra content shown above the reason field. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = reason.trim();
    if (reasonRequired && value.length < 3) {
      setFieldError("Ingresa un motivo de al menos 3 caracteres.");
      return;
    }
    setFieldError(undefined);
    setFormError(null);

    startTransition(async () => {
      const result = await onConfirm(value);
      if (!result.ok) {
        const fieldMessage = result.error.fieldErrors?.reason ?? result.error.fieldErrors?.note;
        setFieldError(fieldMessage);
        setFormError(fieldMessage ? null : result.error.message);
        return;
      }
      toast.success(successMessage);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) {
          setReason("");
          setFieldError(undefined);
          setFormError(null);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {children}
          <Field label={reasonLabel} optional={!reasonRequired} error={fieldError}>
            {(props) => (
              <Textarea
                {...props}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={280}
                rows={3}
                placeholder={reasonPlaceholder}
                className="bg-card text-sm"
              />
            )}
          </Field>
          {formError ? <Callout tone="danger">{formError}</Callout> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <SubmitButton
              variant={destructive ? "destructive" : "default"}
              pending={pending}
              pendingLabel={pendingLabel}
              className="h-auto min-h-9 shrink py-1.5 text-balance whitespace-normal"
            >
              {confirmLabel}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
