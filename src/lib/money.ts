/**
 * Money primitives.
 *
 * Every monetary value in the system is an integer count of the currency's
 * minor unit (cents) held in a `bigint`. Nothing in this module — or anywhere
 * in the ledger — performs floating-point arithmetic on money. Decimal strings
 * are parsed and produced by digit manipulation only.
 */

export type CurrencyCode = "USD" | "EUR";

export type CurrencyInfo = {
  code: CurrencyCode;
  name: string;
  symbol: string;
  /** Number of decimal places in the minor unit. */
  exponent: number;
};

export const CURRENCIES: Record<CurrencyCode, CurrencyInfo> = {
  USD: { code: "USD", name: "US Dollar", symbol: "$", exponent: 2 },
  EUR: { code: "EUR", name: "Euro", symbol: "€", exponent: 2 },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

/** Currency used to express cross-currency totals. */
export const BASE_CURRENCY: CurrencyCode = "USD";

export function isCurrency(value: unknown): value is CurrencyCode {
  return typeof value === "string" && value in CURRENCIES;
}

export class MoneyError extends Error {
  constructor(
    public readonly reason:
      | "empty"
      | "malformed"
      | "too_many_decimals"
      | "negative"
      | "too_large",
    message: string,
  ) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Largest amount accepted from user input: 999,999,999,999.99 */
const MAX_INPUT_MINOR = 99_999_999_999_999n;

const AMOUNT_PATTERN = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d*))?$/;

/**
 * Parses a human-entered decimal amount ("1,250.50", "1250.5", "12") into
 * minor units. Rejects anything that cannot be represented exactly rather than
 * rounding it: "10.999" is an error for a two-decimal currency.
 */
export function parseAmount(input: string, currency: CurrencyCode): bigint {
  const { exponent, symbol } = CURRENCIES[currency];
  const raw = input.trim().replace(symbol, "").trim();

  if (raw === "") throw new MoneyError("empty", "Enter an amount.");
  if (raw.startsWith("-")) {
    throw new MoneyError("negative", "Amount must be greater than zero.");
  }

  const match = AMOUNT_PATTERN.exec(raw);
  if (!match) throw new MoneyError("malformed", "Enter a valid amount.");

  const fraction = match[1] ?? "";
  if (fraction.length > exponent) {
    throw new MoneyError(
      "too_many_decimals",
      `${currency} amounts can have at most ${exponent} decimal places.`,
    );
  }

  const whole = raw.split(".")[0].replaceAll(",", "");
  const minor = BigInt(whole + fraction.padEnd(exponent, "0"));

  if (minor > MAX_INPUT_MINOR) {
    throw new MoneyError("too_large", "Amount is too large.");
  }
  return minor;
}

/** Exact decimal string for a minor-unit amount, e.g. 125050n → "1250.50". */
export function toDecimalString(minor: bigint, currency: CurrencyCode): string {
  const { exponent } = CURRENCIES[currency];
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString();

  if (exponent === 0) return (negative ? "-" : "") + digits;

  const padded = digits.padStart(exponent + 1, "0");
  const whole = padded.slice(0, -exponent);
  const fraction = padded.slice(-exponent);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export type FormatMoneyOptions = {
  /** "always" prefixes positive values with "+". */
  sign?: "auto" | "always" | "never";
  /** Render the ISO code instead of the symbol ("USD 1,250.50"). */
  code?: boolean;
};

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: CurrencyCode, code: boolean): Intl.NumberFormat {
  const key = `${currency}:${code}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: code ? "code" : "narrowSymbol",
    });
    formatters.set(key, fmt);
  }
  return fmt;
}

/**
 * Formats minor units for display. The value reaches `Intl.NumberFormat` as an
 * exact decimal string, so no precision is lost on the way to the screen. The
 * locale is fixed so server and client always render identical text.
 */
export function formatMoney(
  minor: bigint,
  currency: CurrencyCode,
  options: FormatMoneyOptions = {},
): string {
  const { sign = "auto", code = false } = options;
  const absolute = minor < 0n ? -minor : minor;
  const text = formatter(currency, code).format(
    toDecimalString(absolute, currency) as Intl.StringNumericLiteral,
  );

  if (sign === "never" || minor === 0n) return text;
  if (minor < 0n) return `−${text}`;
  return sign === "always" ? `+${text}` : text;
}

/** Adds minor-unit amounts. */
export function sumMinor(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}

/**
 * Computes `amount × numerator ÷ denominator`, rounding half away from zero.
 * Used for indicative currency conversion and proportional calculations.
 */
export function mulDiv(
  amount: bigint,
  numerator: bigint,
  denominator: bigint,
): bigint {
  if (denominator <= 0n) throw new RangeError("denominator must be positive");
  const product = amount * numerator;
  const negative = product < 0n;
  const absolute = negative ? -product : product;
  const rounded = (absolute * 2n + denominator) / (denominator * 2n);
  return negative ? -rounded : rounded;
}

/**
 * Indicative rates used only to express a multi-currency total in the base
 * currency. Rates are integers scaled by `RATE_SCALE`; no transfer is ever
 * converted with them.
 */
export const RATE_SCALE = 1_000_000n;
export const INDICATIVE_RATES_TO_BASE: Record<CurrencyCode, bigint> = {
  USD: 1_000_000n,
  EUR: 1_084_500n,
};

/** "1.0845" — the indicative rate as an exact decimal string. */
export function formatIndicativeRate(currency: CurrencyCode): string {
  const rate = INDICATIVE_RATES_TO_BASE[currency];
  const fraction = (rate % RATE_SCALE).toString().padStart(6, "0").slice(0, 4);
  return `${rate / RATE_SCALE}.${fraction}`;
}

export function toBaseCurrency(minor: bigint, currency: CurrencyCode): bigint {
  return mulDiv(minor, INDICATIVE_RATES_TO_BASE[currency], RATE_SCALE);
}

/**
 * Change from `previous` to `current` in basis points (1% = 100 bps), or null
 * when there is no baseline to compare against.
 */
export function changeInBasisPoints(
  current: bigint,
  previous: bigint,
): bigint | null {
  if (previous === 0n) return null;
  const base = previous < 0n ? -previous : previous;
  return mulDiv(current - previous, 10_000n, base);
}

/**
 * Lossy conversion to a JS number of major units. For chart geometry and
 * compact axis labels only — never for arithmetic that feeds the ledger.
 */
export function toApproximateNumber(
  minor: bigint,
  currency: CurrencyCode,
): number {
  return Number(minor) / 10 ** CURRENCIES[currency].exponent;
}

const compactFormatters = new Map<CurrencyCode, Intl.NumberFormat>();

/** Compact label such as "$84.3K" for axis ticks and dense summaries. */
export function formatMoneyCompact(
  minor: bigint,
  currency: CurrencyCode,
): string {
  let fmt = compactFormatters.get(currency);
  if (!fmt) {
    fmt = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      notation: "compact",
      maximumFractionDigits: 1,
    });
    compactFormatters.set(currency, fmt);
  }
  return fmt.format(toApproximateNumber(minor, currency));
}
