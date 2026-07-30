// CP-R1-T10A extension (section 9): shifts an already-validated asOfDate back by N
// calendar days in UTC, so the same deterministic window/scoring pipeline can be re-run at
// asOfDate, -30, -60 and -90 days for real temporal-stability measurement.
import { parseAsOfDate } from './dates.js';

const MS_PER_DAY = 86_400_000;

export function shiftAsOfDateByDays(asOfDate: string, daysBack: number): string {
  const parsed = parseAsOfDate({ RFM_AS_OF_DATE: asOfDate });
  if (!parsed.ok) {
    throw new Error(`Invalid asOfDate to shift: ${parsed.reason}`);
  }
  const shifted = new Date(parsed.date.getTime() - daysBack * MS_PER_DAY);
  return shifted.toISOString().slice(0, 10);
}
