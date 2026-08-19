// Reference-time resolution for the clustering experiment. Resolved exactly once per run
// (Section 45) and threaded explicitly into extraction/window calculations/manifest — never
// re-derived from `NOW()` at each query.
const REFERENCE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MS_PER_DAY = 86_400_000;
const DAYS_365_MS = 365 * MS_PER_DAY;

export function resolveReferenceTime(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') {
    return new Date().toISOString();
  }
  const trimmed = raw.trim();
  if (!REFERENCE_TIME_PATTERN.test(trimmed)) {
    throw new Error('CLUSTERING_REFERENCE_TIME must be an explicit UTC ISO timestamp, e.g. 2026-08-19T00:00:00.000Z');
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('CLUSTERING_REFERENCE_TIME is not a valid timestamp');
  }
  return parsed.toISOString();
}

// [windowStartInclusive, referenceTime) — same inclusive-start/exclusive-end convention as
// RFM's date-window.ts (Section 47: document inclusivity explicitly rather than assume it).
export function windowStart365dInclusive(referenceTimeIso: string): string {
  const referenceMs = new Date(referenceTimeIso).getTime();
  return new Date(referenceMs - DAYS_365_MS).toISOString();
}

export function toMysqlDateTime(iso: string): string {
  return iso.slice(0, 19).replace('T', ' ');
}

export function daysBetween(earlierIso: string, laterIso: string): number {
  const earlierMs = new Date(earlierIso).getTime();
  const laterMs = new Date(laterIso).getTime();
  if (Number.isNaN(earlierMs) || Number.isNaN(laterMs)) {
    throw new Error('Invalid date passed to daysBetween');
  }
  if (laterMs < earlierMs) {
    throw new Error('daysBetween: later date precedes earlier date');
  }
  return (laterMs - earlierMs) / MS_PER_DAY;
}

export function floorDaysBetween(earlierIso: string, laterIso: string): number {
  return Math.floor(daysBetween(earlierIso, laterIso));
}
