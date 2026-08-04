export type RfmSnapshotWindow = {
  readonly referenceTime: string;
  readonly windowStartInclusive: string;
  readonly windowEndExclusive: string;
};

const MS_PER_DAY = 86_400_000;
const REFERENCE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function parseReferenceTime(raw: string | undefined): Date {
  if (raw === undefined || raw.trim() === '') {
    throw new Error('RFM_REFERENCE_TIME is required');
  }
  if (!REFERENCE_TIME_PATTERN.test(raw)) {
    throw new Error('RFM_REFERENCE_TIME must be an explicit UTC ISO timestamp');
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalizeReferenceTime(raw)) {
    throw new Error('RFM_REFERENCE_TIME is not a valid UTC timestamp');
  }
  return parsed;
}

export function buildRfmSnapshotWindow(referenceTimeRaw: string): RfmSnapshotWindow {
  const referenceTime = parseReferenceTime(referenceTimeRaw);
  const windowStart = new Date(referenceTime.getTime() - 365 * MS_PER_DAY);
  return {
    referenceTime: referenceTime.toISOString(),
    windowStartInclusive: windowStart.toISOString(),
    windowEndExclusive: referenceTime.toISOString(),
  };
}

export function recencyCalendarDays(referenceTimeIso: string, lastValidOrderAt: string): number {
  const referenceTime = parseReferenceTime(referenceTimeIso);
  const lastOrderTime = parseMysqlDateTimeUtc(lastValidOrderAt);
  if (lastOrderTime.getTime() >= referenceTime.getTime()) {
    throw new Error('last valid order must be before referenceTime');
  }
  const referenceDay = startOfUtcDay(referenceTime);
  const lastOrderDay = startOfUtcDay(lastOrderTime);
  const recency = Math.floor((referenceDay.getTime() - lastOrderDay.getTime()) / MS_PER_DAY);
  if (recency < 0) {
    throw new Error('recencyDays cannot be negative');
  }
  return recency;
}

export function toMysqlDateTime(iso: string): string {
  return parseReferenceTime(iso).toISOString().slice(0, 19).replace('T', ' ');
}

export function parseMysqlDateTimeUtc(value: string): Date {
  const parsed = new Date(`${value.replace(' ', 'T').replace(/Z$/, '')}Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid UTC datetime: ${value}`);
  }
  return parsed;
}

function normalizeReferenceTime(raw: string): string {
  return raw.includes('.') ? raw : raw.replace('Z', '.000Z');
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
