/**
 * Shared domain vocabulary. Safe to import from both server and client code:
 * it contains only constants, types and display labels.
 */

export const ROLES = ["customer", "operator", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  customer: "Customer",
  operator: "Operator",
  admin: "Administrator",
};

export const STAFF_ROLES: readonly Role[] = ["operator", "admin"];

export function isStaff(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}

export const USER_STATUSES = ["active", "suspended"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ACCOUNT_KINDS = ["customer", "system"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const ACCOUNT_TYPES = [
  "checking",
  "savings",
  "reserve",
  "clearing",
  "transit",
  "fees",
  "interest",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: "Checking",
  savings: "Savings",
  reserve: "Reserve",
  clearing: "External clearing",
  transit: "Payments in transit",
  fees: "Fee income",
  interest: "Interest expense",
};

export const ACCOUNT_STATUSES = ["active", "frozen", "closed"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  active: "Active",
  frozen: "Frozen",
  closed: "Closed",
};

export const TRANSACTION_TYPES = [
  "transfer_internal",
  "transfer_out",
  "transfer_in",
  "deposit",
  "withdrawal",
  "card_payment",
  "fee",
  "interest",
  "reversal",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  transfer_internal: "Internal transfer",
  transfer_out: "Outgoing transfer",
  transfer_in: "Incoming transfer",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  card_payment: "Card payment",
  fee: "Fee",
  interest: "Interest",
  reversal: "Reversal",
};

export const TRANSACTION_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "reversed",
] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  pending: "Pending review",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  reversed: "Reversed",
};

export const TRANSACTION_STATUS_DESCRIPTIONS: Record<TransactionStatus, string> =
  {
    pending:
      "Awaiting review by the operations team. Funds are reserved but have not left the account.",
    processing:
      "Funds have left the account and are in transit to the receiving bank.",
    completed: "Settled. The movement is final and recorded on the ledger.",
    failed:
      "The movement did not complete. Any reserved or debited funds were returned.",
    reversed:
      "Reversed by a compensating transaction. The original record is retained.",
  };

/**
 * Allowed status transitions. Anything not listed is rejected by the ledger
 * service, so a transaction can never move backwards or skip settlement.
 */
export const STATUS_TRANSITIONS: Record<
  TransactionStatus,
  readonly TransactionStatus[]
> = {
  pending: ["processing", "failed"],
  processing: ["completed", "failed"],
  completed: ["reversed"],
  failed: [],
  reversed: [],
};

export function canTransition(
  from: TransactionStatus,
  to: TransactionStatus,
): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

export const ENTRY_DIRECTIONS = ["debit", "credit"] as const;
export type EntryDirection = (typeof ENTRY_DIRECTIONS)[number];

export const BENEFICIARY_KINDS = ["internal", "external"] as const;
export type BeneficiaryKind = (typeof BENEFICIARY_KINDS)[number];

export const NOTIFICATION_KINDS = [
  "transaction",
  "security",
  "account",
  "system",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Spending and income categories used by analytics. */
export const CATEGORIES = {
  client_payments: "Client payments",
  payroll: "Payroll",
  contractors: "Contractors",
  rent: "Rent & facilities",
  software: "Software & cloud",
  utilities: "Utilities",
  insurance: "Insurance",
  travel: "Travel",
  marketing: "Marketing",
  office: "Office & supplies",
  meals: "Meals",
  taxes: "Taxes",
  bank_fees: "Bank fees",
  interest: "Interest",
  transfers: "Transfers",
  other: "Other",
} as const;
export type Category = keyof typeof CATEGORIES;

export function categoryLabel(category: string | null | undefined): string {
  if (category && category in CATEGORIES) {
    return CATEGORIES[category as Category];
  }
  return CATEGORIES.other;
}

/** Audit actions, grouped by the area of the product they belong to. */
export const AUDIT_ACTIONS = {
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in attempt",
  "auth.logout": "Signed out",
  "auth.registered": "Account registered",
  "auth.password_changed": "Password changed",
  "auth.password_reset_requested": "Password reset requested",
  "profile.updated": "Profile updated",
  "security.two_factor_enabled": "Two-step verification enabled",
  "security.two_factor_disabled": "Two-step verification disabled",
  "beneficiary.created": "Beneficiary added",
  "beneficiary.archived": "Beneficiary removed",
  "transfer.created": "Transfer created",
  "transfer.approved": "Transfer approved",
  "transfer.rejected": "Transfer rejected",
  "transfer.settled": "Transfer settled",
  "transfer.failed": "Transfer failed",
  "transaction.reversed": "Transaction reversed",
  "deposit.created": "Deposit recorded",
  "withdrawal.created": "Withdrawal recorded",
  "account.opened": "Account opened",
  "account.frozen": "Account frozen",
  "account.unfrozen": "Account unfrozen",
  "user.suspended": "User suspended",
  "user.reactivated": "User reactivated",
  "user.role_changed": "User role changed",
} as const;
export type AuditAction = keyof typeof AUDIT_ACTIONS;

export function auditActionLabel(action: string): string {
  return action in AUDIT_ACTIONS
    ? AUDIT_ACTIONS[action as AuditAction]
    : action;
}

export function auditArea(action: string): string {
  return action.split(".")[0] ?? "other";
}

/** Policy limits applied to customer-initiated transfers (minor units). */
export const TRANSFER_POLICY = {
  /** External transfers at or above this amount are held for manual review. */
  reviewThresholdMinor: 1_000_000n,
  /** Hard ceiling for a single customer-initiated movement. */
  maxAmountMinor: 25_000_000n,
} as const;

/** "•••• 4821" */
export function maskAccountNumber(number: string): string {
  const compact = number.replace(/\s+/g, "");
  return `•••• ${compact.slice(-4)}`;
}
