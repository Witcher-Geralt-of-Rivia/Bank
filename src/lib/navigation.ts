import type { Role } from "./domain";

export type NavIcon =
  | "overview"
  | "accounts"
  | "transactions"
  | "transfer"
  | "beneficiaries"
  | "insights"
  | "notifications"
  | "settings"
  | "operations"
  | "monitoring"
  | "customers"
  | "ledger"
  | "audit";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  /** Match the path exactly rather than by prefix. */
  exact?: boolean;
};

export type NavGroup = { label: string; items: NavItem[] };

const CUSTOMER_NAV: NavGroup[] = [
  {
    label: "Banca",
    items: [
      { href: "/dashboard", label: "Resumen", icon: "overview" },
      { href: "/accounts", label: "Cuentas", icon: "accounts" },
      { href: "/transactions", label: "Transacciones", icon: "transactions" },
      { href: "/transfers/new", label: "Transferir", icon: "transfer" },
      { href: "/beneficiaries", label: "Beneficiarios", icon: "beneficiaries" },
      { href: "/insights", label: "Análisis", icon: "insights" },
    ],
  },
];

const STAFF_NAV: NavGroup[] = [
  {
    label: "Operaciones",
    items: [
      { href: "/admin", label: "Resumen", icon: "operations", exact: true },
      { href: "/admin/transactions", label: "Monitoreo", icon: "monitoring" },
      { href: "/admin/users", label: "Usuarios", icon: "customers" },
      { href: "/admin/accounts", label: "Cuentas", icon: "ledger" },
      { href: "/admin/audit", label: "Registro de auditoría", icon: "audit" },
    ],
  },
];

const PERSONAL_NAV: NavGroup = {
  label: "Tu cuenta",
  items: [
    { href: "/notifications", label: "Notificaciones", icon: "notifications" },
    { href: "/settings", label: "Configuración", icon: "settings" },
  ],
};

/** The navigation a role is offered. Access itself is enforced on the server. */
export function navigationFor(role: Role): NavGroup[] {
  return [...(role === "customer" ? CUSTOMER_NAV : STAFF_NAV), PERSONAL_NAV];
}

/** The four destinations pinned to the bottom bar on phones. */
export const MOBILE_TABS: NavItem[] = [
  { href: "/dashboard", label: "Inicio", icon: "overview" },
  { href: "/accounts", label: "Cuentas", icon: "accounts" },
  { href: "/transfers/new", label: "Enviar", icon: "transfer" },
  { href: "/transactions", label: "Actividad", icon: "transactions" },
];

export function isActivePath(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  // "Move money" lives under /transfers; keep it active across its steps.
  const base = item.href === "/transfers/new" ? "/transfers" : item.href;
  return pathname === base || pathname.startsWith(`${base}/`);
}
