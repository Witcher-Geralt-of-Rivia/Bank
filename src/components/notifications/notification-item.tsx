"use client";

import { ArrowLeftRight, ChevronRight, Megaphone, ShieldAlert, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ComponentType, useTransition } from "react";
import { toast } from "sonner";
import type { NotificationKind } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { markNotificationReadAction } from "@/server/actions/banking";

const KINDS: Record<NotificationKind, { label: string; icon: ComponentType<{ className?: string }>; tone: string }> = {
  transaction: { label: "Transacción", icon: ArrowLeftRight, tone: "bg-accent text-accent-foreground" },
  security: { label: "Seguridad", icon: ShieldAlert, tone: "bg-warning-soft text-warning" },
  account: { label: "Cuenta", icon: Wallet, tone: "bg-info-soft text-info" },
  system: { label: "Sistema", icon: Megaphone, tone: "bg-neutral-soft text-neutral" },
};

/** Destinations that exist only in customer banking. */
const CUSTOMER_PATHS = ["/transactions/", "/accounts", "/dashboard", "/beneficiaries", "/transfers"];

const ROW = "group flex w-full gap-3 px-5 py-4 text-left";
const INTERACTIVE = "transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/60";

/**
 * One notification. Selecting it records that it was read and, when it points
 * somewhere, opens that page.
 */
export function NotificationItem({
  id,
  kind,
  title,
  body,
  href,
  time,
  unread,
  staff = false,
}: {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string | null;
  /** Relative time, formatted on the server so both renders agree. */
  time: string;
  unread: boolean;
  /** Staff have no customer banking pages, so links to them are not offered. */
  staff?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { label, icon: Icon, tone } = KINDS[kind];
  const target = href && !(staff && CUSTOMER_PATHS.some((path) => href.startsWith(path))) ? href : null;

  function markRead(destination: string | null) {
    startTransition(async () => {
      const result = await markNotificationReadAction({ id });
      if (!result.ok) toast.error(result.error.message);
      // Opening the page matters more than the read receipt, so carry on either way.
      startTransition(() => (destination ? router.push(destination) : router.refresh()));
    });
  }

  const content = (
    <>
      <span aria-hidden="true" className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full", tone)}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm", unread ? "font-semibold" : "font-medium")}>{title}</span>
        <span className="mt-0.5 block max-w-2xl text-[0.8125rem] leading-snug text-pretty text-muted-foreground">{body}</span>
        <span className="mt-1.5 block text-xs text-muted-foreground">
          {label} · {time}
        </span>
      </span>
      {unread ? (
        <span className="mt-1.5 flex shrink-0">
          <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
          <span className="sr-only">Sin leer</span>
        </span>
      ) : null}
      {target ? (
        <ChevronRight
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
        />
      ) : null}
    </>
  );

  if (target) {
    return (
      <Link
        href={target}
        // Marking the item read refreshes the page data, so a prefetch would be thrown away.
        prefetch={false}
        aria-busy={pending}
        className={cn(ROW, INTERACTIVE, pending && "pointer-events-none opacity-60")}
        onClick={(event) => {
          if (!unread) return;
          // A modified click opens a new tab by itself; this tab only records the read.
          const newTab = event.metaKey || event.ctrlKey || event.shiftKey;
          if (!newTab) event.preventDefault();
          markRead(newTab ? null : target);
        }}
      >
        {content}
      </Link>
    );
  }

  if (unread) {
    return (
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={() => markRead(null)}
        className={cn(ROW, INTERACTIVE, "disabled:opacity-60")}
      >
        {content}
      </button>
    );
  }

  return <div className={ROW}>{content}</div>;
}
