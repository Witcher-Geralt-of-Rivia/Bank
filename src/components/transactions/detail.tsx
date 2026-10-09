import { Money } from "@/components/shared/money";
import { transactionStatusTone } from "@/components/shared/status";
import { TRANSACTION_STATUS_LABELS, maskAccountNumber } from "@/lib/domain";
import { formatDateTime } from "@/lib/format";
import type { CurrencyCode } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { TransactionDetail } from "@/server/queries/transactions";

const DOT: Record<ReturnType<typeof transactionStatusTone>, string> = {
  success: "bg-success",
  warning: "bg-warning",
  info: "bg-info",
  danger: "bg-danger",
  neutral: "bg-neutral",
  muted: "bg-muted-foreground",
};

/**
 * The life of a transaction, oldest first. Events are append-only records, so
 * this is exactly what happened, when, and who did it.
 */
export function StatusTimeline({ events }: { events: TransactionDetail["events"] }) {
  return (
    <ol className="relative grid gap-5">
      {events.map((event, index) => {
        const last = index === events.length - 1;
        return (
          <li key={event.seq} className="relative flex gap-3.5">
            {!last ? <span aria-hidden="true" className="absolute top-4 bottom-[-1.25rem] left-[0.3125rem] w-px bg-border" /> : null}
            <span
              aria-hidden="true"
              className={cn(
                "relative mt-1.5 size-[0.6875rem] shrink-0 rounded-full ring-4 ring-card",
                DOT[transactionStatusTone(event.toStatus)],
                !last && "opacity-60",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{TRANSACTION_STATUS_LABELS[event.toStatus]}</p>
              {event.note ? <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{event.note}</p> : null}
              <p className="tabular mt-1 text-xs text-muted-foreground">
                {formatDateTime(event.createdAt)} · {event.actorLabel}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The ledger entries posted for a transaction. Debits and credits are shown in
 * separate columns, with the account balance each entry produced.
 */
export function LedgerEntriesTable({
  entries,
  currency,
  showTotals = false,
}: {
  entries: TransactionDetail["entries"];
  currency: CurrencyCode;
  /** Operations view: prove the legs balance. */
  showTotals?: boolean;
}) {
  const debits = entries.filter((e) => e.direction === "debit").reduce((sum, e) => sum + e.amountMinor, 0n);
  const credits = entries.filter((e) => e.direction === "credit").reduce((sum, e) => sum + e.amountMinor, 0n);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[30rem] text-sm">
        <thead>
          <tr className="border-b border-border/70 text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-4 pl-5 text-left font-medium">Account</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Debit</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Credit</th>
            <th scope="col" className="py-2 pr-5 pl-4 text-right font-medium">Balance after</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.seq} className="border-b border-border/50 last:border-0">
              <td className="py-3 pr-4 pl-5">
                <span className="block font-medium">{entry.accountName}</span>
                <span className="tabular block text-xs text-muted-foreground">
                  {entry.accountKind === "system" ? "Aldera ledger account" : maskAccountNumber(entry.accountNumber)}
                  {entry.memo ? ` · ${entry.memo}` : ""}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                {entry.direction === "debit" ? <Money minor={entry.amountMinor} currency={currency} /> : <span className="text-muted-foreground/50">—</span>}
              </td>
              <td className="px-4 py-3 text-right">
                {entry.direction === "credit" ? <Money minor={entry.amountMinor} currency={currency} /> : <span className="text-muted-foreground/50">—</span>}
              </td>
              <td className="py-3 pr-5 pl-4 text-right text-muted-foreground">
                <Money minor={entry.balanceAfterMinor} currency={currency} />
              </td>
            </tr>
          ))}
        </tbody>
        {showTotals && entries.length > 0 ? (
          <tfoot>
            <tr className="border-t border-border text-sm font-medium">
              <th scope="row" className="py-3 pr-4 pl-5 text-left font-medium">
                Total
                <span className={cn("ml-2 text-xs font-normal", debits === credits ? "text-success" : "text-danger")}>
                  {debits === credits ? "Balanced" : "Out of balance"}
                </span>
              </th>
              <td className="px-4 py-3 text-right">
                <Money minor={debits} currency={currency} />
              </td>
              <td className="px-4 py-3 text-right">
                <Money minor={credits} currency={currency} />
              </td>
              <td />
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
