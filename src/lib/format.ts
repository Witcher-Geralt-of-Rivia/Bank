/**
 * Date and text formatting. The locale and time zone are fixed so that the
 * server render and the client hydration always produce identical strings.
 */

const LOCALE = "es-MX";
/** Counts keep the same digit grouping as money ("1,250"). */
const NUMBER_LOCALE = "en-US";
const TIME_ZONE = "UTC";

const timeFmt = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: TIME_ZONE,
});

const monthNameFmt = new Intl.DateTimeFormat(LOCALE, {
  month: "long",
  timeZone: TIME_ZONE,
});

const weekdayNameFmt = new Intl.DateTimeFormat(LOCALE, {
  weekday: "long",
  timeZone: TIME_ZONE,
});

/*
 * Dates are assembled from the full month and weekday names rather than taken
 * from the locale's own patterns. Abbreviations and connecting words differ
 * between JavaScript engines ("sep", "sept."), which would let the server and
 * the browser disagree; the full names do not.
 */

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "octubre" */
function monthName(date: Date): string {
  return monthNameFmt.format(date);
}

/** "oct" */
function shortMonthName(date: Date): string {
  return monthName(date).slice(0, 3);
}

/** "9 oct 2026" */
export function formatDate(date: Date): string {
  return `${formatShortDate(date)} ${date.getUTCFullYear()}`;
}

/** "9 oct" */
export function formatShortDate(date: Date): string {
  return `${date.getUTCDate()} ${shortMonthName(date)}`;
}

export function formatTime(date: Date): string {
  return `${timeFmt.format(date)} UTC`;
}

export function formatDateTime(date: Date): string {
  return `${formatDate(date)}, ${timeFmt.format(date)} UTC`;
}

/** "Oct" */
export function formatMonth(date: Date): string {
  return capitalize(shortMonthName(date));
}

/** "Octubre de 2026" */
export function formatMonthYear(date: Date): string {
  return `${capitalize(monthName(date))} de ${date.getUTCFullYear()}`;
}

/** "Viernes, 9 de octubre" */
export function formatLongDate(date: Date): string {
  return `${capitalize(weekdayNameFmt.format(date))}, ${date.getUTCDate()} de ${monthName(date)}`;
}

/** "2026-10-08" in UTC, used for date inputs and day bucketing. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "Hace un momento", "Hace 12 min", "Hace 3 h", "Ayer", "Hace 3 días", then a calendar date. */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const diff = now.getTime() - date.getTime();
  if (diff < MINUTE) return "Hace un momento";
  if (diff < HOUR) return `Hace ${Math.floor(diff / MINUTE)} min`;
  if (diff < DAY) return `Hace ${Math.floor(diff / HOUR)} h`;
  if (diff < 2 * DAY) return "Ayer";
  if (diff < 7 * DAY) return `Hace ${Math.floor(diff / DAY)} días`;
  return formatDate(date);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Signed percentage from basis points: 1234n → "+12.3%". */
export function formatBasisPoints(bps: bigint): string {
  const negative = bps < 0n;
  const absolute = negative ? -bps : bps;
  const whole = absolute / 100n;
  const tenth = (absolute % 100n) / 10n;
  return `${negative ? "−" : "+"}${whole}.${tenth}%`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat(NUMBER_LOCALE).format(value);
}

export function pluralize(count: number, singular: string, plural?: string) {
  return `${formatCount(count)} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

/** "Chrome en Windows" from a raw User-Agent header. */
export function describeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) return "Dispositivo desconocido";
  const browser = userAgent.includes("Edg/")
    ? "Edge"
    : userAgent.includes("Firefox/")
      ? "Firefox"
      : userAgent.includes("Chrome/")
        ? "Chrome"
        : userAgent.includes("Safari/")
          ? "Safari"
          : "Navegador";
  const system = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Windows/.test(userAgent)
        ? "Windows"
        : /Mac OS X/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "un dispositivo desconocido";
  return `${browser} en ${system}`;
}
