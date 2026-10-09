import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Title block at the top of every in-app page. */
export function PageHeader({
  title,
  description,
  eyebrow,
  back,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {back ? (
          <Link
            href={back.href}
            className="no-print mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
            {back.label}
          </Link>
        ) : null}
        {eyebrow ? <p className="eyebrow mb-1.5 text-muted-foreground">{eyebrow}</p> : null}
        <h1 className="heading text-2xl text-balance sm:text-[1.75rem] sm:leading-9">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-pretty text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="no-print flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A titled surface. Most page content sits in one of these. */
export function Section({
  title,
  description,
  action,
  children,
  className,
  flush = false,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Remove body padding, for tables and lists that run edge to edge. */
  flush?: boolean;
}) {
  return (
    <section className={cn("rounded-xl bg-card shadow-card ring-1 ring-foreground/[0.07]", className)}>
      {title ? (
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
          <div className="min-w-0">
            <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {action ? <div className="no-print shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className={cn(!flush && "px-5 pb-5", !title && !flush && "pt-5")}>{children}</div>
    </section>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-pretty text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Label and value pair used in detail panels and receipts. */
export function DetailRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-6 py-2.5 text-sm", className)}>
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words">{children}</dd>
    </div>
  );
}

/** Previous / next pager that preserves the current filters. */
export function Pagination({
  page,
  pageCount,
  total,
  noun,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  total: number;
  noun: string;
  hrefFor: (page: number) => string;
}) {
  if (total === 0) return null;
  return (
    <nav
      aria-label="Pagination"
      className="no-print flex items-center justify-between gap-4 border-t border-border/70 px-5 py-3 text-sm"
    >
      <p className="text-muted-foreground">
        Page <span className="font-medium text-foreground">{page}</span> of {pageCount}
        <span className="hidden sm:inline">
          {" "}
          · {total.toLocaleString("en-US")} {noun}
        </span>
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefFor(page - 1)} scroll={false}>
              <ChevronLeft /> Previous
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <ChevronLeft /> Previous
          </Button>
        )}
        {page < pageCount ? (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefFor(page + 1)} scroll={false}>
              Next <ChevronRight />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next <ChevronRight />
          </Button>
        )}
      </div>
    </nav>
  );
}

/** Inline notice for guidance, warnings and errors inside a page. */
export function Callout({
  tone = "info",
  icon: Icon,
  title,
  children,
  className,
}: {
  tone?: "info" | "warning" | "danger" | "success" | "neutral";
  icon?: ComponentType<{ className?: string }>;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: "bg-info-soft text-info",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
    success: "bg-success-soft text-success",
    neutral: "bg-muted text-foreground",
  } as const;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg px-3.5 py-3 text-sm", tones[tone], className)}>
      {Icon ? <Icon className="mt-0.5 size-4 shrink-0" /> : null}
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn("text-pretty text-foreground/80", title && "mt-0.5")}>{children}</div> : null}
      </div>
    </div>
  );
}

/** A headline figure with its label and a line of context beneath. */
export function StatTile({
  label,
  icon: Icon,
  value,
  footer,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  value: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-card p-5 shadow-card ring-1 ring-foreground/[0.07]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="size-4 text-muted-foreground/70" />
      </div>
      <p className="heading mt-3 text-2xl">{value}</p>
      <div className="mt-1.5 min-h-4">{footer}</div>
    </div>
  );
}
