/**
 * Domain errors. Each carries a stable machine-readable code and a message
 * that is safe to show to the person who triggered it. Anything that is not a
 * `DomainError` is treated as an unexpected failure and never leaves the
 * server in detail.
 */

export type ErrorCode =
  | "validation_failed"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "insufficient_funds"
  | "account_unavailable"
  | "currency_mismatch"
  | "limit_exceeded"
  | "idempotency_conflict"
  | "invalid_state"
  | "rate_limited"
  | "conflict"
  | "internal_error";

export type FieldErrors = Record<string, string>;

export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status = 400,
    public readonly fieldErrors?: FieldErrors,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, fieldErrors?: FieldErrors) {
    super("validation_failed", message, 422, fieldErrors);
    this.name = "ValidationError";
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = "Inicia sesión para continuar.") {
    super("unauthenticated", message, 401);
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "No tienes permiso para realizar esta acción.") {
    super("forbidden", message, 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends DomainError {
  constructor(what = "el recurso") {
    super("not_found", `No se encontró ${what}.`, 404);
    this.name = "NotFoundError";
  }
}

export class InsufficientFundsError extends DomainError {
  constructor(
    message = "El saldo disponible no alcanza para cubrir este monto.",
  ) {
    super("insufficient_funds", message, 422, { amount: message });
    this.name = "InsufficientFundsError";
  }
}

export class AccountUnavailableError extends DomainError {
  constructor(message: string) {
    super("account_unavailable", message, 422);
    this.name = "AccountUnavailableError";
  }
}

export class CurrencyMismatchError extends DomainError {
  constructor(
    message = "El origen y el destino deben estar en la misma moneda.",
  ) {
    super("currency_mismatch", message, 422);
    this.name = "CurrencyMismatchError";
  }
}

export class LimitExceededError extends DomainError {
  constructor(message: string) {
    super("limit_exceeded", message, 422, { amount: message });
    this.name = "LimitExceededError";
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor() {
    super(
      "idempotency_conflict",
      "Esta clave de idempotencia ya se usó para una solicitud distinta.",
      409,
    );
    this.name = "IdempotencyConflictError";
  }
}

export class InvalidStateError extends DomainError {
  constructor(message: string) {
    super("invalid_state", message, 409);
    this.name = "InvalidStateError";
  }
}

export class RateLimitedError extends DomainError {
  constructor(public readonly retryAfterSeconds: number) {
    super(
      "rate_limited",
      `Demasiados intentos. Intenta de nuevo en ${retryAfterSeconds} ${retryAfterSeconds === 1 ? "segundo" : "segundos"}.`,
      429,
    );
    this.name = "RateLimitedError";
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, fieldErrors?: FieldErrors) {
    super("conflict", message, 409, fieldErrors);
    this.name = "ConflictError";
  }
}

/** Serializable result returned by every Server Action. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: ErrorCode; message: string; fieldErrors?: FieldErrors };
    };

export function ok(): ActionResult<undefined>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

/**
 * Converts a thrown value into a client-safe result. Unexpected errors are
 * logged with a correlation id and replaced by a generic message so stack
 * traces, SQL and internal identifiers never reach the browser.
 */
export function toActionError(error: unknown): ActionResult<never> {
  if (error instanceof DomainError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        fieldErrors: error.fieldErrors,
      },
    };
  }
  const correlationId = Math.random().toString(36).slice(2, 10);
  console.error(`[aldera] unexpected error (${correlationId})`, error);
  return {
    ok: false,
    error: {
      code: "internal_error",
      message: `Algo salió mal de nuestro lado. Intenta de nuevo. (ref. ${correlationId})`,
    },
  };
}
