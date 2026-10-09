import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CircleCheck,
  CircleDashed,
  Fingerprint,
  Landmark,
  ListChecks,
  Lock,
  Scale,
  ScrollText,
  Send,
  ShieldCheck,
  User,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

const CAPABILITIES = [
  {
    icon: Wallet,
    title: "Cuentas y saldos",
    body: "Cuentas multimoneda con saldo actual y saldo disponible, cada una respaldada por un estado de cuenta leído directamente del libro mayor.",
  },
  {
    icon: Send,
    title: "Transferencias con salvaguardas",
    body: "Un flujo guiado que verifica fondos y límites, retiene los pagos de alto valor para su revisión y emite un comprobante por cada movimiento.",
  },
  {
    icon: CircleDashed,
    title: "Estados que puedes seguir",
    body: "Pendiente, en proceso, completada, fallida o revertida: cada transacción muestra dónde está y cómo llegó hasta ahí.",
  },
  {
    icon: ListChecks,
    title: "Una consola de operaciones",
    body: "Los operadores aprueban, liquidan y devuelven pagos. Los administradores gestionan usuarios, congelan cuentas y revierten transacciones.",
  },
  {
    icon: ScrollText,
    title: "Un registro de auditoría completo",
    body: "Los inicios de sesión, las transferencias y las acciones administrativas quedan en un registro de solo adición, donde cualquier alteración se hace evidente.",
  },
  {
    icon: Lock,
    title: "Acceso por rol",
    body: "Clientes, operadores y administradores ven solo lo que su rol permite, y el servidor lo verifica en cada solicitud.",
  },
];

const PRINCIPLES = [
  {
    icon: Scale,
    title: "Libro mayor de partida doble",
    body: "Los saldos nunca se editan. Son la suma de asientos inmutables, y la base de datos rechaza cualquier transacción cuyos débitos y créditos no coincidan.",
  },
  {
    icon: Fingerprint,
    title: "Idempotente por diseño",
    body: "Cada solicitud lleva una clave única. Un reintento tras un tiempo de espera agotado o un doble clic devuelve el resultado original en lugar de pagar dos veces.",
  },
  {
    icon: Landmark,
    title: "Aritmética exacta",
    body: "El dinero se guarda y se calcula en unidades menores enteras. Los números de punto flotante nunca tocan un monto.",
  },
  {
    icon: ShieldCheck,
    title: "Un historial que no se puede reescribir",
    body: "Las correcciones se hacen con transacciones de reversión. Los asientos contables y los registros de auditoría se pueden agregar, pero nunca modificar ni eliminar.",
  },
];

const ROLES = [
  { icon: User, role: "Cliente", body: "Consulta saldos, transfiere dinero, administra beneficiarios y revisa tus gastos." },
  { icon: Building2, role: "Operador", body: "Atiende la cola de revisión, da seguimiento a la liquidación y congela cuentas cuando algo no se ve bien." },
  { icon: ShieldCheck, role: "Administrador", body: "Supervisa usuarios y roles, revierte transacciones y verifica el registro de auditoría." },
];

