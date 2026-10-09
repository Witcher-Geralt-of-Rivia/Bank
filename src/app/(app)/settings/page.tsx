import { Bell, CircleCheck, CircleX, History, ShieldCheck, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { PasswordForm } from "@/components/settings/password-form";
import { PreferencesForm } from "@/components/settings/preferences-form";
import { ProfileForm } from "@/components/settings/profile-form";
import { TwoFactorToggle } from "@/components/settings/two-factor-toggle";
import { EmptyState, PageHeader, Section } from "@/components/shared/page";
import { Pill } from "@/components/shared/status";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDb } from "@/db/client";
import { ROLE_LABELS } from "@/lib/domain";
import { describeUserAgent, formatDate, formatDateTime, initials, pluralize } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { SESSION_TTL_SECONDS } from "@/server/auth/token";
import { listSignInActivity } from "@/server/queries/misc";

export const metadata: Metadata = { title: "Configuración" };

const TABS = ["profile", "security", "notifications"] as const;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SettingsPage({ searchParams }: Props) {
  const user = await requireUser();
  const query = await searchParams;
  const db = await getDb();
  const signIns = await listSignInActivity(db, user.id, 10);

  // `?tab=security` opens a section directly; anything else falls back to the profile.
  const requested = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const tab = TABS.find((value) => value === requested) ?? "profile";

  return (
    <>
      <PageHeader title="Configuración" description="Administra tu perfil, la seguridad de tu inicio de sesión y tus preferencias de notificaciones." />

      <Tabs defaultValue={tab} className="max-w-3xl gap-6">
        {/* Scrolls sideways instead of wrapping when the screen is narrower than the tabs. */}
        <div className="-mx-4 -my-1 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
          <TabsList>
            <TabsTrigger value="profile">
              <UserRound className="size-3.5" /> Perfil
            </TabsTrigger>
            <TabsTrigger value="security">
              <ShieldCheck className="size-3.5" /> Seguridad
            </TabsTrigger>
            <TabsTrigger value="notifications">
              <Bell className="size-3.5" /> Notificaciones
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="profile" className="grid gap-6">
          <Section>
            <div className="flex items-center gap-4">
              <Avatar className="size-14">
                <AvatarFallback className="bg-primary text-lg font-semibold text-primary-foreground">
                  {initials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="heading truncate text-lg">{user.name}</p>
                <p className="truncate text-sm text-muted-foreground">{user.email}</p>
              </div>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border/70 pt-5">
              <div>
                <dt className="text-xs text-muted-foreground">Rol</dt>
                <dd className="mt-1 text-sm font-medium">{ROLE_LABELS[user.role]}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Miembro desde</dt>
                <dd className="mt-1 text-sm font-medium">{formatDate(user.createdAt)}</dd>
              </div>
            </dl>
          </Section>

          <Section title="Datos personales" description="Así se te identifica en Aldera">
            <ProfileForm name={user.name} email={user.email} company={user.company} phone={user.phone} />
          </Section>
        </TabsContent>

        <TabsContent value="security" className="grid gap-6">
          <Section title="Contraseña" description="Necesitarás tu contraseña actual para elegir una nueva">
            <PasswordForm email={user.email} />
          </Section>

          <Section title="Protección del inicio de sesión">
            <TwoFactorToggle enabled={user.twoFactorEnabled} />
          </Section>

          <Section
            title="Actividad reciente de inicio de sesión"
            description="Los últimos intentos de iniciar sesión en tu perfil, exitosos o no"
            flush
          >
            {signIns.length === 0 ? (
              <EmptyState
                icon={History}
                title="Aún no hay inicios de sesión registrados"
                description="Cada vez que alguien inicie sesión en tu perfil, o lo intente, aparecerá aquí."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Resultado</TableHead>
                    <TableHead>Fecha y hora</TableHead>
                    <TableHead className="hidden sm:table-cell">Dispositivo</TableHead>
                    <TableHead className="hidden sm:table-cell">Dirección IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {signIns.map((signIn, index) => (
                    <TableRow key={`${signIn.at.toISOString()}-${index}`} className="hover:bg-transparent">
                      <TableCell>
                        {signIn.success ? (
                          <Pill tone="success" icon={CircleCheck}>
                            Exitoso
                          </Pill>
                        ) : (
                          <Pill tone="danger" icon={CircleX}>
                            Fallido
                          </Pill>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <span className="tabular block">{formatDateTime(signIn.at)}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground sm:hidden">
                          {describeUserAgent(signIn.userAgent)} · {signIn.ip ?? "Dirección desconocida"}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {describeUserAgent(signIn.userAgent)}
                      </TableCell>
                      <TableCell className="tabular hidden font-mono text-[0.8125rem] text-muted-foreground sm:table-cell">
                        {signIn.ip ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>

          <Section title="Sesión">
            <p className="max-w-xl text-sm text-pretty text-muted-foreground">
              Las sesiones expiran después de {pluralize(SESSION_TTL_SECONDS / 3600, "hora")} y se guardan en una cookie
              HTTP-only, que los scripts que se ejecutan en la página no pueden leer. Al cerrar sesión, la sesión termina en
              este dispositivo.
            </p>
          </Section>
        </TabsContent>

        <TabsContent value="notifications" className="grid gap-6">
          <Section title="Preferencias de notificaciones" description="Elige las novedades que quieres recibir">
            <PreferencesForm notifyTransfers={user.notifyTransfers} notifySecurity={user.notifySecurity} />
            <p className="mt-5 rounded-lg bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              Los cambios se guardan al momento y se aplican a las nuevas notificaciones dentro de Aldera. Esta demostración
              no envía correos electrónicos ni mensajes de texto.
            </p>
          </Section>
        </TabsContent>
      </Tabs>
    </>
  );
}
