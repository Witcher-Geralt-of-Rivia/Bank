/**
 * Date and text formatting. The locale and time zone are fixed so that the
 * server render and the client hydration always produce identical strings.
 */

const LOCALE = "en-US";
const TIME_ZONE = "UTC";

const dateFmt = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: TIME_ZONE,
});

const shortDateFmt = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  timeZone: TIME_ZONE,
});

const timeFmt = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: TIME_ZONE,
});

const monthFmt = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  timeZone: TIME_ZONE,
});

const monthYearFmt = new Intl.DateTimeFormat(LOCALE, {
  month: "long",
  year: "numeric",
  timeZone: TIME_ZONE,
});

const weekdayFmt = new Intl.DateTimeFormat(LOCALE, {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: TIME_ZONE,
});

export function formatDate(date: Date): string {
  return dateFmt.format(date);
}

export function formatShortDate(date: Date): string {
  return shortDateFmt.format(date);
}

export function formatTime(date: Date): string {
  return `${timeFmt.format(date)} UTC`;
}

export function formatDateTime(date: Date): string {
  return `${dateFmt.format(date)}, ${timeFmt.format(date)} UTC`;
}

export function formatMonth(date: Date): string {
  return monthFmt.format(date);
}

export function formatMonthYear(date: Date): string {
  return monthYearFmt.format(date);
}

export function formatLongDate(date: Date): string {
  return weekdayFmt.format(date);
}

/** "2026-10-08" in UTC, used for date inputs and day bucketing. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "12 min ago", "3 h ago", "Yesterday", then a calendar date. */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const diff = now.getTime() - date.getTime();
  if (diff < MINUTE) return "Just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  if (diff < 2 * DAY) return "Yesterday";
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} days ago`;
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
  return new Intl.NumberFormat(LOCALE).format(value);
}

export function pluralize(count: number, singular: string, plural?: string) {
  return `${formatCount(count)} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}
