import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { isStaff } from "@/lib/domain";
import { requireUser } from "@/server/auth/session";

/**
 * Gate for the operations console. Customers who reach an /admin URL get a
 * plain refusal and no operational data; each page and action underneath
 * checks the role again for itself.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  if (!isStaff(user.role)) {
    return (
      <div className="rounded-xl bg-card shadow-card ring-1 ring-foreground/[0.07]">
        <EmptyState
          icon={ShieldAlert}
          title="No tienes acceso a esta área"
          description="La consola de operaciones está restringida al personal de Aldera. Si crees que se trata de un error, comunícate con tu administrador."
          action={
            <Button asChild>
              <Link href="/dashboard">Volver al resumen</Link>
            </Button>
          }
          className="py-20"
        />
      </div>
    );
  }

  return children;
}
