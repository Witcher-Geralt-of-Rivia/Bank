"use client";

import { Check, CircleCheck, CircleX, Lock, Undo2, X } from "lucide-react";
import { ReasonDialog } from "@/components/admin/reason-dialog";
import { Button } from "@/components/ui/button";
import type { Role, TransactionStatus, TransactionType } from "@/lib/domain";
import {
  approveTransferAction,
  failTransferAction,
  rejectTransferAction,
  reverseTransactionAction,
  settleTransferAction,
} from "@/server/actions/admin";

// Notes and reasons end up in the status history and in the customer's
// notifications, so staff are told before they type.
const NOTE_HINT = "Visible para el cliente en el historial de estados";
const REASON_HINT = "Se comparte con el cliente y queda anotado en el registro de auditoría";

function Actions({ lead, children }: { lead: string; children: React.ReactNode }) {
  return (
    <>
      <p className="max-w-xl text-sm text-pretty text-muted-foreground">{lead}</p>
      <div className="mt-4 flex flex-wrap gap-2">{children}</div>
    </>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <Lock className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  );
}

/**
 * What staff can do with a transaction in its current status. Each action is
 * confirmed in a dialog that says where the money will go. Hiding a button is
 * a convenience only: the Server Actions check the role and the status again.
 */
export function TransactionActions({
  id,
  status,
  type,
  role,
  amount,
}: {
  id: string;
  status: TransactionStatus;
  type: TransactionType;
  /** Role of the person viewing the page. */
  role: Role;
  /** Formatted amount, for the confirmation text. */
  amount: string;
}) {
  if (status === "pending") {
    return (
      <Actions lead="Esta transferencia está retenida para revisión. Apruébala para enviar el dinero o recházala para liberar los fondos retenidos.">
        <ReasonDialog
          trigger={
            <Button className="flex-1 sm:flex-none">
              <Check /> Aprobar
            </Button>
          }
          title="¿Aprobar esta transferencia?"
          description={`Los ${amount} retenidos saldrán de la cuenta del cliente y se enviarán a la red de pagos. La transferencia seguirá en proceso hasta que el banco receptor la confirme.`}
          confirmLabel="Aprobar transferencia"
          pendingLabel="Aprobando…"
          reasonLabel="Nota"
          reasonPlaceholder={NOTE_HINT}
          reasonRequired={false}
          successMessage="Transferencia aprobada"
          onConfirm={(note) => approveTransferAction({ id, note: note || undefined })}
        />
        <ReasonDialog
          trigger={
            <Button variant="destructive" className="flex-1 sm:flex-none">
              <X /> Rechazar
            </Button>
          }
          title="¿Rechazar esta transferencia?"
          description={`No se moverá dinero. Los ${amount} retenidos se liberarán y volverán al saldo disponible del cliente, y la transferencia quedará marcada como fallida.`}
          confirmLabel="Rechazar transferencia"
          pendingLabel="Rechazando…"
          destructive
          reasonPlaceholder={REASON_HINT}
          successMessage="Transferencia rechazada"
          onConfirm={(reason) => rejectTransferAction({ id, reason })}
        />
      </Actions>
    );
  }

  if (status === "processing") {
    return (
      <Actions lead="El dinero ya salió de la cuenta del cliente y está en tránsito. Marca la transferencia como liquidada cuando el banco receptor la confirme, o márcala como fallida para devolver los fondos.">
        <ReasonDialog
          trigger={
            <Button className="flex-1 sm:flex-none">
              <CircleCheck /> Marcar como liquidada
            </Button>
          }
          title="¿Marcar esta transferencia como liquidada?"
          description={`Con esto se confirma la liquidación: el banco receptor ya tiene los ${amount}. Los fondos salen de la cuenta de pagos en tránsito y la transferencia pasa a ser definitiva. El saldo del cliente no cambia, porque el dinero se debitó cuando se envió la transferencia.`}
          confirmLabel="Marcar como liquidada"
          pendingLabel="Liquidando…"
          reasonLabel="Nota"
          reasonPlaceholder={NOTE_HINT}
          reasonRequired={false}
          successMessage="Transferencia marcada como liquidada"
          onConfirm={(note) => settleTransferAction({ id, note: note || undefined })}
        />
        <ReasonDialog
          trigger={
            <Button variant="destructive" className="h-auto min-h-9 flex-1 basis-full py-1.5 text-balance whitespace-normal sm:flex-none">
              <CircleX /> Marcar como fallida y devolver los fondos
            </Button>
          }
          title="¿Marcar como fallida y devolver los fondos?"
          description={`La transferencia quedará marcada como fallida y los ${amount} que están en tránsito se acreditarán de vuelta en la cuenta del cliente.`}
          confirmLabel="Marcar como fallida y devolver los fondos"
          pendingLabel="Devolviendo los fondos…"
          destructive
          reasonPlaceholder={REASON_HINT}
          successMessage="Transferencia marcada como fallida y fondos devueltos"
          onConfirm={(reason) => failTransferAction({ id, reason })}
        />
      </Actions>
    );
  }

  if (status === "completed" && type !== "reversal") {
    if (role !== "admin") {
      return <Note>Solo un administrador puede revertir una transacción completada.</Note>;
    }
    return (
      <Actions lead="Esta transacción ya está liquidada. Solo puede deshacerse con una reversión, que registra una transacción compensatoria y conserva esta en el historial.">
        <ReasonDialog
          trigger={
            <Button variant="destructive" className="flex-1 sm:flex-none">
              <Undo2 /> Revertir
            </Button>
          }
          title="¿Revertir esta transacción?"
          description={`Se registrará una transacción compensatoria (una reversión) con el asiento opuesto a cada asiento contable original, de modo que los ${amount} vuelvan al lugar de donde salieron. La transacción original se conserva y queda marcada como revertida. Una reversión no puede revertirse a su vez.`}
          confirmLabel="Revertir transacción"
          pendingLabel="Revirtiendo…"
          destructive
          reasonPlaceholder={REASON_HINT}
          successMessage="Transacción revertida"
          onConfirm={(reason) => reverseTransactionAction({ id, reason })}
        />
      </Actions>
    );
  }

  return (
    <Note>
      {status === "completed"
        ? "Esta reversión es definitiva. Una reversión no puede revertirse a su vez."
        : "Esta transacción es definitiva. No hay más acciones disponibles."}
    </Note>
  );
}
