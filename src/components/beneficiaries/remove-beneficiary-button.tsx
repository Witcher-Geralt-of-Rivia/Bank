"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SubmitButton } from "@/components/shared/client";
import { Callout } from "@/components/shared/page";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { archiveBeneficiaryAction } from "@/server/actions/banking";

/**
 * Removes a beneficiary after confirmation. The record is archived rather
 * than deleted, so transfers already sent keep pointing at it.
 */
export function RemoveBeneficiaryButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await archiveBeneficiaryAction({ id });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      toast.success(`${name} se eliminó de tus beneficiarios`);
      // Stay pending until the list has loaded, so the button cannot be pressed twice.
      startTransition(() => router.push("/beneficiaries"));
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="lg">
          <Trash2 /> Eliminar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar a {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Ya no aparecerá entre tus beneficiarios ni al enviar dinero. Las transferencias anteriores se conservan en tu historial de transacciones.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <SubmitButton type="button" variant="destructive" pending={pending} pendingLabel="Eliminando…" onClick={remove}>
            Eliminar beneficiario
          </SubmitButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
