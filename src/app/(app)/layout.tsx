import { Bell } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { MobileMenu, MobileTabBar, Sidebar, UserMenu } from "@/components/app/nav";
import { getDb } from "@/db/client";
import { env } from "@/lib/env";
import { navigationFor } from "@/lib/navigation";
import { homeFor, requireUser } from "@/server/auth/session";
import { countUnreadNotifications } from "@/server/queries/misc";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const db = await getDb();
  const unread = await countUnreadNotifications(db, user.id);
  const groups = navigationFor(user.role);
  const home = homeFor(user.role);
  const isCustomer = user.role === "customer";

  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Saltar al contenido
      </a>
      <Sidebar groups={groups} unread={unread} home={home} demo={env.demoMode} />

      <div className="flex min-h-dvh flex-1 flex-col lg:pl-60">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border/70 bg-background/85 px-4 backdrop-blur sm:px-6 lg:h-16 lg:px-10">
          <MobileMenu groups={groups} unread={unread} demo={env.demoMode} />
          <Link href={home} className="outline-none focus-visible:opacity-80 lg:hidden" aria-label="Inicio de Aldera">
            <LogoMark className="size-7" />
          </Link>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
            {env.demoMode ? (
              <span className="hidden items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground md:inline-flex">
                <span className="size-1.5 rounded-full bg-chart-in" />
                Datos de demostración
              </span>
            ) : null}
            <Link
              href="/notifications"
              aria-label={unread > 0 ? `Notificaciones, ${unread} sin leer` : "Notificaciones"}
              className="relative flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <Bell className="size-[1.125rem]" />
              {unread > 0 ? (
                <span className="tabular absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.625rem] leading-4 font-semibold text-white ring-2 ring-background">
                  {unread > 9 ? "9+" : unread}
                </span>
              ) : null}
            </Link>
            <UserMenu user={{ name: user.name, email: user.email, role: user.role }} />
          </div>
        </header>

        <main
          id="content"
          className={`mx-auto w-full max-w-[76rem] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10 ${isCustomer ? "pb-24 lg:pb-10" : ""}`}
        >
          {children}
        </main>
      </div>

      {isCustomer ? <MobileTabBar /> : null}
    </div>
  );
}
