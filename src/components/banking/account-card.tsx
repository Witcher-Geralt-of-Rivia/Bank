import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/shared/money";
import { AccountStatusBadge } from "@/components/shared/status";
import { ACCOUNT_TYPE_LABELS, maskAccountNumber } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { AccountView } from "@/server/queries/accounts";

/** Compact summary of one account, linking to its detail page. */
export function AccountCard({ account, className }: { account: AccountView; className?: string }) {
  const hasHold = account.heldMinor > 0n;
  return (
    <Link
      href={`/accounts/${account.id}`}
      className={cn(
        "group flex min-w-[15.5rem] flex-col rounded-xl bg-card p-5 shadow-card ring-1 ring-foreground/[0.07] transition-[box-shadow,transform] duration-200 outline-none hover:shadow-raised focus-visible:ring-2 focus-visible:ring-ring/60",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{account.name}</p>
          <p className="tabular mt-0.5 text-xs text-muted-foreground">
            {ACCOUNT_TYPE_LABELS[account.type]} · {maskAccountNumber(account.number)}
          </p>
        </div>
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground">
          {account.currency}
        </span>
      </div>

      <p className="heading mt-6 text-[1.625rem] leading-8">
        <Money minor={account.postedMinor} currency={account.currency} className="font-[inherit]" />
      </p>

      <div className="mt-1 flex min-h-6 items-center justify-between gap-2 text-xs text-muted-foreground">
        {account.status !== "active" ? (
          <AccountStatusBadge status={account.status} />
        ) : hasHold ? (
          <span>
            Disponible: <Money minor={account.availableMinor} currency={account.currency} />
          </span>
        ) : (
          <span>Totalmente disponible</span>
        )}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}
