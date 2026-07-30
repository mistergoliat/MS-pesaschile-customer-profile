// CP-R1-T10A extension (section 9): real temporal-stability measurement. Builds an R/F/M
// score snapshot per customer at a given asOfDate, then compares two snapshots to report
// migration percentages. Every output here is an aggregate count/percentage — the
// per-customer maps used to compute it never leave this module.
import { percentage } from './decimal.js';
import { scoreTieSafe, scoreTieSafeDecimal } from './distribution.js';

export type TemporalSnapshotRow = {
  readonly prestashopCustomerId: number;
  readonly frequencyOrders: number;
  readonly grossMonetaryTaxIncl: string;
  readonly recencyDays: number;
};

export type CustomerScoreSnapshot = {
  readonly r: 1 | 2 | 3 | 4 | 5;
  readonly f: 1 | 2 | 3 | 4 | 5;
  readonly m: 1 | 2 | 3 | 4 | 5;
  readonly code: string;
};

export function buildScoreSnapshot(
  rows: readonly TemporalSnapshotRow[],
  classifyF: (frequencyOrders: number) => 1 | 2 | 3 | 4 | 5,
): Map<number, CustomerScoreSnapshot> {
  const rScores = scoreTieSafe(
    rows.map((row) => row.recencyDays),
    'lower_value_better',
  );
  const mScores = scoreTieSafeDecimal(
    rows.map((row) => row.grossMonetaryTaxIncl),
    'higher_value_better',
  );
  const snapshot = new Map<number, CustomerScoreSnapshot>();
  for (const row of rows) {
    const r = rScores.get(row.recencyDays);
    const m = mScores.get(row.grossMonetaryTaxIncl);
    if (!r || !m) throw new Error('Missing tie-safe score while building temporal snapshot');
    const f = classifyF(row.frequencyOrders);
    snapshot.set(row.prestashopCustomerId, { r, f, m, code: `${r}${f}${m}` });
  }
  return snapshot;
}

export type MigrationStats = {
  readonly comparedCustomers: number;
  readonly onlyInBaseline: number;
  readonly onlyInComparison: number;
  readonly identicalCode: number;
  readonly identicalCodePercent: string;
  readonly rWithinOne: number;
  readonly fWithinOne: number;
  readonly mWithinOne: number;
  readonly rWithinOnePercent: string;
  readonly fWithinOnePercent: string;
  readonly mWithinOnePercent: string;
  readonly extremeChangeCount: number;
  readonly extremeChangePercent: string;
};

// "Extreme" change: any single dimension (R, F or M) moves by 3 or more score points
// between the two snapshots being compared.
const EXTREME_CHANGE_THRESHOLD = 3;

export function compareScoreSnapshots(
  baseline: ReadonlyMap<number, CustomerScoreSnapshot>,
  comparison: ReadonlyMap<number, CustomerScoreSnapshot>,
): MigrationStats {
  const baselineIds = new Set(baseline.keys());
  const comparisonIds = new Set(comparison.keys());
  const commonIds = Array.from(baselineIds).filter((id) => comparisonIds.has(id));

  let identicalCode = 0;
  let rWithinOne = 0;
  let fWithinOne = 0;
  let mWithinOne = 0;
  let extremeChangeCount = 0;

  for (const id of commonIds) {
    const before = baseline.get(id)!;
    const after = comparison.get(id)!;
    if (before.code === after.code) identicalCode += 1;
    const dr = Math.abs(before.r - after.r);
    const df = Math.abs(before.f - after.f);
    const dm = Math.abs(before.m - after.m);
    if (dr <= 1) rWithinOne += 1;
    if (df <= 1) fWithinOne += 1;
    if (dm <= 1) mWithinOne += 1;
    if (dr >= EXTREME_CHANGE_THRESHOLD || df >= EXTREME_CHANGE_THRESHOLD || dm >= EXTREME_CHANGE_THRESHOLD) {
      extremeChangeCount += 1;
    }
  }

  const total = commonIds.length;
  return {
    comparedCustomers: total,
    onlyInBaseline: Array.from(baselineIds).filter((id) => !comparisonIds.has(id)).length,
    onlyInComparison: Array.from(comparisonIds).filter((id) => !baselineIds.has(id)).length,
    identicalCode,
    identicalCodePercent: percentage(identicalCode, total),
    rWithinOne,
    fWithinOne,
    mWithinOne,
    rWithinOnePercent: percentage(rWithinOne, total),
    fWithinOnePercent: percentage(fWithinOne, total),
    mWithinOnePercent: percentage(mWithinOne, total),
    extremeChangeCount,
    extremeChangePercent: percentage(extremeChangeCount, total),
  };
}
