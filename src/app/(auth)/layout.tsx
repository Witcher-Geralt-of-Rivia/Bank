import { Fingerprint, Scale, ScrollText } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";

const POINTS = [
  {
    icon: Scale,
    title: "Cada centavo contabilizado",
    body: "Los saldos se derivan de un libro mayor de partida doble. Los débitos siempre igualan a los créditos.",
  },
  {
    icon: Fingerprint,
    title: "Reintentos seguros",
    body: "Cada pago lleva una clave de idempotencia, así que una solicitud repetida nunca mueve el dinero dos veces.",
  },
  {
    icon: ScrollText,
    title: "Un registro de auditoría completo",
    body: "Los inicios de sesión, las transferencias y las acciones administrativas quedan en un registro de solo adición.",
  },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex xl:p-16">
        <div aria-hidden="true" className="pointer-events-none absolute -top-32 -left-24 size-[28rem] rounded-full bg-sidebar-primary/10 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute right-[-8rem] bottom-[-10rem] size-[26rem] rounded-full bg-sidebar-primary/[0.07] blur-3xl" />

        <Link href="/" className="relative w-fit outline-none focus-visible:opacity-80">
          <Logo tone="light" />
        </Link>

        <div className="relative max-w-md">
          <h2 className="display text-[2.75rem] text-balance xl:text-[3.25rem]">
            Banca construida sobre un libro mayor que puedes <em className="text-sidebar-primary">auditar</em>.
          </h2>
          <ul className="mt-10 grid gap-6">
            {POINTS.map((point) => (
              <li key={point.title} className="flex gap-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-sidebar-primary">
                  <point.icon className="size-[1.125rem]" />
                </span>
                <div>
                  <p className="text-sm font-medium">{point.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-sidebar-muted">{point.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs leading-relaxed text-sidebar-muted">
          Aldera es una institución ficticia creada para demostrar ingeniería de software financiero. No se mueve dinero real.
        </p>
      </aside>

      <main className="flex flex-col px-5 py-8 sm:px-10">
        <Link href="/" className="w-fit outline-none focus-visible:opacity-80 lg:hidden">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center py-10">{children}</div>
        <p className="text-center text-xs text-muted-foreground lg:hidden">Entorno de demostración. No se mueve dinero real.</p>
      </main>
    </div>
  );
}
