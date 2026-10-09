import { Fingerprint, Scale, ScrollText } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";

const POINTS = [
  {
    icon: Scale,
    title: "Every cent accounted for",
    body: "Balances are derived from a double-entry ledger. Debits always equal credits.",
  },
  {
    icon: Fingerprint,
    title: "Safe to retry",
    body: "Each payment carries an idempotency key, so a repeated request never moves money twice.",
  },
  {
    icon: ScrollText,
    title: "A complete audit trail",
    body: "Sign-ins, transfers and administrative actions are recorded in an append-only log.",
  },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex xl:p-16">
        <div aria-hidden="true" className="pointer-events-none absolute -top-32 -left-24 size-[28rem] rounded-full bg-sidebar-primary/10 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute right-[-8rem] bottom-[-10rem] size-[26rem] rounded-full bg-sidebar-primary/[0.07] blur-3xl" />

        <Link href="/" className="relative w-fit outline-none focus-visible:opacity-80">
          <Logo tone="light" />
        </Link>

        <div className="relative max-w-md">
          <h2 className="display text-[2.75rem] text-balance xl:text-[3.25rem]">
            Banking built on a ledger you can <em className="text-sidebar-primary">audit</em>.
          </h2>
          <ul className="mt-10 grid gap-6">
            {POINTS.map((point) => (
              <li key={point.title} className="flex gap-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-sidebar-primary">
                  <point.icon className="size-[1.125rem]" />
                </span>
                <div>
                  <p className="text-sm font-medium">{point.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-sidebar-muted">{point.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs leading-relaxed text-sidebar-muted">
          Aldera is a fictional institution created to demonstrate financial software engineering. No real money moves.
        </p>
      </aside>

      <main className="flex flex-col px-5 py-8 sm:px-10">
        <Link href="/" className="w-fit outline-none focus-visible:opacity-80 lg:hidden">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center py-10">{children}</div>
        <p className="text-center text-xs text-muted-foreground lg:hidden">Demonstration environment. No real money moves.</p>
      </main>
    </div>
  );
}
