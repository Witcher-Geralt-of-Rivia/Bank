"use client";

import {
  Activity,
  ArrowLeftRight,
  Bell,
  ChartColumn,
  Landmark,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  ScrollText,
  Send,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ComponentType, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ROLE_LABELS, type Role } from "@/lib/domain";
import { initials } from "@/lib/format";
import { MOBILE_TABS, type NavGroup, type NavIcon, type NavItem, isActivePath } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/server/actions/auth";

const ICONS: Record<NavIcon, ComponentType<{ className?: string }>> = {
  overview: LayoutDashboard,
  accounts: Wallet,
  transactions: ArrowLeftRight,
  transfer: Send,
  beneficiaries: Users,
  insights: ChartColumn,
  notifications: Bell,
  settings: Settings,
  operations: Activity,
  monitoring: ListChecks,
  customers: Users,
  ledger: Landmark,
  audit: ScrollText,
};

export type ShellUser = { name: string; email: string; role: Role };

function NavLink({
  item,
  active,
  badge,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  badge?: number;
  onNavigate?: () => void;
}) {
  const Icon = ICONS[item.icon];
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/70",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
      )}
    >
      {active ? <span aria-hidden="true" className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r-full bg-sidebar-primary" /> : null}
      <Icon className={cn("size-[1.0625rem] shrink-0", active && "text-sidebar-primary")} />
      <span className="truncate">{item.label}</span>
      {badge ? (
        <span className="tabular ml-auto rounded-full bg-sidebar-primary px-1.5 text-[0.6875rem] leading-[1.125rem] font-semibold text-sidebar-primary-foreground">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
}

function NavGroups({
  groups,
  unread,
  onNavigate,
}: {
  groups: NavGroup[];
  unread: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-2">
      {groups.map((group, index) => (
        <div key={group.label} className={cn(index === groups.length - 1 && "mt-auto")}>
          <p className="eyebrow mb-1.5 px-3 text-sidebar-muted/70">{group.label}</p>
          <ul className="grid gap-0.5">
            {group.items.map((item) => (
              <li key={item.href}>
                <NavLink
                  item={item}
                  active={isActivePath(pathname, item)}
                  badge={item.icon === "notifications" ? unread : undefined}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function EnvironmentNote({ demo }: { demo: boolean }) {
  if (!demo) return null;
  return (
    <div className="mx-3 mb-3 rounded-lg border border-sidebar-border bg-white/[0.03] px-3 py-2.5">
      <p className="flex items-center gap-2 text-xs font-medium text-sidebar-foreground">
        <span className="size-1.5 rounded-full bg-sidebar-primary" />
        Demo environment
      </p>
      <p className="mt-1 text-xs leading-relaxed text-sidebar-muted">Sample data. No real money moves.</p>
    </div>
  );
}

/** Fixed navigation rail shown from the `lg` breakpoint up. */
export function Sidebar({
  groups,
  unread,
  home,
  demo,
}: {
  groups: NavGroup[];
  unread: number;
  home: string;
  demo: boolean;
}) {
  return (
    <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-sidebar lg:flex">
      <Link href={home} className="flex h-16 items-center px-6 outline-none focus-visible:opacity-80">
        <Logo tone="light" />
      </Link>
      <NavGroups groups={groups} unread={unread} />
      <EnvironmentNote demo={demo} />
    </aside>
  );
}

/** Slide-over navigation for small screens. */
export function MobileMenu({
  groups,
  unread,
  demo,
}: {
  groups: NavGroup[];
  unread: number;
  demo: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" aria-label="Open navigation">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 border-0 bg-sidebar p-0 text-sidebar-foreground [&_[data-slot=sheet-close]]:text-sidebar-muted">
        <SheetHeader className="h-16 justify-center px-6 py-0">
          <SheetTitle asChild>
            <div>
              <Logo tone="light" />
            </div>
          </SheetTitle>
          <SheetDescription className="sr-only">Main navigation</SheetDescription>
        </SheetHeader>
        <NavGroups groups={groups} unread={unread} onNavigate={() => setOpen(false)} />
        <EnvironmentNote demo={demo} />
      </SheetContent>
    </Sheet>
  );
}

/** Thumb-reach tab bar for customers on phones. */
export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Quick navigation"
      className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-border/80 bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {MOBILE_TABS.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActivePath(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium transition-colors outline-none focus-visible:bg-muted",
                  active ? "text-accent-foreground" : "text-muted-foreground",
                )}
              >
                <Icon className={cn("size-5", active && "text-primary")} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function UserMenu({ user }: { user: ShellUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-full py-1 pr-1 pl-1 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 sm:pr-3"
          aria-label="Account menu"
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 sm:block">
            <span className="block max-w-[10rem] truncate text-sm leading-tight font-medium">{user.name}</span>
            <span className="block text-xs leading-tight text-muted-foreground">{ROLE_LABELS[user.role]}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/notifications">
            <Bell /> Notifications
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild variant="destructive">
          <form action={logoutAction} className="w-full">
            <button type="submit" className="flex w-full items-center gap-2 outline-none">
              <LogOut /> Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