function PreviewRow({
  icon: Icon,
  title,
  meta,
  amount,
  positive,
}: {
  icon: typeof ArrowDownLeft;
  title: string;
  meta: string;
  amount: string;
  positive?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${positive ? "bg-success-soft text-success" : "bg-muted text-muted-foreground"}`}>
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.8125rem] font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{meta}</span>
      </span>
      <span className={`tabular text-[0.8125rem] font-medium ${positive ? "text-success" : ""}`}>{amount}</span>
    </li>
  );
}

/** A static illustration of the product, composed from the real UI vocabulary. */
function ProductPreview() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[34rem] select-none lg:mx-0">
      <div className="rounded-2xl bg-sidebar p-6 text-sidebar-foreground shadow-raised">
        <p className="eyebrow text-sidebar-muted">Saldo total</p>
        <p className="mt-2 text-4xl font-semibold tracking-[-0.03em]">$184,250.18</p>
        <div className="mt-5 flex items-end gap-1.5">
          {[38, 52, 44, 66, 58, 80].map((height, index) => (
            <div key={index} className="flex flex-1 items-end gap-0.5">
              <span className="flex-1 rounded-t-[3px] bg-chart-in" style={{ height: `${height * 0.7}px` }} />
              <span className="flex-1 rounded-t-[3px] bg-chart-out/90" style={{ height: `${height * 0.48}px` }} />
            </div>
          ))}
        </div>
      </div>

      <div className="relative -mt-4 ml-6 rounded-2xl bg-card p-5 shadow-raised ring-1 ring-foreground/[0.07] sm:ml-12">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[0.8125rem] font-semibold">Actividad reciente</p>
          <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-success-soft px-1.5 text-[0.6875rem] font-medium whitespace-nowrap text-success">
            <CircleCheck className="size-3" /> Libro mayor cuadrado
          </span>
        </div>
        <ul className="mt-2 divide-y divide-border/70">
          <PreviewRow icon={ArrowDownLeft} title="Halcyon Retail Group" meta="Pago de factura" amount="+$14,250.00" positive />
          <PreviewRow icon={ArrowUpRight} title="Tomás Herrera" meta="En proceso · en tránsito" amount="−$2,950.00" />
          <PreviewRow icon={ArrowUpRight} title="Greenfield Print Co." meta="Pendiente de revisión" amount="−$12,500.00" />
        </ul>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="outline-none focus-visible:opacity-80">
          <Logo />
        </Link>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" className="hidden sm:inline-flex">
            <Link href="/register">Abrir una cuenta</Link>
          </Button>
          <Button asChild>
            <Link href="/login">Iniciar sesión</Link>
          </Button>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pt-10 pb-16 sm:px-8 sm:pt-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:pb-24">
          <div className="animate-rise">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-card">
              <span className="size-1.5 rounded-full bg-chart-in" />
              Banca digital y operaciones financieras
            </p>
            <h1 className="display mt-6 text-[2.75rem] text-balance sm:text-6xl lg:text-[4rem]">
              Banca construida sobre un libro mayor que puedes <em className="text-primary">auditar</em>.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
              Aldera reúne cuentas, transferencias y seguimiento de transacciones en tiempo real sobre un libro mayor de partida doble, donde
              cada centavo está contabilizado y cada acción sensible deja registro.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="xl">
                <Link href="/login">
                  Explorar la demostración <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="xl" variant="outline">
                <Link href="/register">Abrir una cuenta</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">Hay perfiles de ejemplo de cliente, operador y administrador listos para usar.</p>
          </div>
          <ProductPreview />
        </section>

        <section className="border-y border-border/70 bg-card">
          <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
            <p className="eyebrow text-accent-foreground">La plataforma</p>
            <h2 className="display mt-3 max-w-2xl text-4xl text-balance sm:text-[2.75rem]">Todo lo que un producto financiero moderno necesita para operar día a día.</h2>
            <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((item) => (
                <li key={item.title}>
                  <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <item.icon className="size-5" />
                  </span>
                  <h3 className="mt-4 font-semibold tracking-[-0.01em]">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-pretty text-muted-foreground">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="bg-sidebar text-sidebar-foreground">
          <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
            <p className="eyebrow text-sidebar-primary">Integridad financiera</p>
            <h2 className="display mt-3 max-w-2xl text-4xl text-balance sm:text-[2.75rem]">Correcto por construcción, no por convención.</h2>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-pretty text-sidebar-muted sm:text-base">
              Las reglas que protegen el dinero se aplican en el modelo de datos y en la propia base de datos, así que se mantienen aunque
              cambie el código de la aplicación.
            </p>
            <ul className="mt-12 grid gap-4 sm:grid-cols-2">
              {PRINCIPLES.map((item) => (
                <li key={item.title} className="rounded-xl border border-sidebar-border bg-white/[0.03] p-6">
                  <item.icon className="size-5 text-sidebar-primary" />
                  <h3 className="mt-4 font-semibold tracking-[-0.01em]">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-pretty text-sidebar-muted">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="eyebrow text-accent-foreground">Tres vistas, una plataforma</p>
              <h2 className="display mt-3 max-w-xl text-4xl text-balance sm:text-[2.75rem]">Conócela desde cada rol.</h2>
            </div>
            <Button asChild size="lg">
              <Link href="/login">
                Abrir la demostración <ArrowRight />
              </Link>
            </Button>
          </div>
          <ul className="mt-10 grid gap-4 md:grid-cols-3">
            {ROLES.map((item) => (
              <li key={item.role} className="rounded-xl bg-card p-6 shadow-card ring-1 ring-foreground/[0.07]">
                <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <item.icon className="size-5" />
                </span>
                <h3 className="mt-4 font-semibold tracking-[-0.01em]">{item.role}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-pretty text-muted-foreground">{item.body}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-8 text-xs leading-relaxed text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Logo className="[&>span]:text-sm" />
          <p className="max-w-xl sm:text-right">
            Aldera es una institución ficticia creada para demostrar ingeniería de software financiero. No es un banco, no tiene licencia y
            no mueve dinero real.
          </p>
        </div>
      </footer>
    </div>
  );
}
