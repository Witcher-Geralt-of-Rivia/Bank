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
        title="Algo salió mal"
        description={`No pudimos cargar esta página. Tus cuentas y saldos no se vieron afectados.${error.digest ? ` Referencia: ${error.digest}` : ""}`}
        action={<Button onClick={reset}>Intentar de nuevo</Button>}
        className="py-20"
      />
    </div>
  );
}
