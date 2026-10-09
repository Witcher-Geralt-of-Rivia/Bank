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
  const holder = ownerName ?? "The account holder";

  if (status === "frozen") {
    return (
      <ReasonDialog
        trigger={
          <Button variant="outline" size="sm" aria-label={`Unfreeze ${name}`}>
            <RotateCcw /> Unfreeze
          </Button>
        }
        title={`Unfreeze ${name}?`}
        description={`The account will be able to send and receive funds again. ${holder} is notified.`}
        confirmLabel="Unfreeze account"
        pendingLabel="Unfreezing…"
        successMessage={`${name} is active again`}
        onConfirm={(reason) => setAccountStatusAction({ id, status: "active", reason })}
      />
    );
  }

  return (
    <ReasonDialog
      trigger={
        <Button variant="outline" size="sm" aria-label={`Freeze ${name}`}>
          <Snowflake /> Freeze
        </Button>
      }
      title={`Freeze ${name}?`}
      description={`The account will not be able to send or receive funds until it is unfrozen. ${holder} is notified, and the balance and history stay as they are.`}
      confirmLabel="Freeze account"
      pendingLabel="Freezing…"
      destructive
      successMessage={`${name} frozen`}
      onConfirm={(reason) => setAccountStatusAction({ id, status: "frozen", reason })}
    />
  );
}
