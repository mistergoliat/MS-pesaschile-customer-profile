// CP-R1-T10A-3 (section 8): R-Dynamic (re-rank the active population every run — reuses
// distribution.ts scoreTieSafe, unchanged from CP-R1-T10A/2) vs R-Frozen (apply boundary
// values calibrated once, as fixed cut points, so scores don't move purely because the
// population around a customer changed). Boundaries are recencyDays values in ascending
// order — lower recencyDays is better, so a value at/under the lowest boundary earns the
// top score.
export type FrozenRecencyBoundaries = readonly [p20: number, p40: number, p60: number, p80: number];

export function calibrateFrozenRecencyBoundaries(distribution: {
  readonly p20: number | null;
  readonly p40: number | null;
  readonly p60: number | null;
  readonly p80: number | null;
}): FrozenRecencyBoundaries {
  return [distribution.p20 ?? 0, distribution.p40 ?? 0, distribution.p60 ?? 0, distribution.p80 ?? 0];
}

export function classifyByFrozenRecencyBoundaries(recencyDays: number, boundaries: FrozenRecencyBoundaries): 1 | 2 | 3 | 4 | 5 {
  const [p20, p40, p60, p80] = boundaries;
  if (recencyDays <= p20) return 5;
  if (recencyDays <= p40) return 4;
  if (recencyDays <= p60) return 3;
  if (recencyDays <= p80) return 2;
  return 1;
}
