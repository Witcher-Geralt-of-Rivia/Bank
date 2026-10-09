"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { EmptyState } from "@/components/shared/page";
import { Button } from "@/components/ui/button";

/**
 * Shown when a page in the application fails to render. Only a generic
 * message and the error digest are displayed; details stay in server logs.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="rounded-xl bg-card shadow-card ring-1 ring-foreground/[0.07]">
      <EmptyState
        icon={TriangleAlert}
        title="Something went wrong"
        description={`We couldn't load this page. Your accounts and balances are not affected.${error.digest ? ` Reference: ${error.digest}` : ""}`}
        action={<Button onClick={reset}>Try again</Button>}
        className="py-20"
      />
    </div>
  );
}
