import { Compass } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/shared/page";
import { Button } from "@/components/ui/button";

export default function AppNotFound() {
  return (
    <div className="rounded-xl bg-card shadow-card ring-1 ring-foreground/[0.07]">
      <EmptyState
        icon={Compass}
        title="No encontramos lo que buscas"
        description="El registro no existe o no está disponible para tu perfil."
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
