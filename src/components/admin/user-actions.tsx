"use client";

import { Check, UserCheck, UserCog, UserX } from "lucide-react";
import { type ComponentType, useId, useState } from "react";
import { ReasonDialog } from "@/components/admin/reason-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ROLES, ROLE_LABELS, type Role, type UserStatus } from "@/lib/domain";
import type { ActionResult } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { setUserRoleAction, setUserStatusAction } from "@/server/actions/admin";

const ROLE_SUMMARIES: Record<Role, string> = {
  customer: "Banking only. No access to the operations console.",
  operator: "Reviews and settles transfers, and can freeze accounts.",
  admin: "Everything an operator can do, plus reversals and user management.",
};

/**
 * Trigger for one row action: a labelled button where there is room, or an
 * icon with a tooltip in the table. Extra props come from the dialog that
 * wraps it and must reach the underlying button.
 */
function ActionButton({
  compact,
  icon: Icon,
  label,
  ...props
}: {
  compact: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
} & React.ComponentProps<typeof Button>) {
  if (!compact) {
    return (
      <Button variant="outline" size="sm" {...props}>
        <Icon /> {label}
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" {...props}>
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Suspend or reactivate a user and change their role. Administrators only:
 * the page renders this for nobody else, and the Server Actions refuse anyone
 * else regardless, as well as any change to the caller's own user.
 */
export function UserActions({
  id,
  name,
  role,
  status,
  compact = false,
}: {
  id: string;
  name: string;
  role: Role;
  status: UserStatus;
  /** Icon-only buttons, for the table. */
  compact?: boolean;
}) {
  const groupId = useId();
  const [nextRole, setNextRole] = useState<Role | null>(null);
  const suspended = status === "suspended";
  const firstName = name.split(" ")[0];

  async function changeRole(reason: string): Promise<ActionResult<unknown>> {
    if (!nextRole) {
      return { ok: false, error: { code: "validation_failed", message: "Choose a new role." } };
    }
    const result = await setUserRoleAction({ id, role: nextRole, reason });
    if (result.ok) setNextRole(null);
    return result;
  }

  return (
    <div className={cn("flex", compact ? "justify-end gap-0.5" : "flex-wrap gap-2")}>
      {suspended ? (
        <ReasonDialog
          trigger={<ActionButton compact={compact} icon={UserCheck} label="Reactivate" aria-label={`Reactivate ${name}`} />}
          title={`Reactivate ${name}?`}
          description={`${firstName} will be able to sign in again straight away, with the same role and accounts as before.`}
          confirmLabel="Reactivate user"
          pendingLabel="Reactivating…"
          successMessage={`${name} reactivated`}
          onConfirm={(reason) => setUserStatusAction({ id, status: "active", reason })}
        />
      ) : (
        <ReasonDialog
          trigger={<ActionButton compact={compact} icon={UserX} label="Suspend" aria-label={`Suspend ${name}`} />}
          title={`Suspend ${name}?`}
          description={`${firstName} will be signed out and will not be able to sign in again until reactivated. Their accounts, balances and transaction history are not changed.`}
          confirmLabel="Suspend user"
          pendingLabel="Suspending…"
          destructive
          successMessage={`${name} suspended`}
          onConfirm={(reason) => setUserStatusAction({ id, status: "suspended", reason })}
        />
      )}

      <ReasonDialog
        trigger={
          <ActionButton
            compact={compact}
            icon={UserCog}
            label="Change role"
            aria-label={`Change role for ${name}`}
            // Start from a clean choice each time the dialog opens.
            onClick={() => setNextRole(null)}
          />
        }
        title={`Change role for ${name}`}
        description={`${firstName} is currently ${role === "customer" ? "a" : "an"} ${ROLE_LABELS[role].toLowerCase()}. The new role applies from the next page they open.`}
        confirmLabel="Change role"
        pendingLabel="Updating…"
        successMessage="Role updated"
        onConfirm={changeRole}
      >
        <div className="grid gap-1.5">
          <p id={`${groupId}-label`} className="text-sm leading-none font-medium">
            New role
          </p>
          <div role="radiogroup" aria-labelledby={`${groupId}-label`} className="grid gap-2">
            {ROLES.filter((option) => option !== role).map((option) => {
              const checked = nextRole === option;
              return (
                <label
                  key={option}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring/60",
                    checked ? "border-primary/60 bg-accent/50" : "border-border hover:border-primary/40",
                  )}
                >
                  <input
                    type="radio"
                    name={`${groupId}-role`}
                    checked={checked}
                    onChange={() => setNextRole(option)}
                    className="sr-only"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{ROLE_LABELS[option]}</span>
                    <span className="block text-xs text-pretty text-muted-foreground">{ROLE_SUMMARIES[option]}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                      checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
                    )}
                  >
                    {checked ? <Check className="size-3" /> : null}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </ReasonDialog>
    </div>
  );
}
