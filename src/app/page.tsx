import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CircleCheck,
  CircleDashed,
  Fingerprint,
  Landmark,
  ListChecks,
  Lock,
  Scale,
  ScrollText,
  Send,
  ShieldCheck,
  User,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

const CAPABILITIES = [
  {
    icon: Wallet,
    title: "Accounts and balances",
    body: "Multi-currency accounts with current and available balances, each backed by a statement read straight from the ledger.",
  },
  {
    icon: Send,
    title: "Transfers with safeguards",
    body: "A guided flow that checks funds and limits, holds high-value payments for review and issues a receipt for every movement.",
  },
  {
    icon: CircleDashed,
    title: "Status you can follow",
    body: "Pending, processing, completed, failed or reversed: every transaction shows where it is and how it got there.",
  },
  {
    icon: ListChecks,
    title: "An operations console",
    body: "Operators approve, settle and return payments. Administrators manage users, freeze accounts and reverse transactions.",
  },
  {
    icon: ScrollText,
    title: "A complete audit trail",
    body: "Sign-ins, transfers and administrative actions are written to an append-only, tamper-evident log.",
  },
  {
    icon: Lock,
    title: "Access by role",
    body: "Customers, operators and administrators each see only what their role allows, enforced on the server for every request.",
  },
];

const PRINCIPLES = [
  {
    icon: Scale,
    title: "Double-entry ledger",
    body: "Balances are never edited. They are the sum of immutable entries, and the database refuses any transaction whose debits and credits differ.",
  },
  {
    icon: Fingerprint,
    title: "Idempotent by design",
    body: "Each request carries a unique key. A retry after a timeout or a double click returns the original result instead of paying twice.",
  },
  {
    icon: Landmark,
    title: "Exact arithmetic",
    body: "Money is stored and calculated as whole minor units. Floating-point numbers never touch an amount.",
  },
  {
    icon: ShieldCheck,
    title: "History that cannot be rewritten",
    body: "Corrections are made with reversing transactions. Ledger entries and audit records can be added, never changed or removed.",
  },
];

const ROLES = [
  { icon: User, role: "Customer", body: "Check balances, move money, manage beneficiaries and review spending." },
  { icon: Building2, role: "Operator", body: "Work the review queue, track settlement and freeze accounts when something looks wrong." },
  { icon: ShieldCheck, role: "Administrator", body: "Oversee users and roles, reverse transactions and verify the audit trail." },
];

