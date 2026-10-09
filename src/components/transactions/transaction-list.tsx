import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CreditCard,
  Percent,
  ReceiptText,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TRANSACTION_TYPE_LABELS, maskAccountNumber } from "@/lib/domain";
import { formatDate, formatShortDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TransactionView } from "@/server/queries/transactions";

/** Human label for a movement, from the viewer's side of it. */
export function transactionTypeLabel(view: TransactionView): string {
  if (view.type === "transfer_internal") {
    if (view.direction === "out") return "Transferencia enviada";
    if (view.direction === "in") return "Transferencia recibida";
  }
  return TRANSACTION_TYPE_LABELS[view.type];
}

export function TransactionIcon({ view, className }: { view: TransactionView; className?: string }) {
  const Icon =
    view.type === "reversal"
      ? Undo2
      : view.type === "card_payment"
        ? CreditCard
        : view.type === "fee"
          ? ReceiptText
          : view.type === "interest"
            ? Percent
            : view.direction === "internal"
              ? ArrowLeftRight
              : view.direction === "in"
                ? ArrowDownLeft
                : ArrowUpRight;
  const incoming = view.direction === "in" && view.status === "completed";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full",
        incoming ? "bg-success-soft text-success" : "bg-muted text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

/**
 * Signed amount as the viewer experiences it: credits are positive and green,
 * debits negative and in ink. Movements that did not take effect are struck
 * through. `neutral` shows the bare amount, for the operations console.
 */
export function TransactionAmount({
  view,
  neutral = false,
  className,
}: {
  view: TransactionView;
  neutral?: boolean;
  className?: string;
}) {
  const voided = view.status === "failed" || view.status === "reversed";
  if (neutral || view.direction === "internal") {
    return (
      <Money
        minor={view.amountMinor}
        currency={view.currency}
        className={cn("font-medium", voided && "text-muted-foreground line-through", className)}
      />
    );
  }
  const signed = view.direction === "in" ? view.amountMinor : -view.amountMinor;
  return (
    <Money
      minor={signed}
      currency={view.currency}
      sign="always"
      tone={voided ? "muted" : "flow"}
      className={cn("font-medium", voided && "line-through", className)}
    />
  );
}

type ListProps = {
  rows: TransactionView[];
  /** Base path of the detail page; the transaction id is appended. */
  basePath?: string;
  /** Operations view: show both parties and unsigned amounts. */
  staff?: boolean;
  showAccount?: boolean;
  showYear?: boolean;
  /** Narrow containers: drop the account and type columns. */
  compact?: boolean;
};

function accountLabel(view: TransactionView, staff: boolean): string {
  if (staff) {
    const from = view.source ? `${view.source.ownerName ?? "Aldera"} ${maskAccountNumber(view.source.number)}` : "Externo";
    const to = view.destination ? `${view.destination.ownerName ?? "Aldera"} ${maskAccountNumber(view.destination.number)}` : (view.counterpartyName ?? "Externo");
    return `${from} → ${to}`;
  }
  return view.ownAccount ? `${view.ownAccount.name} ${maskAccountNumber(view.ownAccount.number)}` : "—";
}

function primaryLabel(view: TransactionView, staff: boolean): string {
  if (staff) return view.description;
  return view.direction === "internal" ? view.description : view.counterparty;
}

function secondaryLabel(view: TransactionView, staff: boolean): string {
  if (staff) return transactionTypeLabel(view);
  return view.direction === "internal" ? view.counterparty : view.description;
}

/** Transactions as a table on wide screens and a tappable list on phones. */
export function TransactionList({
  rows,
  basePath = "/transactions",
  staff = false,
  showAccount = true,
  showYear = true,
  compact = false,
}: ListProps) {
  const date = showYear ? formatDate : formatShortDate;
  const withAccount = showAccount && !compact;

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[7.5rem]">Fecha</TableHead>
              <TableHead>{staff ? "Descripción" : "Detalle"}</TableHead>
              {withAccount ? <TableHead>{staff ? "Origen → Destino" : "Cuenta"}</TableHead> : null}
              {compact ? null : <TableHead className="hidden lg:table-cell">Tipo</TableHead>}
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Monto</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((view) => (
              <TableRow key={view.id} className="group relative">
                <TableCell className="text-muted-foreground">
                  <span className="tabular block text-foreground">{date(view.createdAt)}</span>
                  <span className="tabular text-xs">{formatTime(view.createdAt)}</span>
                </TableCell>
                <TableCell className="max-w-[18rem] whitespace-normal">
                  <Link
                    href={`${basePath}/${view.id}`}
                    className="flex items-center gap-3 outline-none after:absolute after:inset-0 focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring/60"
                  >
                    <TransactionIcon view={view} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{primaryLabel(view, staff)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{secondaryLabel(view, staff)}</span>
                    </span>
                  </Link>
                </TableCell>
                {withAccount ? (
                  <TableCell className="max-w-[16rem] truncate text-muted-foreground">{accountLabel(view, staff)}</TableCell>
                ) : null}
                {compact ? null : (
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{transactionTypeLabel(view)}</TableCell>
                )}
                <TableCell>
                  <StatusBadge status={view.status} />
                </TableCell>
                <TableCell className="text-right">
                  <TransactionAmount view={view} neutral={staff} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="divide-y divide-border/70 md:hidden">
        {rows.map((view) => (
          <li key={view.id}>
            <Link
              href={`${basePath}/${view.id}`}
              className="flex items-center gap-3 px-5 py-3.5 transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/60"
            >
              <TransactionIcon view={view} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{primaryLabel(view, staff)}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="tabular shrink-0 whitespace-nowrap">{formatShortDate(view.createdAt)}</span>
                  {view.status !== "completed" ? (
                    <StatusBadge status={view.status} className="h-5 px-1.5 text-[0.6875rem]" />
                  ) : (
                    <span className="truncate">· {staff ? accountLabel(view, true) : secondaryLabel(view, false)}</span>
                  )}
                </span>
              </span>
              <TransactionAmount view={view} neutral={staff} className="text-sm" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
