import { ChevronDown, ScrollText, Search, SearchX, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AUDIT_AREAS, AuditActionPill } from "@/components/admin/audit-action";
import { CopyButton } from "@/components/shared/client";
import { Callout, DetailRow, EmptyState, PageHeader, Pagination, Section } from "@/components/shared/page";
import { Pill } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/db/client";
import type { AuditLog } from "@/db/schema";
import { ROLE_LABELS, type Role, isStaff } from "@/lib/domain";
import { describeUserAgent, formatDateTime, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GENESIS_HASH, verifyAuditChain } from "@/server/audit";
import { requireUser } from "@/server/auth/session";
import { listAuditLogs } from "@/server/queries/admin";

export const metadata: Metadata = { title: "Audit log" };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type Filters = { area?: string; q?: string; page?: number };

/** Link to the log with the given filters; defaults are left out of the URL. */
function auditHref({ area, q, page }: Filters): string {
  const params = new URLSearchParams();
  if (area) params.set("area", area);
  if (q) params.set("q", q);
  if (page && page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/audit?${query}` : "/admin/audit";
}

/** Records written by the platform itself carry a role outside the user roles. */
function actorRoleLabel(role: string): string {
  return role in ROLE_LABELS ? ROLE_LABELS[role as Role] : "System";
}

function ActionPills({ record, failing }: { record: AuditLog; failing: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <AuditActionPill action={record.action} />
      {failing ? (
        <Pill tone="danger" icon={TriangleAlert}>
          Fails verification
        </Pill>
      ) : null}
    </span>
  );
}

/** A technical value in mono, with a button that copies it in full. */
function CopyableRow({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <DetailRow label={label}>
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono text-[0.8125rem] break-all" title={value}>
          {children}
        </span>
        <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} className="shrink-0" />
      </span>
    </DetailRow>
  );
}

/** Hashes are 64 characters; the two ends are enough to compare by eye. */
function shortHash(hash: string): string {
  return `${hash.slice(0, 12)}…${hash.slice(-6)}`;
}

/** Everything stored with one record, including the two hashes that chain it. */
function RecordDetail({ record }: { record: AuditLog }) {
  const hasMetadata = Object.keys(record.metadata).length > 0;
  return (
    <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
      <div className="min-w-0">
        <p className="eyebrow text-muted-foreground">Metadata</p>
        {hasMetadata ? (
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-card p-3 font-mono text-xs leading-relaxed wrap-anywhere whitespace-pre-wrap ring-1 ring-foreground/[0.07]">
            {JSON.stringify(record.metadata, null, 2)}
          </pre>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No additional details were recorded.</p>
        )}
      </div>
      <dl className="-my-2.5 min-w-0 divide-y divide-border/70">
        <DetailRow label="Sequence">
          <span className="tabular">#{record.seq}</span>
        </DetailRow>
        <CopyableRow label="Record ID" value={record.id}>
          {record.id}
        </CopyableRow>
        {record.entityId ? (
          <CopyableRow label="Entity ID" value={record.entityId}>
            {record.entityType} · {record.entityId}
          </CopyableRow>
        ) : (
          <DetailRow label="Entity">
            <span className="font-mono text-[0.8125rem]">{record.entityType}</span>
          </DetailRow>
        )}
        <DetailRow label="IP address">
          {record.ip ? <span className="font-mono text-[0.8125rem] break-all">{record.ip}</span> : "Not recorded"}
        </DetailRow>
        <DetailRow label="Device">{describeUserAgent(record.userAgent)}</DetailRow>
        <CopyableRow label="Record hash" value={record.hash}>
          {shortHash(record.hash)}
        </CopyableRow>
        {record.prevHash === GENESIS_HASH ? (
          <DetailRow label="Previous hash">None · first record in the chain</DetailRow>
        ) : (
          <CopyableRow label="Previous hash" value={record.prevHash}>
            {shortHash(record.prevHash)}
          </CopyableRow>
        )}
      </dl>
    </div>
  );
}

export default async function AuditLogPage({ searchParams }: Props) {
  const user = await requireUser();
  if (!isStaff(user.role)) notFound();
  const query = await searchParams;
  const db = await getDb();

  const param = (key: string) => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  };
  const areaParam = param("area");
  const area = AUDIT_AREAS.find((option) => option.value === areaParam);
  const q = param("q")?.slice(0, 80);
  const pageParam = Number(param("page"));
  const filters: Filters = {
    area: area?.value,
    q,
    page: Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1,
  };
  const filtered = Boolean(filters.area || filters.q);

  const [chain, log] = await Promise.all([verifyAuditChain(db), listAuditLogs(db, filters)]);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="An append-only record of every sign-in, money movement and operations action. Each record is chained to the one before it, so a change to history cannot go unnoticed."
      />

      {chain.valid ? (
        <Callout tone="success" icon={ShieldCheck} title="Audit chain intact" className="mb-6">
          {pluralize(chain.checked, "record")} verified. Every hash was recomputed and every link to the previous record confirmed.
        </Callout>
      ) : (
        <Callout tone="danger" icon={ShieldAlert} title={`Audit chain broken at record #${chain.brokenAtSeq}`} className="mb-6">
          Record #{chain.brokenAtSeq} is the first that no longer matches its stored hash or its link to the record before it. Treat it and
          every later record as unverified until this has been investigated.
        </Callout>
      )}

      <div className="mb-4 flex flex-col gap-3">
        {/* Keyed by the applied search so the field follows the URL when "Clear" changes it. */}
        <form key={filters.q ?? ""} action="/admin/audit" method="get" role="search" className="flex gap-2 sm:max-w-md">
          {filters.area ? <input type="hidden" name="area" value={filters.area} /> : null}
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              name="q"
              defaultValue={filters.q ?? ""}
              maxLength={80}
              placeholder="Search actor, summary or entity ID"
              aria-label="Search the audit log"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline" size="lg">
            Search
          </Button>
          {filters.q ? (
            <Button asChild variant="ghost" size="lg">
              <Link href={auditHref({ area: filters.area })}>Clear</Link>
            </Button>
          ) : null}
        </form>

        <nav
          aria-label="Filter by area"
          className="-mx-4 -my-1 flex gap-2 overflow-x-auto px-4 py-1 sm:-mx-6 sm:px-6 md:mx-0 md:flex-wrap md:px-0"
        >
          {[{ value: undefined, label: "All" }, ...AUDIT_AREAS].map((option) => {
            const active = option.value === filters.area;
            return (
              <Link
                key={option.label}
                href={auditHref({ area: option.value, q: filters.q })}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center rounded-full px-3 text-[0.8125rem] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground ring-1 ring-foreground/[0.07] hover:bg-muted hover:text-foreground",
                )}
              >
                {option.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <Section flush>
        {log.rows.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="No records match these filters"
              description="Try a different search term or area, or clear the filters."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/audit">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={ScrollText}
              title="No audit records yet"
              description="Sign-ins, money movements and operations actions are recorded here as they happen."
            />
          )
        ) : (
          <>
            <p className="px-5 pt-4 pb-1 text-xs text-muted-foreground" aria-live="polite">
              {pluralize(log.total, "record")}
              {filtered ? (log.total === 1 ? " matches your filters" : " match your filters") : ""}
            </p>

            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Time</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="hidden xl:table-cell">Entity</TableHead>
                    <TableHead className="hidden xl:table-cell">Origin</TableHead>
                    <TableHead>
                      <span className="sr-only">Details</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                {/* One body per record: opening its toggle reveals the row beneath it. */}
                {log.rows.map((record) => (
                  <TableBody key={record.seq} className="group border-b border-border/70 last:border-b-0">
                    <TableRow className="border-b-0 group-has-[details[open]]:bg-muted/50">
                      <TableCell className="tabular align-top">{formatDateTime(record.createdAt)}</TableCell>
                      <TableCell className="max-w-[9rem] align-top">
                        <span className="block truncate font-medium" title={record.actorLabel}>
                          {record.actorLabel}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{actorRoleLabel(record.actorRole)}</span>
                      </TableCell>
                      <TableCell className="w-full max-w-0 align-top whitespace-normal">
                        <ActionPills record={record} failing={record.seq === chain.brokenAtSeq} />
                        <span className="mt-1.5 block text-pretty">{record.summary}</span>
                      </TableCell>
                      <TableCell className="hidden max-w-[8.5rem] align-top xl:table-cell">
                        <span className="block truncate font-mono text-[0.8125rem]">{record.entityType}</span>
                        <span className="block truncate font-mono text-xs text-muted-foreground" title={record.entityId ?? undefined}>
                          {record.entityId ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell className="hidden max-w-[9.5rem] align-top xl:table-cell">
                        {record.ip ? (
                          <span className="block truncate font-mono text-[0.8125rem]" title={record.ip}>
                            {record.ip}
                          </span>
                        ) : (
                          <span className="block truncate">Not recorded</span>
                        )}
                        <span className="block truncate text-xs text-muted-foreground">{describeUserAgent(record.userAgent)}</span>
                      </TableCell>
                      <TableCell className="align-top">
                        <details>
                          <summary className="-my-1 flex size-7 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden">
                            <ChevronDown className="size-4 transition-transform group-has-[details[open]]:rotate-180" />
                            <span className="sr-only">Details of record {record.seq}</span>
                          </summary>
                        </details>
                      </TableCell>
                    </TableRow>
                    <tr className="hidden group-has-[details[open]]:table-row">
                      <td colSpan={6} className="bg-muted/50 px-5 pt-1 pb-5 text-sm">
                        <RecordDetail record={record} />
                      </td>
                    </tr>
                  </TableBody>
                ))}
              </Table>
            </div>

            <ul className="divide-y divide-border/70 md:hidden">
              {log.rows.map((record) => (
                <li key={record.seq}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-3.5 transition-colors outline-none group-open:bg-muted/50 hover:bg-muted/50 focus-visible:bg-muted/60 [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0 flex-1">
                        <ActionPills record={record} failing={record.seq === chain.brokenAtSeq} />
                        <span className="mt-1.5 block text-sm text-pretty">{record.summary}</span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {record.actorLabel} · {actorRoleLabel(record.actorRole)}
                        </span>
                        <span className="tabular block text-xs text-muted-foreground">{formatDateTime(record.createdAt)}</span>
                      </span>
                      <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground/60 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="bg-muted/50 px-5 pt-1 pb-5 text-sm">
                      <RecordDetail record={record} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>

            <Pagination
              page={log.page}
              pageCount={log.pageCount}
              total={log.total}
              noun="records"
              hrefFor={(page) => auditHref({ ...filters, page })}
            />
          </>
        )}
      </Section>
    </>
  );
}
