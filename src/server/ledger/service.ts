import "server-only";
import { and, eq } from "drizzle-orm";
import type { DbOrTx, Tx } from "@/db/client";
import {
  type Account,
  type Transaction,
  type TransactionMetadata,
  accounts,
  beneficiaries,
  ledgerEntries,
  notifications,
  transactionEvents,
  transactions,
  users,
} from "@/db/schema";
import {
  ACCOUNT_STATUS_LABELS,
  type AuditAction,
  type Category,
  type NotificationKind,
  TRANSACTION_STATUS_LABELS,
  type TransactionStatus,
  type TransactionType,
  TRANSFER_POLICY,
  canTransition,
  maskAccountNumber,
} from "@/lib/domain";
import {
  AccountUnavailableError,
  CurrencyMismatchError,
  DomainError,
  IdempotencyConflictError,
  InvalidStateError,
  LimitExceededError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { type CurrencyCode, formatMoney } from "@/lib/money";
import { recordAudit } from "../audit";
import {
  type RequestContext,
  assertAdmin,
  assertCustomer,
  assertStaff,
  assertSystem,
  clock,
  makeId,
  makeReference,
} from "../context";
import { fingerprint } from "../ids";
import {
  type Leg,
  lockAccounts,
  placeHold,
  postEntries,
  releaseHold,
  systemAccountId,
} from "./postings";

/**
 * Ledger service — every operation that creates or advances a transaction.
 *
 * Each exported function runs in a single database transaction: the
 * transaction record, its ledger entries, balance updates, status event,
 * audit record and notifications commit together or not at all.
 */

export type OperationResult = {
  transaction: Transaction;
  /** True when an earlier request with the same idempotency key was returned. */
  replayed: boolean;
};

export type TransferDestination =
  | { kind: "account"; accountId: string }
  | { kind: "beneficiary"; beneficiaryId: string };

export type CreateTransferInput = {
  idempotencyKey: string;
  sourceAccountId: string;
  destination: TransferDestination;
  amountMinor: bigint;
  description: string;
  category?: Category;
  /** Demo only: let the settlement simulator complete this transfer. */
  autoSettle?: boolean;
};

export type FundingInput = {
  idempotencyKey: string;
  accountId: string;
  amountMinor: bigint;
  description: string;
};

export type ExternalActivityInput = {
  idempotencyKey: string;
  type: Extract<
    TransactionType,
    "card_payment" | "fee" | "interest" | "transfer_in"
  >;
  accountId: string;
  amountMinor: bigint;
  counterpartyName: string;
  description: string;
  category: Category;
};

// --- helpers ---------------------------------------------------------------

function assertValidAmount(amountMinor: bigint): void {
  if (amountMinor <= 0n) {
    throw new ValidationError("El monto debe ser mayor que cero.", {
      amount: "El monto debe ser mayor que cero.",
    });
  }
}

function assertWithinLimit(amountMinor: bigint, currency: CurrencyCode): void {
  if (amountMinor > TRANSFER_POLICY.maxAmountMinor) {
    throw new LimitExceededError(
      `El límite por movimiento es de ${formatMoney(TRANSFER_POLICY.maxAmountMinor, currency)}.`,
    );
  }
}

function assertIdempotencyKey(key: string): void {
  if (key.length < 8 || key.length > 128) {
    throw new ValidationError("Se requiere una clave de idempotencia válida.");
  }
}

/**
 * Looks up an earlier request made with the same key. The same key with a
 * different payload is a client error, never a silent replay.
 */
async function findReplay(
  tx: Tx,
  scope: string,
  key: string,
  requestHash: string,
): Promise<Transaction | null> {
  const [existing] = await tx
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.idempotencyScope, scope),
        eq(transactions.idempotencyKey, key),
      ),
    )
    .limit(1);
  if (!existing) return null;
  if (existing.requestHash !== requestHash) throw new IdempotencyConflictError();
  return existing;
}

type NewTransaction = Omit<
  typeof transactions.$inferInsert,
  "id" | "reference" | "createdAt" | "updatedAt" | "metadata"
