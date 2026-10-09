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
const NOTE_HINT = "Visible to the customer in the status history";
const REASON_HINT = "Shared with the customer and recorded in the audit log";

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
      <Actions lead="This transfer is on hold for review. Approve it to send the money, or reject it to release the hold.">
        <ReasonDialog
          trigger={
            <Button className="flex-1 sm:flex-none">
              <Check /> Approve
            </Button>
          }
          title="Approve this transfer?"
          description={`The reserved ${amount} will leave the customer's account and be submitted to the payment network. The transfer stays in processing until the receiving bank confirms it.`}
          confirmLabel="Approve transfer"
          pendingLabel="Approving…"
          reasonLabel="Note"
          reasonPlaceholder={NOTE_HINT}
          reasonRequired={false}
          successMessage="Transfer approved"
          onConfirm={(note) => approveTransferAction({ id, note: note || undefined })}
        />
        <ReasonDialog
          trigger={
            <Button variant="destructive" className="flex-1 sm:flex-none">
              <X /> Reject
            </Button>
          }
          title="Reject this transfer?"
          description={`No money will move. The reserved ${amount} will be released back to the customer's available balance and the transfer will be marked as failed.`}
          confirmLabel="Reject transfer"
          pendingLabel="Rejecting…"
          destructive
          reasonPlaceholder={REASON_HINT}
          successMessage="Transfer rejected"
          onConfirm={(reason) => rejectTransferAction({ id, reason })}
        />
      </Actions>
    );
  }

  if (status === "processing") {
    return (
      <Actions lead="The money has left the customer's account and is in transit. Mark the transfer as settled once the receiving bank confirms it, or fail it to return the funds.">
        <ReasonDialog
          trigger={
            <Button className="flex-1 sm:flex-none">
              <CircleCheck /> Mark as settled
            </Button>
          }
          title="Mark this transfer as settled?"
          description={`This confirms that the receiving bank has the ${amount}. The funds leave payments in transit and the transfer becomes final. The customer's balance does not change, because the money was debited when the transfer was sent.`}
          confirmLabel="Mark as settled"
          pendingLabel="Settling…"
          reasonLabel="Note"
          reasonPlaceholder={NOTE_HINT}
          reasonRequired={false}
          successMessage="Transfer marked as settled"
          onConfirm={(note) => settleTransferAction({ id, note: note || undefined })}
        />
        <ReasonDialog
          trigger={
            <Button variant="destructive" className="flex-1 sm:flex-none">
              <CircleX /> Fail and return funds
            </Button>
          }
          title="Fail this transfer and return the funds?"
          description={`The transfer will be marked as failed and the ${amount} held in transit will be credited back to the customer's account.`}
          confirmLabel="Fail and return funds"
          pendingLabel="Returning funds…"
          destructive
          reasonPlaceholder={REASON_HINT}
          successMessage="Transfer failed and funds returned"
          onConfirm={(reason) => failTransferAction({ id, reason })}
        />
      </Actions>
    );
  }

  if (status === "completed" && type !== "reversal") {
    if (role !== "admin") {
      return <Note>Reversing a completed transaction requires an administrator.</Note>;
    }
    return (
      <Actions lead="This transaction is settled. It can only be undone by a reversal, which posts an opposite transaction and keeps this one on record.">
        <ReasonDialog
          trigger={
            <Button variant="destructive" className="flex-1 sm:flex-none">
              <Undo2 /> Reverse
            </Button>
          }
          title="Reverse this transaction?"
          description={`A new reversal transaction will post the opposite of every ledger entry, so the ${amount} goes back to where it came from. The original stays on record and is marked as reversed. A reversal cannot itself be reversed.`}
          confirmLabel="Reverse transaction"
          pendingLabel="Reversing…"
          destructive
          reasonPlaceholder={REASON_HINT}
          successMessage="Transaction reversed"
          onConfirm={(reason) => reverseTransactionAction({ id, reason })}
        />
      </Actions>
    );
  }

  return (
    <Note>
      {status === "completed"
        ? "This reversal is final. A reversal cannot itself be reversed."
        : "This transaction is final. No further actions are available."}
    </Note>
  );
}
