import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Lock,
  ShieldCheck,
  Snowflake,
  Undo2,
  UserX,
} from "lucide-react";
import type { ComponentType } from "react";
import {
  ACCOUNT_STATUS_LABELS,
  type AccountStatus,
  ROLE_LABELS,
  type Role,
  TRANSACTION_STATUS_LABELS,
  type TransactionStatus,
  type UserStatus,
} from "@/lib/domain";
import { cn } from "@/lib/utils";

export type Tone = "success" | "warning" | "info" | "danger" | "neutral" | "muted";

const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  info: "bg-info-soft text-info",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-neutral-soft text-neutral",
  muted: "bg-muted text-muted-foreground",
};

/** A status is never colour alone: every pill carries an icon and a label. */
export function Pill({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: Tone;
  icon?: ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {Icon ? <Icon className="size-3.5" /> : null}
      {children}
    </span>
  );
}

const TRANSACTION_STATUS: Record<
  TransactionStatus,
  { tone: Tone; icon: ComponentType<{ className?: string }> }
> = {
  pending: { tone: "warning", icon: Clock },
  processing: { tone: "info", icon: CircleDashed },
  completed: { tone: "success", icon: CircleCheck },
  failed: { tone: "danger", icon: CircleX },
  reversed: { tone: "neutral", icon: Undo2 },
};

export function transactionStatusTone(status: TransactionStatus): Tone {
  return TRANSACTION_STATUS[status].tone;
}

export function StatusBadge({
  status,
  className,
}: {
  status: TransactionStatus;
  className?: string;
}) {
  const { tone, icon } = TRANSACTION_STATUS[status];
  return (
    <Pill tone={tone} icon={icon} className={className}>
      {TRANSACTION_STATUS_LABELS[status]}
    </Pill>
  );
}

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  if (status === "active") {
    return (
      <Pill tone="success" icon={CircleCheck}>
        {ACCOUNT_STATUS_LABELS.active}
      </Pill>
    );
  }
  return (
    <Pill tone={status === "frozen" ? "info" : "muted"} icon={status === "frozen" ? Snowflake : Lock}>
      {ACCOUNT_STATUS_LABELS[status]}
    </Pill>
  );
}

export function UserStatusBadge({ status }: { status: UserStatus }) {
  return status === "active" ? (
    <Pill tone="success" icon={CircleCheck}>
      Active
    </Pill>
  ) : (
    <Pill tone="danger" icon={UserX}>
      Suspended
    </Pill>
  );
}

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Pill tone={role === "customer" ? "muted" : role === "admin" ? "neutral" : "info"} icon={role === "customer" ? undefined : ShieldCheck}>
      {ROLE_LABELS[role]}
    </Pill>
  );
}
