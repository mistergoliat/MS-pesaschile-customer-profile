export type RfmWindow = {
  readonly asOfDate: string;
  readonly timezone: 'UTC';
  readonly windowStartInclusive: string;
  readonly windowEndExclusive: string;
};

export type AsOfDateResolution =
  | { readonly ok: true; readonly asOfDate: string; readonly date: Date }
  | { readonly ok: false; readonly reason: 'missing' | 'invalid_format' | 'invalid_date' };

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export function parseAsOfDate(env: Readonly<Record<string, string | undefined>>): AsOfDateResolution {
  const raw = env.RFM_AS_OF_DATE;
  if (raw === undefined || raw.trim() === '') {
    return { ok: false, reason: 'missing' };
  }
  if (!ISO_DATE_PATTERN.test(raw)) {
    return { ok: false, reason: 'invalid_format' };
  }

  const [year, month, day] = raw.split('-').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return { ok: false, reason: 'invalid_date' };
  }
  return { ok: true, asOfDate: raw, date: parsed };
}

export function buildRfmWindow(asOfDate: string): RfmWindow {
  const parsed = parseAsOfDate({ RFM_AS_OF_DATE: asOfDate });
  if (!parsed.ok) {
    throw new Error(`Invalid RFM_AS_OF_DATE: ${parsed.reason}`);
  }
  const start = subtractTwelveMonths(parsed.date);
  const end = new Date(parsed.date.getTime() + MS_PER_DAY);
  return {
    asOfDate,
    timezone: 'UTC',
    windowStartInclusive: formatUtcDate(start),
    windowEndExclusive: formatUtcDate(end),
  };
}

export function recencyDays(asOfDate: string, lastValidOrderAtInWindow: string): number {
  const asOf = parseAsOfDate({ RFM_AS_OF_DATE: asOfDate });
  if (!asOf.ok) {
    throw new Error(`Invalid asOfDate: ${asOf.reason}`);
  }
  const lastOrder = parseDateTimeUtc(lastValidOrderAtInWindow);
  const endOfAsOfDay = new Date(asOf.date.getTime() + MS_PER_DAY);
  const diff = endOfAsOfDay.getTime() - startOfUtcDay(lastOrder).getTime() - MS_PER_DAY;
  if (diff < 0) {
    throw new Error('lastValidOrderAtInWindow cannot be after asOfDate');
  }
  return Math.floor(diff / MS_PER_DAY);
}

function subtractTwelveMonths(date: Date): Date {
  const targetYear = date.getUTCFullYear() - 1;
  const targetMonth = date.getUTCMonth();
  const targetDay = Math.min(date.getUTCDate(), daysInUtcMonth(targetYear, targetMonth));
  return new Date(Date.UTC(targetYear, targetMonth, targetDay));
}

function daysInUtcMonth(year: number, monthZeroBased: number): number {
  return new Date(Date.UTC(year, monthZeroBased + 1, 0)).getUTCDate();
}

function parseDateTimeUtc(value: string): Date {
  const parsed = new Date(`${value.replace(' ', 'T').replace(/Z$/, '')}Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid UTC datetime');
  }
  return parsed;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
