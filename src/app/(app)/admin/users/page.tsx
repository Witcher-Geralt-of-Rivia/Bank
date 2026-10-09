import { Lock, Search, SearchX, ShieldCheck, ShieldOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UserActions } from "@/components/admin/user-actions";
import { Money } from "@/components/shared/money";
import { Callout, EmptyState, PageHeader, Section } from "@/components/shared/page";
import { RoleBadge, UserStatusBadge } from "@/components/shared/status";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/db/client";
import { isStaff } from "@/lib/domain";
import { formatCount, formatRelative, initials, pluralize } from "@/lib/format";
import { BASE_CURRENCY, formatIndicativeRate } from "@/lib/money";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { type AdminUserRow, listUsers } from "@/server/queries/admin";

export const metadata: Metadata = { title: "Usuarios" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function Identity({ row, self }: { row: AdminUserRow; self: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3 text-sm">
      <Avatar className="size-9">
        <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">{initials(row.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 font-medium">
          <span className="truncate">{row.name}</span>
          {self ? (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.6875rem] leading-4 font-semibold tracking-wide text-muted-foreground">
              Tú
            </span>
          ) : null}
        </p>
        <p className="truncate text-xs text-muted-foreground" title={row.email}>
          {row.email}
          {row.company ? ` · ${row.company}` : ""}
        </p>
      </div>
    </div>
  );
}

/** Never colour alone: the icon and the word both carry the state. */
function TwoStep({ enabled }: { enabled: boolean }) {
  const Icon = enabled ? ShieldCheck : ShieldOff;
  return (
    <span className={cn("inline-flex items-center gap-1.5", !enabled && "text-muted-foreground")}>
      <Icon className={cn("size-4", enabled && "text-success")} />
      {enabled ? "Activada" : "Desactivada"}
    </span>
  );
}

export default async function AdminUsersPage({ searchParams }: Props) {
  const user = await requireUser();
  if (!isStaff(user.role)) notFound();
  const db = await getDb();

  const params = await searchParams;
  const q = (Array.isArray(params.q) ? params.q[0] : params.q)?.trim().slice(0, 80) || undefined;
  const rows = await listUsers(db, q);

  const now = new Date();
  const isAdmin = user.role === "admin";
  // Staff normally hold no accounts, but someone whose role was changed may.
  const holdsAccounts = (row: AdminUserRow) => row.role === "customer" || row.accountCount > 0;
  const lastSignIn = (row: AdminUserRow) => (row.lastLoginAt ? formatRelative(row.lastLoginAt, now) : "Nunca");

  return (
    <>
      <PageHeader
        title="Usuarios"
        description="Todas las personas que pueden iniciar sesión en Aldera: los clientes, y los operadores y administradores que gestionan la plataforma."
      />

      {!isAdmin ? (
        <Callout tone="info" icon={Lock} title="La gestión de usuarios está restringida a los administradores" className="mb-6">
          Aquí puedes consultar a cualquier usuario. Solo un administrador puede suspender o reactivar a un usuario, o cambiar su rol.
        </Callout>
      ) : null}

      {/* Keyed by the applied search so the field follows the URL when "Clear" changes it. */}
      <form key={q ?? ""} action="/admin/users" method="get" role="search" className="mb-4 flex gap-2 sm:max-w-md">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            maxLength={80}
            placeholder="Buscar por nombre, correo o empresa"
            aria-label="Buscar usuarios"
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="outline" size="lg">
          Buscar
        </Button>
        {q ? (
          <Button asChild variant="ghost" size="lg">
            <Link href="/admin/users">Limpiar</Link>
          </Button>
        ) : null}
      </form>

      <Section flush>
        {rows.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="Ningún usuario coincide con esta búsqueda"
            description="Revisa la ortografía o busca por otro nombre, correo electrónico o empresa."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/users">Limpiar búsqueda</Link>
              </Button>
            }
          />
        ) : (
          <>
            <p className="px-5 pt-4 pb-1 text-xs text-muted-foreground" aria-live="polite">
              {pluralize(rows.length, "usuario")}
              {q ? (rows.length === 1 ? " coincide con tu búsqueda" : " coinciden con tu búsqueda") : ""}
            </p>

            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Usuario</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="hidden xl:table-cell">
                      <span className="sr-only">Verificación en </span>Dos pasos
                    </TableHead>
                    <TableHead className="hidden text-right xl:table-cell">Saldo · {BASE_CURRENCY}</TableHead>
                    <TableHead className="hidden xl:table-cell">
                      Último inicio<span className="sr-only"> de sesión</span>
                    </TableHead>
                    {isAdmin ? (
                      <TableHead>
                        <span className="sr-only">Acciones</span>
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="w-full max-w-0">
                        <Identity row={row} self={row.id === user.id} />
                      </TableCell>
                      <TableCell>
                        <RoleBadge role={row.role} />
                      </TableCell>
                      <TableCell>
                        <UserStatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <TwoStep enabled={row.twoFactorEnabled} />
                      </TableCell>
                      <TableCell className="hidden text-right xl:table-cell">
                        {holdsAccounts(row) ? (
                          <>
                            <Money minor={row.balanceBaseMinor} currency={BASE_CURRENCY} className="font-medium" />
                            <span className="block text-xs text-muted-foreground">{pluralize(row.accountCount, "cuenta")}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell className="tabular hidden text-muted-foreground xl:table-cell">{lastSignIn(row)}</TableCell>
                      {isAdmin ? (
                        <TableCell>
                          {row.id !== user.id ? (
                            <UserActions id={row.id} name={row.name} role={row.role} status={row.status} compact />
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y divide-border/70 md:hidden">
              {rows.map((row) => (
                <li key={row.id} className="grid grid-cols-1 gap-3 px-5 py-4">
                  <Identity row={row} self={row.id === user.id} />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <RoleBadge role={row.role} />
                    <UserStatusBadge status={row.status} />
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Verificación en dos pasos</dt>
                      <dd className="mt-1 font-medium">
                        <TwoStep enabled={row.twoFactorEnabled} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Último inicio de sesión</dt>
                      <dd className="tabular mt-1 font-medium">{lastSignIn(row)}</dd>
                    </div>
                    {holdsAccounts(row) ? (
                      <>
                        <div>
                          <dt className="text-xs text-muted-foreground">Cuentas</dt>
                          <dd className="tabular mt-1 font-medium">{formatCount(row.accountCount)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Saldo · {BASE_CURRENCY}</dt>
                          <dd className="mt-1 font-medium">
                            <Money minor={row.balanceBaseMinor} currency={BASE_CURRENCY} />
                          </dd>
                        </div>
                      </>
                    ) : null}
                  </dl>
                  {isAdmin && row.id !== user.id ? (
                    <UserActions id={row.id} name={row.name} role={row.role} status={row.status} />
                  ) : null}
                </li>
              ))}
            </ul>

            {rows.some(holdsAccounts) ? (
              <p className="border-t border-border/70 px-5 py-3 text-xs text-pretty text-muted-foreground md:max-xl:hidden">
                Los saldos suman todas las cuentas de cada usuario y se muestran en {BASE_CURRENCY}. Los montos en EUR se convierten a
                un tipo de cambio indicativo de 1 EUR = {formatIndicativeRate("EUR")} USD.
              </p>
            ) : null}
          </>
        )}
      </Section>
    </>
  );
}
