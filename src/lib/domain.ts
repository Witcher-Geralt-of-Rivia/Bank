/**
 * Shared domain vocabulary. Safe to import from both server and client code:
 * it contains only constants, types and display labels.
 */

export const ROLES = ["customer", "operator", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  customer: "Cliente",
  operator: "Operador",
  admin: "Administrador",
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
  checking: "Cuenta corriente",
  savings: "Ahorros",
  reserve: "Reserva",
  clearing: "Compensación externa",
  transit: "Pagos en tránsito",
  fees: "Ingresos por comisiones",
  interest: "Gasto por intereses",
};

export const ACCOUNT_STATUSES = ["active", "frozen", "closed"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  active: "Activa",
  frozen: "Congelada",
  closed: "Cerrada",
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
  transfer_internal: "Transferencia interna",
  transfer_out: "Transferencia enviada",
  transfer_in: "Transferencia recibida",
  deposit: "Depósito",
  withdrawal: "Retiro",
  card_payment: "Pago con tarjeta",
  fee: "Comisión",
  interest: "Intereses",
  reversal: "Reversión",
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
  pending: "Pendiente de revisión",
  processing: "En proceso",
  completed: "Completada",
  failed: "Fallida",
  reversed: "Revertida",
};

export const TRANSACTION_STATUS_DESCRIPTIONS: Record<TransactionStatus, string> =
  {
    pending:
      "En espera de revisión por el equipo de operaciones. Los fondos están retenidos, pero aún no han salido de la cuenta.",
    processing:
      "Los fondos salieron de la cuenta y están en tránsito hacia el banco receptor.",
    completed:
      "Liquidada. El movimiento es definitivo y quedó registrado en el libro mayor.",
    failed:
      "El movimiento no se completó. Los fondos retenidos o debitados fueron devueltos.",
    reversed:
      "Revertida mediante una transacción compensatoria. El registro original se conserva.",
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
  client_payments: "Pagos de clientes",
  payroll: "Nómina",
  contractors: "Contratistas",
  rent: "Alquiler e instalaciones",
  software: "Software y nube",
  utilities: "Servicios públicos",
  insurance: "Seguros",
  travel: "Viajes",
  marketing: "Marketing",
  office: "Oficina e insumos",
  meals: "Comidas",
  taxes: "Impuestos",
  bank_fees: "Comisiones bancarias",
  interest: "Intereses",
  transfers: "Transferencias",
  other: "Otros",
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
  "auth.login": "Inicio de sesión",
  "auth.login_failed": "Intento fallido de inicio de sesión",
  "auth.logout": "Cierre de sesión",
  "auth.registered": "Cuenta registrada",
  "auth.password_changed": "Contraseña cambiada",
  "auth.password_reset_requested": "Restablecimiento de contraseña solicitado",
  "profile.updated": "Perfil actualizado",
  "security.two_factor_enabled": "Verificación en dos pasos activada",
  "security.two_factor_disabled": "Verificación en dos pasos desactivada",
  "beneficiary.created": "Beneficiario agregado",
  "beneficiary.archived": "Beneficiario eliminado",
  "transfer.created": "Transferencia creada",
  "transfer.approved": "Transferencia aprobada",
  "transfer.rejected": "Transferencia rechazada",
  "transfer.settled": "Transferencia liquidada",
  "transfer.failed": "Transferencia fallida",
  "transaction.reversed": "Transacción revertida",
  "deposit.created": "Depósito registrado",
  "withdrawal.created": "Retiro registrado",
  "account.opened": "Cuenta abierta",
  "account.frozen": "Cuenta congelada",
  "account.unfrozen": "Cuenta descongelada",
  "user.suspended": "Usuario suspendido",
  "user.reactivated": "Usuario reactivado",
  "user.role_changed": "Rol de usuario cambiado",
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
