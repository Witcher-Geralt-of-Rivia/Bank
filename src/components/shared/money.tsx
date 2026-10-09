import { type CurrencyCode, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * A monetary amount. Always rendered from integer minor units; the sign is
 * typographic (a true minus) and columns of amounts align on tabular figures.
 */
export function Money({
  minor,
  currency,
  sign = "auto",
  tone = "plain",
  className,
}: {
  minor: bigint;
  currency: CurrencyCode;
  sign?: "auto" | "always" | "never";
  /** "flow" colours credits; debits stay in ink. */
  tone?: "plain" | "flow" | "muted";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "tabular whitespace-nowrap",
        tone === "flow" && minor > 0n && "text-success",
        tone === "muted" && "text-muted-foreground",
        className,
      )}
    >
      {formatMoney(minor, currency, { sign })}
    </span>
  );
}
