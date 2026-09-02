/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

// Snapshot dates are stored as plain calendar strings ("2026-07-27") with no time or zone.
// Everything here formats them as calendar dates, never as instants, so a viewer in Phoenix
// and the server in UTC print the same day. Parsing a date-only string with `new Date()` and
// formatting it with a zone-less `toLocaleDateString` is exactly the off-by-one this replaces.

const ISO_DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

const toDateFromUnknown = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

/** Resolves any stored date shape to a "YYYY-MM-DD" calendar string, or null. */
export function toSnapshotIsoDate(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (ISO_DATE_ONLY_PATTERN.test(trimmed)) return trimmed;
  }
  const parsed = toDateFromUnknown(value);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

/** "2026-07-27" -> "Jul 27, 2026", independent of the host or browser timezone. */
export function formatSnapshotDisplayDate(value: unknown): string | null {
  if (!value) return null;
  const isoDate = toSnapshotIsoDate(value);
  if (isoDate) {
    const [, year, month, day] = isoDate.match(ISO_DATE_ONLY_PATTERN) ?? [];
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return null;
}

/** Same resolution as the display label, as "YYYY-MM-DD" for filenames and titles. */
export function formatSnapshotIsoDate(value: unknown): string | null {
  return toSnapshotIsoDate(value);
}

/** "2026-08" -> "Aug 2026". Non-month input is returned unchanged so callers can still render it. */
export function formatSnapshotMonthLabel(monthIso: string | null | undefined): string | null {
  if (!monthIso) return null;
  const trimmed = monthIso.trim();
  const match = trimmed.match(ISO_MONTH_PATTERN);
  if (!match) return trimmed || null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  if (Number.isNaN(date.getTime())) return trimmed;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
