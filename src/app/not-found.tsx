import { Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Página no encontrada" };

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center px-5 sm:px-8">
        <Link href="/" className="outline-none focus-visible:opacity-80">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-5 pb-24 text-center">
        <span className="mb-6 flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Compass className="size-6" />
        </span>
        <p className="eyebrow text-muted-foreground">Error 404</p>
        <h1 className="display mt-3 text-5xl">No encontramos esa página.</h1>
        <p className="mt-4 max-w-md text-sm text-pretty text-muted-foreground">
          Es posible que la página se haya movido, o que el registro que buscas no exista o no esté disponible para tu perfil.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/dashboard">Ir al resumen</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/">Volver al inicio</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
