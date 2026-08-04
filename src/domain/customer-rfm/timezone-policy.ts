import { buildRfmSnapshotWindow, parseReferenceTime } from './date-window.js';

export type DriftWindowVariantName = 'current_utc' | 'end_inclusive' | 'end_plus_one_utc_day' | 'chile_calendar_dates';

export type DriftWindowVariant = {
  readonly name: DriftWindowVariantName;
  readonly windowStartInclusive: string;
  readonly windowEndExclusive: string;
  readonly endComparison: '<' | '<=';
};

export function buildDriftWindowVariants(referenceTimeRaw: string): readonly DriftWindowVariant[] {
  const current = buildRfmSnapshotWindow(referenceTimeRaw);
  return [
    {
      name: 'current_utc',
      windowStartInclusive: current.windowStartInclusive,
      windowEndExclusive: current.windowEndExclusive,
      endComparison: '<',
    },
    {
      name: 'end_inclusive',
      windowStartInclusive: current.windowStartInclusive,
      windowEndExclusive: current.windowEndExclusive,
      endComparison: '<=',
    },
    {
      name: 'end_plus_one_utc_day',
      windowStartInclusive: current.windowStartInclusive,
      windowEndExclusive: addUtcDays(current.windowEndExclusive, 1),
      endComparison: '<',
    },
    buildChileCalendarDateVariant(referenceTimeRaw),
  ];
}

export function buildChileCalendarDateVariant(referenceTimeRaw: string): DriftWindowVariant {
  const referenceTime = parseReferenceTime(referenceTimeRaw);
  const referenceParts = zonedParts(referenceTime, 'America/Santiago');
  const endLocalMidnightUtc = zonedDateTimeToUtcIso(
    referenceParts.year,
    referenceParts.month,
    referenceParts.day + 1,
    0,
    0,
    0,
    'America/Santiago',
  );
  const startLocalMidnightUtc = zonedDateTimeToUtcIso(
    referenceParts.year,
    referenceParts.month,
    referenceParts.day - 364,
    0,
    0,
    0,
    'America/Santiago',
  );
  return {
    name: 'chile_calendar_dates',
    windowStartInclusive: startLocalMidnightUtc,
    windowEndExclusive: endLocalMidnightUtc,
    endComparison: '<',
  };
}

export function zonedDateTimeToUtcIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): string {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const parts = zonedParts(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    guess -= actualAsUtc - targetAsUtc;
  }
  return new Date(guess).toISOString();
}

export function addUtcDays(iso: string, days: number): string {
  const date = parseReferenceTime(iso);
  return new Date(date.getTime() + days * 86_400_000).toISOString();
}

function zonedParts(date: Date, timeZone: string): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string) => {
    const part = parts.find((entry) => entry.type === type)?.value;
    if (!part) throw new Error(`Missing ${type} for ${timeZone}`);
    return Number(part);
  };
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}
