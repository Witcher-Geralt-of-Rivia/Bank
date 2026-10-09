import "server-only";
import { asc, desc, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { type AuditLog, auditLogs } from "@/db/schema";
import type { AuditAction } from "@/lib/domain";
import { type RequestContext, clock, makeId } from "./context";
import { sha256, stableStringify } from "./ids";

const AUDIT_LOCK = 7_274_003;
export const GENESIS_HASH = "0".repeat(64);

export type AuditEntry = {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
  /** Overrides the actor label, e.g. the email used in a failed sign-in. */
  actorLabel?: string;
};

export type AuditHashFields = Pick<
  AuditLog,
  | "id"
  | "actorId"
  | "actorLabel"
  | "actorRole"
  | "action"
  | "entityType"
  | "entityId"
  | "summary"
  | "metadata"
  | "ip"
  | "userAgent"
  | "prevHash"
  | "createdAt"
>;

/** Hash of one audit record, covering its content and its predecessor. */
export function hashAuditRecord(record: AuditHashFields): string {
  return sha256(
    stableStringify({
      id: record.id,
      actorId: record.actorId,
      actorLabel: record.actorLabel,
      actorRole: record.actorRole,
      action: record.action,
      entityType: record.entityType,
      entityId: record.entityId,
      summary: record.summary,
      metadata: record.metadata,
      ip: record.ip,
      userAgent: record.userAgent,
      prevHash: record.prevHash,
      createdAt: record.createdAt.toISOString(),
    }),
  );
}

/**
 * Appends a record to the audit log.
 *
 * Call it with the same transaction handle as the change being audited: the
 * record then commits or rolls back together with that change, so there is
 * never a sensitive action without its audit record, or the reverse.
 *
 * Each record stores the hash of the one before it. Altering or removing any
 * historical record breaks the chain from that point on, which
 * `verifyAuditChain` detects.
 */
export async function recordAudit(
  db: DbOrTx,
  ctx: RequestContext,
  entry: AuditEntry,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Serialises writers so the chain has a single, unambiguous order.
    await tx.execute(sql.raw(`SELECT pg_advisory_xact_lock(${AUDIT_LOCK})`));

    const [last] = await tx
      .select({ hash: auditLogs.hash })
      .from(auditLogs)
      .orderBy(desc(auditLogs.seq))
      .limit(1);

    const record: AuditHashFields = {
      id: makeId(ctx, "aud"),
      actorId: ctx.actor.id,
      actorLabel: entry.actorLabel ?? ctx.actor.label,
      actorRole: ctx.actor.role,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      metadata: entry.metadata ?? {},
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      prevHash: last?.hash ?? GENESIS_HASH,
      createdAt: clock(ctx),
    };

    await tx.insert(auditLogs).values({ ...record, hash: hashAuditRecord(record) });
  });
}

export type ChainVerification = {
  valid: boolean;
  checked: number;
  /** Sequence number of the first record that fails verification. */
  brokenAtSeq: number | null;
};

/** Recomputes every hash in order and confirms each link to its predecessor. */
export async function verifyAuditChain(db: DbOrTx): Promise<ChainVerification> {
  const records = await db.select().from(auditLogs).orderBy(asc(auditLogs.seq));

  let previous = GENESIS_HASH;
  for (const record of records) {
    if (record.prevHash !== previous || hashAuditRecord(record) !== record.hash) {
      return { valid: false, checked: records.length, brokenAtSeq: record.seq };
    }
    previous = record.hash;
  }
  return { valid: true, checked: records.length, brokenAtSeq: null };
}
