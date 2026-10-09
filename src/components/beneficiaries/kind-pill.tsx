import { Landmark, Zap } from "lucide-react";
import { Pill } from "@/components/shared/status";
import type { BeneficiaryKind } from "@/lib/domain";

/** Where a beneficiary banks: on Aldera, where transfers settle at once, or elsewhere. */
export function BeneficiaryKindPill({ kind }: { kind: BeneficiaryKind }) {
  return kind === "internal" ? (
    <Pill tone="success" icon={Zap}>
      Aldera · instant
    </Pill>
  ) : (
    <Pill tone="muted" icon={Landmark}>
      External bank
    </Pill>
  );
}
