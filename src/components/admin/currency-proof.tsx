import { CircleCheck, TriangleAlert } from "lucide-react";
import { Money } from "@/components/shared/money";
import { DetailRow } from "@/components/shared/page";
import { Pill } from "@/components/shared/status";
import { CURRENCIES, type CurrencyCode } from "@/lib/money";

/**
 * One currency's evidence that the books balance: the figures being compared,
 * the figure that has to come out at zero, and a plain verdict.
 */
export function CurrencyProof({
  currency,
  rows,
  result,
  passed,
}: {
  currency: CurrencyCode;
  rows: { label: string; minor: bigint }[];
  /** The figure that is zero in a sound ledger. */
  result: { label: string; minor: bigint };
  passed: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/70 px-4 pt-3.5 pb-1.5">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium">
          {CURRENCIES[currency].name} <span className="font-normal text-muted-foreground">{currency}</span>
        </p>
        <Pill tone={passed ? "success" : "danger"} icon={passed ? CircleCheck : TriangleAlert}>
          {passed ? "Balanced" : "Out of balance"}
        </Pill>
      </div>
      <dl className="mt-1.5 divide-y divide-border/70">
        {rows.map((row) => (
          <DetailRow key={row.label} label={row.label} className="flex-wrap gap-y-0.5">
            <Money minor={row.minor} currency={currency} />
          </DetailRow>
        ))}
        <DetailRow label={result.label} className="flex-wrap gap-y-0.5">
          <Money minor={result.minor} currency={currency} className={passed ? undefined : "text-danger"} />
        </DetailRow>
      </dl>
    </div>
  );
}
