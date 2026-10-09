"use client";

import { RotateCcw, Snowflake } from "lucide-react";
import { ReasonDialog } from "@/components/admin/reason-dialog";
import { Button } from "@/components/ui/button";
import { setAccountStatusAction } from "@/server/actions/admin";

/**
 * Freeze or unfreeze one customer account.
 *
 * The reason is required and stored with the audit record; the account holder
 * is notified by the same transaction that changes the status.
 */
export function AccountStatusAction({
  id,
  name,
  ownerName,
  status,
}: {
  id: string;
  name: string;
  ownerName: string | null;
  status: "active" | "frozen";
}) {
  const holder = ownerName ?? "El titular de la cuenta";

  if (status === "frozen") {
    return (
      <ReasonDialog
        trigger={
          <Button variant="outline" size="sm" aria-label={`Descongelar ${name}`}>
            <RotateCcw /> Descongelar
          </Button>
        }
        title={`¿Descongelar ${name}?`}
        description={`La cuenta podrá volver a enviar y recibir fondos. ${holder} recibe una notificación.`}
        confirmLabel="Descongelar cuenta"
        pendingLabel="Descongelando…"
        successMessage={`Cuenta activa de nuevo: ${name}`}
        onConfirm={(reason) => setAccountStatusAction({ id, status: "active", reason })}
      />
    );
  }

  return (
    <ReasonDialog
      trigger={
        <Button variant="outline" size="sm" aria-label={`Congelar ${name}`}>
          <Snowflake /> Congelar
        </Button>
      }
      title={`¿Congelar ${name}?`}
      description={`La cuenta no podrá enviar ni recibir fondos hasta que se descongele. ${holder} recibe una notificación, y el saldo y el historial se mantienen como están.`}
      confirmLabel="Congelar cuenta"
      pendingLabel="Congelando…"
      destructive
      successMessage={`Cuenta congelada: ${name}`}
      onConfirm={(reason) => setAccountStatusAction({ id, status: "frozen", reason })}
    />
  );
}
