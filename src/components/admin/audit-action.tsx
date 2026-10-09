import {
  ArrowDownToLine,
  ArrowUpFromLine,
  KeyRound,
  ScrollText,
  Send,
  ShieldCheck,
  Undo2,
  UserCog,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import type { ComponentType } from "react";
import { Pill, type Tone } from "@/components/shared/status";
import { auditActionLabel, auditArea } from "@/lib/domain";
import { cn } from "@/lib/utils";

/** The areas of the product that write audit records, in filter order. */
export const AUDIT_AREAS = [
  { value: "auth", label: "Sign-in" },
  { value: "transfer", label: "Transfers" },
  { value: "transaction", label: "Transactions" },
  { value: "deposit", label: "Deposits" },
  { value: "withdrawal", label: "Withdrawals" },
  { value: "beneficiary", label: "Beneficiaries" },
  { value: "account", label: "Accounts" },
  { value: "user", label: "Users" },
  { value: "profile", label: "Profile" },
  { value: "security", label: "Security" },
] as const;

export type AuditAreaValue = (typeof AUDIT_AREAS)[number]["value"];

type AreaStyle = { tone: Tone; icon: ComponentType<{ className?: string }> };

/**
 * Tone follows the area, not the outcome: money movement in the informational
 * colours, changes to access and security in amber, everyday activity muted.
 */
const AREA_STYLES: Record<AuditAreaValue, AreaStyle> = {
  auth: { tone: "muted", icon: KeyRound },
  transfer: { tone: "info", icon: Send },
  transaction: { tone: "neutral", icon: Undo2 },
  deposit: { tone: "success", icon: ArrowDownToLine },
  withdrawal: { tone: "muted", icon: ArrowUpFromLine },
  beneficiary: { tone: "muted", icon: Users },
  account: { tone: "info", icon: Wallet },
  user: { tone: "warning", icon: UserCog },
  profile: { tone: "muted", icon: UserRound },
  security: { tone: "warning", icon: ShieldCheck },
};

const FALLBACK_STYLE: AreaStyle = { tone: "muted", icon: ScrollText };

/** An audit action as a pill: an icon for its area and the action's label. */
export function AuditActionPill({ action, className }: { action: string; className?: string }) {
  const area = auditArea(action);
  const { tone, icon } = area in AREA_STYLES ? AREA_STYLES[area as AuditAreaValue] : FALLBACK_STYLE;
  return (
    <Pill tone={tone} icon={icon} className={cn("max-w-full", className)}>
      <span className="truncate">{auditActionLabel(action)}</span>
    </Pill>
  );
}
