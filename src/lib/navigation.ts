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
    label: "Banking",
    items: [
      { href: "/dashboard", label: "Overview", icon: "overview" },
      { href: "/accounts", label: "Accounts", icon: "accounts" },
      { href: "/transactions", label: "Transactions", icon: "transactions" },
      { href: "/transfers/new", label: "Move money", icon: "transfer" },
      { href: "/beneficiaries", label: "Beneficiaries", icon: "beneficiaries" },
      { href: "/insights", label: "Insights", icon: "insights" },
    ],
  },
];

const STAFF_NAV: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { href: "/admin", label: "Overview", icon: "operations", exact: true },
      { href: "/admin/transactions", label: "Monitoring", icon: "monitoring" },
      { href: "/admin/users", label: "Users", icon: "customers" },
      { href: "/admin/accounts", label: "Accounts", icon: "ledger" },
      { href: "/admin/audit", label: "Audit log", icon: "audit" },
    ],
  },
];

const PERSONAL_NAV: NavGroup = {
  label: "You",
  items: [
    { href: "/notifications", label: "Notifications", icon: "notifications" },
    { href: "/settings", label: "Settings", icon: "settings" },
  ],
};

/** The navigation a role is offered. Access itself is enforced on the server. */
export function navigationFor(role: Role): NavGroup[] {
  return [...(role === "customer" ? CUSTOMER_NAV : STAFF_NAV), PERSONAL_NAV];
}

/** The four destinations pinned to the bottom bar on phones. */
export const MOBILE_TABS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "overview" },
  { href: "/accounts", label: "Accounts", icon: "accounts" },
  { href: "/transfers/new", label: "Send", icon: "transfer" },
  { href: "/transactions", label: "Activity", icon: "transactions" },
];

export function isActivePath(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  // "Move money" lives under /transfers; keep it active across its steps.
  const base = item.href === "/transfers/new" ? "/transfers" : item.href;
  return pathname === base || pathname.startsWith(`${base}/`);
}