function PreviewRow({
  icon: Icon,
  title,
  meta,
  amount,
  positive,
}: {
  icon: typeof ArrowDownLeft;
  title: string;
  meta: string;
  amount: string;
  positive?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${positive ? "bg-success-soft text-success" : "bg-muted text-muted-foreground"}`}>
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.8125rem] font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{meta}</span>
      </span>
      <span className={`tabular text-[0.8125rem] font-medium ${positive ? "text-success" : ""}`}>{amount}</span>
    </li>
  );
}

/** A static illustration of the product, composed from the real UI vocabulary. */
function ProductPreview() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[34rem] select-none lg:mx-0">
      <div className="rounded-2xl bg-sidebar p-6 text-sidebar-foreground shadow-raised">
        <p className="eyebrow text-sidebar-muted">Total balance</p>
        <p className="mt-2 text-4xl font-semibold tracking-[-0.03em]">$184,250.18</p>
        <div className="mt-5 flex items-end gap-1.5">
          {[38, 52, 44, 66, 58, 80].map((height, index) => (
            <div key={index} className="flex flex-1 items-end gap-0.5">
              <span className="flex-1 rounded-t-[3px] bg-chart-in" style={{ height: `${height * 0.7}px` }} />
              <span className="flex-1 rounded-t-[3px] bg-chart-out/90" style={{ height: `${height * 0.48}px` }} />
            </div>
          ))}
        </div>
      </div>

      <div className="relative -mt-4 ml-6 rounded-2xl bg-card p-5 shadow-raised ring-1 ring-foreground/[0.07] sm:ml-12">
        <div className="flex items-center justify-between">
          <p className="text-[0.8125rem] font-semibold">Recent activity</p>
          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-success-soft px-1.5 text-[0.6875rem] font-medium text-success">
            <CircleCheck className="size-3" /> Ledger balanced
          </span>
        </div>
        <ul className="mt-2 divide-y divide-border/70">
          <PreviewRow icon={ArrowDownLeft} title="Halcyon Retail Group" meta="Invoice payment" amount="+$14,250.00" positive />
          <PreviewRow icon={ArrowUpRight} title="Tomás Herrera" meta="Processing · in transit" amount="−$2,950.00" />
          <PreviewRow icon={ArrowUpRight} title="Greenfield Print Co." meta="Pending review" amount="−$12,500.00" />
        </ul>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="outline-none focus-visible:opacity-80">
          <Logo />
        </Link>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link href="/register">Open an account</Link>
          </Button>
          <Button asChild>
            <Link href="/login">Sign in</Link>
          </Button>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pt-10 pb-16 sm:px-8 sm:pt-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:pb-24">
          <div className="animate-rise">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-card">
              <span className="size-1.5 rounded-full bg-chart-in" />
              Digital banking and financial operations platform
            </p>
            <h1 className="display mt-6 text-[2.75rem] text-balance sm:text-6xl lg:text-[4.25rem]">
              Banking built on a ledger you can <em className="text-primary">audit</em>.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
              Aldera brings accounts, transfers and real-time transaction tracking together on a double-entry ledger, where every cent is
              accounted for and every sensitive action leaves a record.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="xl">
                <Link href="/login">
                  Explore the live demo <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="xl" variant="outline">
                <Link href="/register">Open an account</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">Sample customer, operator and administrator profiles are ready to use.</p>
          </div>
          <ProductPreview />
        </section>

        <section className="border-y border-border/70 bg-card">
          <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
            <p className="eyebrow text-accent-foreground">The platform</p>
            <h2 className="display mt-3 max-w-2xl text-4xl text-balance sm:text-[2.75rem]">Everything a modern financial product needs to run day to day.</h2>
            <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((item) => (
                <li key={item.title}>
                  <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <item.icon className="size-5" />
                  </span>
                  <h3 className="mt-4 font-semibold tracking-[-0.01em]">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-pretty text-muted-foreground">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="bg-sidebar text-sidebar-foreground">
          <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
            <p className="eyebrow text-sidebar-primary">Financial integrity</p>
            <h2 className="display mt-3 max-w-2xl text-4xl text-balance sm:text-[2.75rem]">Correct by construction, not by convention.</h2>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-pretty text-sidebar-muted sm:text-base">
              The rules that keep money safe are enforced in the data model and the database itself, so they hold even when application
              code changes.
            </p>
            <ul className="mt-12 grid gap-4 sm:grid-cols-2">
              {PRINCIPLES.map((item) => (
                <li key={item.title} className="rounded-xl border border-sidebar-border bg-white/[0.03] p-6">
                  <item.icon className="size-5 text-sidebar-primary" />
                  <h3 className="mt-4 font-semibold tracking-[-0.01em]">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-pretty text-sidebar-muted">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="eyebrow text-accent-foreground">Three views, one platform</p>
              <h2 className="display mt-3 max-w-xl text-4xl text-balance sm:text-[2.75rem]">See it from every seat.</h2>
            </div>
            <Button asChild size="lg">
              <Link href="/login">
                Open the demo <ArrowRight />
              </Link>
            </Button>
          </div>
          <ul className="mt-10 grid gap-4 md:grid-cols-3">
            {ROLES.map((item) => (
              <li key={item.role} className="rounded-xl bg-card p-6 shadow-card ring-1 ring-foreground/[0.07]">
                <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <item.icon className="size-5" />
                </span>
                <h3 className="mt-4 font-semibold tracking-[-0.01em]">{item.role}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-pretty text-muted-foreground">{item.body}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-8 text-xs leading-relaxed text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Logo className="[&>span]:text-sm" />
          <p className="max-w-xl sm:text-right">
            Aldera is a fictional institution created to demonstrate financial software engineering. It is not a bank, holds no licence and
            moves no real money.
          </p>
        </div>
      </footer>
    </div>
  );
}