> & { metadata?: TransactionMetadata };

/**
 * Inserts the transaction record, claiming its idempotency key. When a
 * concurrent request has already claimed the key, the insert is skipped and
 * that request's transaction is returned instead, before any money has moved.
 */
async function insertTransaction(
  tx: Tx,
  ctx: RequestContext,
  values: NewTransaction,
): Promise<{ transaction: Transaction; created: boolean }> {
  const at = clock(ctx);
  const [created] = await tx
    .insert(transactions)
    .values({
      ...values,
      id: makeId(ctx, "txn"),
      reference: makeReference(ctx),
      metadata: {
        channel: ctx.channel ?? "web",
        ...(ctx.ip ? { ip: ctx.ip } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
        ...values.metadata,
      },
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoNothing({
      target: [transactions.idempotencyScope, transactions.idempotencyKey],
    })
    .returning();

  if (created) return { transaction: created, created: true };

  const replay = await findReplay(
    tx,
    values.idempotencyScope,
    values.idempotencyKey,
    values.requestHash,
  );
  if (!replay) {
    throw new DomainError("conflict", "No se pudo registrar la solicitud.", 409);
  }
  return { transaction: replay, created: false };
}

async function addEvent(
  tx: Tx,
  ctx: RequestContext,
  transactionId: string,
  from: TransactionStatus | null,
  to: TransactionStatus,
  note: string,
): Promise<void> {
  await tx.insert(transactionEvents).values({
    transactionId,
    fromStatus: from,
    toStatus: to,
    actorId: ctx.actor.id,
    actorLabel: ctx.actor.label,
    note,
    createdAt: clock(ctx),
  });
}

export async function notify(
  tx: Tx,
  ctx: RequestContext,
  userId: string | null | undefined,
  kind: NotificationKind,
  title: string,
  body: string,
  href?: string,
): Promise<void> {
  if (!userId) return;

  // Respect the recipient's notification preferences.
  if (kind === "transaction" || kind === "security") {
    const [preferences] = await tx
      .select({ transfers: users.notifyTransfers, security: users.notifySecurity })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (preferences && !(kind === "transaction" ? preferences.transfers : preferences.security)) return;
  }
  await tx.insert(notifications).values({
    id: makeId(ctx, "ntf"),
    userId,
    kind,
    title,
    body,
    href: href ?? null,
    createdAt: clock(ctx),
  });
}

function auditTransaction(
  tx: Tx,
  ctx: RequestContext,
  action: AuditAction,
  transaction: Transaction,
  summary: string,
  extra: Record<string, unknown> = {},
) {
  return recordAudit(tx, ctx, {
    action,
    entityType: "transaction",
    entityId: transaction.id,
    summary,
    metadata: {
      reference: transaction.reference,
      type: transaction.type,
      status: transaction.status,
      amountMinor: transaction.amountMinor.toString(),
      currency: transaction.currency,
      ...extra,
    },
  });
}

function money(transaction: Pick<Transaction, "amountMinor" | "currency">) {
  return formatMoney(transaction.amountMinor, transaction.currency);
}

async function ownerOf(tx: Tx, accountId: string | null): Promise<string | null> {
  if (!accountId) return null;
  const [row] = await tx
    .select({ ownerId: accounts.ownerId })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  return row?.ownerId ?? null;
}

/** Loads and locks a transaction for a status change. */
async function lockTransaction(tx: Tx, id: string): Promise<Transaction> {
  const [row] = await tx
    .select()
    .from(transactions)
    .where(eq(transactions.id, id))
    .for("update");
  if (!row) throw new NotFoundError("la transacción");
  return row;
}

function assertTransition(
  transaction: Transaction,
  to: TransactionStatus,
): void {
  if (!canTransition(transaction.status, to)) {
    throw new InvalidStateError(
      `Una transacción ${TRANSACTION_STATUS_LABELS[transaction.status].toLowerCase()} no puede pasar a ${TRANSACTION_STATUS_LABELS[to].toLowerCase()}.`,
    );
  }
}

async function setStatus(
  tx: Tx,
  ctx: RequestContext,
  transaction: Transaction,
  to: TransactionStatus,
  patch: { failureReason?: string } = {},
): Promise<Transaction> {
  const at = clock(ctx);
  const [updated] = await tx
    .update(transactions)
    .set({
      status: to,
      updatedAt: at,
      ...(to === "completed" ? { completedAt: at } : {}),
      ...(patch.failureReason ? { failureReason: patch.failureReason } : {}),
    })
    .where(eq(transactions.id, transaction.id))
    .returning();
  return updated;
}

function assertUsable(account: Account, role: "source" | "destination"): void {
  if (account.status === "active") return;
  const what = role === "source" ? "origen" : "destino";
  throw new AccountUnavailableError(
    `La cuenta de ${what} está ${ACCOUNT_STATUS_LABELS[account.status].toLowerCase()} y no se puede usar para este movimiento.`,
  );
}

// --- customer operations ---------------------------------------------------

/**
 * Creates a transfer from one of the caller's accounts.
 *
 * Routing:
 *   - to another account on the platform  → settles instantly (completed)
 *   - to an external beneficiary          → debited into transit (processing)
 *   - external and above the review limit → funds held, awaiting review (pending)
 */
export async function createTransfer(
  db: DbOrTx,
  ctx: RequestContext,
  input: CreateTransferInput,
): Promise<OperationResult> {
  const actorId = assertCustomer(ctx);
  assertIdempotencyKey(input.idempotencyKey);

  const description = input.description.trim();
  const requestHash = fingerprint({
    operation: "transfer",
    sourceAccountId: input.sourceAccountId,
    destination: input.destination,
    amountMinor: input.amountMinor.toString(),
    description,
  });

  return db.transaction(async (tx) => {
    const replay = await findReplay(tx, actorId, input.idempotencyKey, requestHash);
    if (replay) return { transaction: replay, replayed: true };

    assertValidAmount(input.amountMinor);
    if (description.length === 0 || description.length > 140) {
      throw new ValidationError("Agrega una descripción de hasta 140 caracteres.", {
        description: "Agrega una descripción de hasta 140 caracteres.",
      });
    }

    // Resolve the destination before taking locks, so every account involved
    // can be locked together in one ordered statement.
    let beneficiary: typeof beneficiaries.$inferSelect | null = null;
    let destinationAccountId: string | null = null;

    if (input.destination.kind === "account") {
      destinationAccountId = input.destination.accountId;
    } else {
      const [row] = await tx
        .select()
        .from(beneficiaries)
        .where(eq(beneficiaries.id, input.destination.beneficiaryId))
        .limit(1);
      if (!row || row.ownerId !== actorId || row.archivedAt) {
        throw new NotFoundError("el beneficiario");
      }
      beneficiary = row;
      destinationAccountId = row.internalAccountId;
    }

    if (destinationAccountId === input.sourceAccountId) {
      throw new ValidationError("Elige otra cuenta de destino.", {
        destination: "El origen y el destino deben ser cuentas distintas.",
      });
    }

    const locked = await lockAccounts(
      tx,
      [input.sourceAccountId, destinationAccountId].filter(
        (id): id is string => id !== null,
      ),
    );

    // An account the caller does not own is indistinguishable from one that
    // does not exist.
    const source = locked.get(input.sourceAccountId);
    if (!source || source.ownerId !== actorId) {
      throw new NotFoundError("la cuenta de origen");
    }
    assertUsable(source, "source");
    assertWithinLimit(input.amountMinor, source.currency);

    let destination: Account | null = null;
    if (destinationAccountId) {
      destination = locked.get(destinationAccountId) ?? null;
      const ownsDestination = destination?.ownerId === actorId;
      if (
        !destination ||
        destination.kind !== "customer" ||
        (input.destination.kind === "account" && !ownsDestination)
      ) {
        throw new NotFoundError("la cuenta de destino");
      }
      assertUsable(destination, "destination");
    }

    const destinationCurrency = destination?.currency ?? beneficiary?.currency;
    if (destinationCurrency !== source.currency) {
      throw new CurrencyMismatchError(
        `Este destino solo acepta ${destinationCurrency}. Elige una cuenta de origen en ${destinationCurrency}.`,
      );
    }

    const route: "instant" | "network" | "review" = destination
      ? "instant"
      : input.amountMinor >= TRANSFER_POLICY.reviewThresholdMinor
        ? "review"
        : "network";

    const status: TransactionStatus =
      route === "instant"
        ? "completed"
        : route === "network"
          ? "processing"
          : "pending";

    const { transaction, created } = await insertTransaction(tx, ctx, {
      idempotencyScope: actorId,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      initiatedBy: actorId,
      type: destination ? "transfer_internal" : "transfer_out",
      status,
      amountMinor: input.amountMinor,
      currency: source.currency,
      sourceAccountId: source.id,
      destinationAccountId: destination?.id ?? null,
      beneficiaryId: beneficiary?.id ?? null,
      counterpartyName: beneficiary?.name ?? null,
      description,
      category: input.category ?? (beneficiary ? "other" : "transfers"),
      completedAt: status === "completed" ? clock(ctx) : null,
      metadata: {
        route,
        ...(input.autoSettle && route !== "instant" ? { autoSettle: true } : {}),
      },
    });
    if (!created) return { transaction, replayed: true };

    const at = clock(ctx);
    if (route === "instant") {
      await postEntries(tx, {
        transactionId: transaction.id,
        currency: source.currency,
        at,
        legs: [
          { accountId: source.id, direction: "debit", amountMinor: input.amountMinor },
          { accountId: destination!.id, direction: "credit", amountMinor: input.amountMinor },
        ],
      });
      await addEvent(tx, ctx, transaction.id, null, "completed", "Liquidada al instante en el libro mayor de Aldera.");
    } else if (route === "network") {
      await postEntries(tx, {
        transactionId: transaction.id,
        currency: source.currency,
        at,
        legs: [
          { accountId: source.id, direction: "debit", amountMinor: input.amountMinor },
          {
            accountId: systemAccountId("transit", source.currency),
            direction: "credit",
            amountMinor: input.amountMinor,
            memo: "Fondos en tránsito hacia el banco receptor",
          },
        ],
      });
      await addEvent(tx, ctx, transaction.id, null, "processing", "Enviada a la red de pagos.");
    } else {
      await placeHold(tx, source.id, input.amountMinor);
      await addEvent(
        tx,
        ctx,
        transaction.id,
        null,
        "pending",
        `Retenida para revisión: alcanza o supera el límite de aprobación automática de ${formatMoney(TRANSFER_POLICY.reviewThresholdMinor, source.currency)}.`,
      );
    }

    if (beneficiary) {
      await tx
        .update(beneficiaries)
        .set({ lastUsedAt: at })
        .where(eq(beneficiaries.id, beneficiary.id));
    }

    const target = beneficiary?.name ?? destination?.name ?? "la cuenta de destino";
    await auditTransaction(
      tx,
      ctx,
      "transfer.created",
      transaction,
      `Transferencia de ${money(transaction)} a ${target} creada (${TRANSACTION_STATUS_LABELS[status].toLowerCase()}).`,
      {
        route,
        source: maskAccountNumber(source.number),
        destination: target,
      },
    );

    if (route === "review") {
      await notify(
        tx,
        ctx,
        actorId,
        "transaction",
        "Transferencia retenida para revisión",
        `Tu transferencia de ${money(transaction)} a ${target} está en revisión. Los fondos quedan retenidos hasta que se tome una decisión.`,
        `/transactions/${transaction.id}`,
      );
    }
    if (destination && destination.ownerId !== actorId) {
      await notify(
        tx,
        ctx,
        destination.ownerId,
        "transaction",
        "Pago recibido",
        `${ctx.actor.label} te envió ${money(transaction)}.`,
        `/transactions/${transaction.id}`,
      );
    }

    return { transaction, replayed: false };
  });
}

async function fund(
  db: DbOrTx,
  ctx: RequestContext,
  input: FundingInput,
  kind: "deposit" | "withdrawal",
): Promise<OperationResult> {
  const actorId = assertCustomer(ctx);
  assertIdempotencyKey(input.idempotencyKey);

  const description = input.description.trim() || (kind === "deposit" ? "Depósito" : "Retiro");
  const requestHash = fingerprint({
    operation: kind,
    accountId: input.accountId,
    amountMinor: input.amountMinor.toString(),
    description,
  });

  return db.transaction(async (tx) => {
    const replay = await findReplay(tx, actorId, input.idempotencyKey, requestHash);
    if (replay) return { transaction: replay, replayed: true };

    assertValidAmount(input.amountMinor);
    const account = (await lockAccounts(tx, [input.accountId])).get(input.accountId);
    if (!account || account.ownerId !== actorId) throw new NotFoundError("la cuenta");
    assertUsable(account, kind === "deposit" ? "destination" : "source");
    assertWithinLimit(input.amountMinor, account.currency);

    const at = clock(ctx);
    const { transaction, created } = await insertTransaction(tx, ctx, {
      idempotencyScope: actorId,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      initiatedBy: actorId,
      type: kind,
      status: "completed",
      amountMinor: input.amountMinor,
      currency: account.currency,
      sourceAccountId: kind === "withdrawal" ? account.id : null,
      destinationAccountId: kind === "deposit" ? account.id : null,
      counterpartyName: "Cuenta bancaria vinculada",
      description,
      category: "transfers",
      completedAt: at,
    });
    if (!created) return { transaction, replayed: true };

    const clearing = systemAccountId("clearing", account.currency);
    await postEntries(tx, {
      transactionId: transaction.id,
      currency: account.currency,
      at,
      legs:
        kind === "deposit"
          ? [
              { accountId: clearing, direction: "debit", amountMinor: input.amountMinor },
              { accountId: account.id, direction: "credit", amountMinor: input.amountMinor },
            ]
          : [
              { accountId: account.id, direction: "debit", amountMinor: input.amountMinor },
              { accountId: clearing, direction: "credit", amountMinor: input.amountMinor },
            ],
    });
    await addEvent(tx, ctx, transaction.id, null, "completed", "Registrada en el libro mayor.");
    await auditTransaction(
      tx,
      ctx,
      kind === "deposit" ? "deposit.created" : "withdrawal.created",
      transaction,
      `${kind === "deposit" ? "Depósito" : "Retiro"} de ${money(transaction)} en ${account.name}.`,
      { account: maskAccountNumber(account.number) },
    );

    return { transaction, replayed: false };
  });
}

/** Adds funds to one of the caller's accounts from a linked external account. */
export function deposit(db: DbOrTx, ctx: RequestContext, input: FundingInput) {
  return fund(db, ctx, input, "deposit");
}

/** Withdraws funds from one of the caller's accounts. */
export function withdraw(db: DbOrTx, ctx: RequestContext, input: FundingInput) {
  return fund(db, ctx, input, "withdrawal");
}

// --- operations team -------------------------------------------------------

/** Approves a transfer held for review: the hold becomes a posted debit. */
export async function approveTransfer(
  db: DbOrTx,
  ctx: RequestContext,
  transactionId: string,
  note?: string,
): Promise<Transaction> {
  assertStaff(ctx);
  return db.transaction(async (tx) => {
    const transaction = await lockTransaction(tx, transactionId);
    if (transaction.status !== "pending") {
      throw new InvalidStateError("Solo se pueden aprobar transferencias pendientes de revisión.");
    }

    const sourceId = transaction.sourceAccountId!;
    const source = (await lockAccounts(tx, [sourceId])).get(sourceId);
    if (!source) throw new NotFoundError("la cuenta de origen");
    assertUsable(source, "source");

    await releaseHold(tx, sourceId, transaction.amountMinor);
    await postEntries(tx, {
      transactionId: transaction.id,
      currency: transaction.currency,
      at: clock(ctx),
      legs: [
        { accountId: sourceId, direction: "debit", amountMinor: transaction.amountMinor },
        {
          accountId: systemAccountId("transit", transaction.currency),
          direction: "credit",
          amountMinor: transaction.amountMinor,
          memo: "Fondos en tránsito hacia el banco receptor",
        },
      ],
    });

    const updated = await setStatus(tx, ctx, transaction, "processing");
    await addEvent(
      tx,
      ctx,
      transaction.id,
      "pending",
      "processing",
      note?.trim() || "Aprobada por operaciones y enviada a la red de pagos.",
    );
    await auditTransaction(tx, ctx, "transfer.approved", updated, `Transferencia ${updated.reference} aprobada.`, {
      note: note ?? null,
    });
    await notify(
      tx,
      ctx,
      transaction.initiatedBy,
      "transaction",
      "Transferencia aprobada",
      `Tu transferencia de ${money(transaction)} a ${transaction.counterpartyName ?? "tu beneficiario"} fue aprobada y está en camino.`,
      `/transactions/${transaction.id}`,
    );
    return updated;
  });
}

/** Rejects a transfer held for review and releases the reserved funds. */
export async function rejectTransfer(
  db: DbOrTx,
  ctx: RequestContext,
  transactionId: string,
  reason: string,
): Promise<Transaction> {
  assertStaff(ctx);
  const failureReason = reason.trim() || "Rechazada durante la revisión.";
  return db.transaction(async (tx) => {
    const transaction = await lockTransaction(tx, transactionId);
    if (transaction.status !== "pending") {
      throw new InvalidStateError("Solo se pueden rechazar transferencias pendientes de revisión.");
    }

    await releaseHold(tx, transaction.sourceAccountId!, transaction.amountMinor);
    const updated = await setStatus(tx, ctx, transaction, "failed", { failureReason });
    await addEvent(tx, ctx, transaction.id, "pending", "failed", failureReason);
    await auditTransaction(tx, ctx, "transfer.rejected", updated, `Transferencia ${updated.reference} rechazada.`, {
      reason: failureReason,
    });
    await notify(
      tx,
      ctx,
      transaction.initiatedBy,
      "transaction",
      "Transferencia no aprobada",
      `Tu transferencia de ${money(transaction)} no fue aprobada y se liberaron los fondos retenidos. Motivo: ${failureReason}`,
      `/transactions/${transaction.id}`,
    );
    return updated;
  });
}

/** Marks an in-transit transfer as delivered to the receiving bank. */
export async function settleTransfer(
  db: DbOrTx,
  ctx: RequestContext,
  transactionId: string,
  note?: string,
): Promise<Transaction> {
  assertStaff(ctx);
  return db.transaction(async (tx) => {
    const transaction = await lockTransaction(tx, transactionId);
    if (transaction.status !== "processing") {
      throw new InvalidStateError("Solo se pueden liquidar transferencias en proceso.");
    }

    await postEntries(tx, {
      transactionId: transaction.id,
      currency: transaction.currency,
      at: clock(ctx),
      legs: [
        {
          accountId: systemAccountId("transit", transaction.currency),
          direction: "debit",
          amountMinor: transaction.amountMinor,
        },
        {
          accountId: systemAccountId("clearing", transaction.currency),
          direction: "credit",
          amountMinor: transaction.amountMinor,
          memo: "Liquidada con el banco receptor",
        },
      ],
    });

    const updated = await setStatus(tx, ctx, transaction, "completed");
    await addEvent(
      tx,
      ctx,
      transaction.id,
      "processing",
      "completed",
      note?.trim() || "Liquidación confirmada por el banco receptor.",
    );
    await auditTransaction(tx, ctx, "transfer.settled", updated, `Transferencia ${updated.reference} liquidada.`);
    return updated;
  });
}

/** Fails an in-transit transfer and returns the funds to the sender. */
export async function failTransfer(
  db: DbOrTx,
  ctx: RequestContext,
  transactionId: string,
  reason: string,
): Promise<Transaction> {
  assertStaff(ctx);
  const failureReason = reason.trim() || "Devuelta por el banco receptor.";
  return db.transaction(async (tx) => {
    const transaction = await lockTransaction(tx, transactionId);
    if (transaction.status !== "processing") {
      throw new InvalidStateError("Solo se pueden marcar como fallidas las transferencias en proceso.");
    }

    await postEntries(tx, {
      transactionId: transaction.id,
      currency: transaction.currency,
      at: clock(ctx),
      legs: [
        {
          accountId: systemAccountId("transit", transaction.currency),
          direction: "debit",
          amountMinor: transaction.amountMinor,
        },
        {
          accountId: transaction.sourceAccountId!,
          direction: "credit",
          amountMinor: transaction.amountMinor,
          memo: "Fondos devueltos al remitente",
        },
      ],
    });

    const updated = await setStatus(tx, ctx, transaction, "failed", { failureReason });
    await addEvent(tx, ctx, transaction.id, "processing", "failed", failureReason);
    await auditTransaction(tx, ctx, "transfer.failed", updated, `Transferencia ${updated.reference} fallida; fondos devueltos.`, {
      reason: failureReason,
    });
    await notify(
      tx,
      ctx,
      transaction.initiatedBy,
      "transaction",
      "Transferencia devuelta",
      `Tu transferencia de ${money(transaction)} no pudo entregarse y los fondos ya están de vuelta en tu cuenta. Motivo: ${failureReason}`,
      `/transactions/${transaction.id}`,
    );
    return updated;
  });
}

/**
 * Reverses a completed transaction.
 *
 * History is never edited. A new `reversal` transaction posts the exact
 * inverse of the original's net effect on each account, and the original is
 * marked `reversed` and linked to it.
 */
export async function reverseTransaction(
  db: DbOrTx,
  ctx: RequestContext,
  transactionId: string,
  reason: string,
): Promise<{ original: Transaction; reversal: Transaction }> {
  assertAdmin(ctx);
  const note = reason.trim();
  if (note.length < 3) {
    throw new ValidationError("Se requiere un motivo para revertir una transacción.", {
      reason: "Ingresa un motivo.",
    });
  }

  return db.transaction(async (tx) => {
    const original = await lockTransaction(tx, transactionId);
    if (original.type === "reversal") {
      throw new InvalidStateError("Una reversión no se puede revertir.");
    }
    assertTransition(original, "reversed");

    const entries = await tx
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.transactionId, original.id));

    const net = new Map<string, bigint>();
    for (const entry of entries) {
      const signed = entry.direction === "credit" ? entry.amountMinor : -entry.amountMinor;
      net.set(entry.accountId, (net.get(entry.accountId) ?? 0n) + signed);
    }
    const legs: Leg[] = [...net]
      .filter(([, amount]) => amount !== 0n)
      .map(([accountId, amount]) => ({
        accountId,
        direction: amount > 0n ? ("debit" as const) : ("credit" as const),
        amountMinor: amount > 0n ? amount : -amount,
        memo: `Reversión de ${original.reference}`,
      }));

    const at = clock(ctx);
    const { transaction: reversal, created } = await insertTransaction(tx, ctx, {
      idempotencyScope: "system",
      idempotencyKey: `reversal:${original.id}`,
      requestHash: fingerprint({ operation: "reversal", of: original.id }),
      initiatedBy: ctx.actor.id,
      type: "reversal",
      status: "completed",
      amountMinor: original.amountMinor,
      currency: original.currency,
      sourceAccountId: original.destinationAccountId,
      destinationAccountId: original.sourceAccountId,
      counterpartyName: original.counterpartyName,
      description: `Reversión de ${original.reference} · ${original.description}`,
      category: original.category,
      reversalOf: original.id,
      completedAt: at,
      metadata: { reason: note },
    });
    if (!created) {
      throw new InvalidStateError("Esta transacción ya fue revertida.");
    }

    await postEntries(tx, {
      transactionId: reversal.id,
      currency: original.currency,
      at,
      legs,
    });
    await addEvent(tx, ctx, reversal.id, null, "completed", `Revierte ${original.reference}. ${note}`);

    const updated = await setStatus(tx, ctx, original, "reversed");
    await addEvent(tx, ctx, original.id, "completed", "reversed", `Revertida mediante ${reversal.reference}. ${note}`);

    await auditTransaction(tx, ctx, "transaction.reversed", updated, `Transacción ${original.reference} revertida mediante ${reversal.reference}.`, {
      reason: note,
      reversalId: reversal.id,
      reversalReference: reversal.reference,
    });

    const affected = new Set(
      [
        await ownerOf(tx, original.sourceAccountId),
        await ownerOf(tx, original.destinationAccountId),
      ].filter((id): id is string => id !== null),
    );
    for (const userId of affected) {
      await notify(
        tx,
        ctx,
        userId,
        "transaction",
        "Transacción revertida",
        `Se revirtió la transacción “${original.description}” (${money(original)}). Motivo: ${note}`,
        `/transactions/${original.id}`,
      );
    }

    return { original: updated, reversal };
  });
}

// --- platform-originated activity ------------------------------------------

/**
 * Records activity that originates outside a customer request: card
 * settlements, incoming payments, fees and interest. Restricted to the
 * platform itself.
 */
export async function recordExternalActivity(
  db: DbOrTx,
  ctx: RequestContext,
  input: ExternalActivityInput,
): Promise<OperationResult> {
  assertSystem(ctx);
  assertValidAmount(input.amountMinor);

  const requestHash = fingerprint({
    operation: input.type,
    accountId: input.accountId,
    amountMinor: input.amountMinor.toString(),
    counterpartyName: input.counterpartyName,
    description: input.description,
  });

  return db.transaction(async (tx) => {
    const replay = await findReplay(tx, "system", input.idempotencyKey, requestHash);
    if (replay) return { transaction: replay, replayed: true };

    const account = (await lockAccounts(tx, [input.accountId])).get(input.accountId);
    if (!account || account.kind !== "customer") throw new NotFoundError("la cuenta");

    const incoming = input.type === "transfer_in" || input.type === "interest";
    const counterAccount = systemAccountId(
      input.type === "fee" ? "fees" : input.type === "interest" ? "interest" : "clearing",
      account.currency,
    );

    const at = clock(ctx);
    const { transaction, created } = await insertTransaction(tx, ctx, {
      idempotencyScope: "system",
      idempotencyKey: input.idempotencyKey,
      requestHash,
      initiatedBy: null,
      type: input.type,
      status: "completed",
      amountMinor: input.amountMinor,
      currency: account.currency,
      sourceAccountId: incoming ? null : account.id,
      destinationAccountId: incoming ? account.id : null,
      counterpartyName: input.counterpartyName,
      description: input.description,
      category: input.category,
      completedAt: at,
    });
    if (!created) return { transaction, replayed: true };

    await postEntries(tx, {
      transactionId: transaction.id,
      currency: account.currency,
      at,
      legs: incoming
        ? [
            { accountId: counterAccount, direction: "debit", amountMinor: input.amountMinor },
            { accountId: account.id, direction: "credit", amountMinor: input.amountMinor },
          ]
        : [
            { accountId: account.id, direction: "debit", amountMinor: input.amountMinor },
            { accountId: counterAccount, direction: "credit", amountMinor: input.amountMinor },
          ],
    });
    await addEvent(tx, ctx, transaction.id, null, "completed", "Registrada en el libro mayor.");

    if (input.type === "transfer_in") {
      await notify(
        tx,
        ctx,
        account.ownerId,
        "transaction",
        "Pago recibido",
        `Recibiste ${money(transaction)} de ${input.counterpartyName} en ${account.name}.`,
        `/transactions/${transaction.id}`,
      );
    }

    return { transaction, replayed: false };
  });
}
