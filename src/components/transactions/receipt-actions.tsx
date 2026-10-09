"use client";

import { Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { TransactionStatus } from "@/lib/domain";
import { refreshTransferStatusAction } from "@/server/actions/banking";

export function PrintButton() {
  return (
    <Button variant="outline" size="lg" onClick={() => window.print()}>
      <Printer /> Print receipt
    </Button>
  );
}

/**
 * Keeps a receipt current while its transfer is in transit: asks the server
 * for the latest status every few seconds and refreshes the page when it
 * changes. Polling stops after a minute or as soon as the status is final.
 */
export function StatusWatcher({
  transactionId,
  status,
  onChange,
}: {
  transactionId: string;
  status: TransactionStatus;
  onChange?: (status: TransactionStatus) => void;
}) {
  const router = useRouter();
  const current = useRef(status);
  const callback = useRef(onChange);

  useEffect(() => {
    callback.current = onChange;
  }, [onChange]);

  useEffect(() => {
    current.current = status;
    if (status !== "processing") return;

    let cancelled = false;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      const result = await refreshTransferStatusAction({ id: transactionId });
      if (cancelled) return;
      if (result.ok && result.data.status !== current.current) {
        current.current = result.data.status;
        callback.current?.(result.data.status);
        router.refresh();
      }
      if (attempts >= 20 || current.current !== "processing") clearInterval(timer);
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [transactionId, status, router]);

  return null;
}
