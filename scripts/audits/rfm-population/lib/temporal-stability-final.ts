// CP-R1-T10A-3 (section 12): richer temporal-stability measurement than CP-R1-T10A-2's
// lib/temporal-stability.ts (kept untouched — that file's exports remain exactly as T10A-2
// left them). This module tracks raw metrics alongside R/F/M scores under two parallel
// scoring streams (Dynamic: re-ranked every run; Frozen: fixed boundaries calibrated once
// — see recency-methods.ts / monetary-methods.ts) so the same customer pair can be
// compared not just "did the score change" but "why": a real new order, pure calendar time
// passing, or the surrounding population shifting under them.
import { divideAuditDecimal, percentage } from './decimal.js';
import { scoreTieSafe, scoreTieSafeDecimal } from './distribution.js';
import { classifyByFrozenMonetaryBoundaries, type FrozenMonetaryBoundaries } from './monetary-methods.js';
import { classifyByFrozenRecencyBoundaries, type FrozenRecencyBoundaries } from './recency-methods.js';

export type Score = 1 | 2 | 3 | 4 | 5;

export type FinalSnapshotRow = {
  readonly prestashopCustomerId: number;
  readonly frequencyOrders: number;
  readonly grossMonetaryTaxIncl: string;
  readonly recencyDays: number;
};

export type FinalCustomerSnapshot = {
  readonly frequencyOrders: number;
  readonly grossMonetaryTaxIncl: string;
  readonly recencyDays: number;
  readonly rDynamic: Score;
  readonly rFrozen: Score;
  readonly f: Score;
  readonly mDynamic: Score;
  readonly mFrozen: Score;
};

export function buildFinalSnapshot(
  rows: readonly FinalSnapshotRow[],
  classifyF: (frequencyOrders: number) => Score,
  frozenRecencyBoundaries: FrozenRecencyBoundaries,
  frozenMonetaryBoundaries: FrozenMonetaryBoundaries,
): Map<number, FinalCustomerSnapshot> {
  const rDynamicScores = scoreTieSafe(
    rows.map((row) => row.recencyDays),
    'lower_value_better',
  );
  const mDynamicScores = scoreTieSafeDecimal(
    rows.map((row) => row.grossMonetaryTaxIncl),
    'higher_value_better',
  );
  const snapshot = new Map<number, FinalCustomerSnapshot>();
  for (const row of rows) {
    const rDynamic = rDynamicScores.get(row.recencyDays);
    const mDynamic = mDynamicScores.get(row.grossMonetaryTaxIncl);
    if (!rDynamic || !mDynamic) throw new Error('Missing tie-safe score while building final temporal snapshot');
    snapshot.set(row.prestashopCustomerId, {
      frequencyOrders: row.frequencyOrders,
      grossMonetaryTaxIncl: row.grossMonetaryTaxIncl,
      recencyDays: row.recencyDays,
      rDynamic,
      rFrozen: classifyByFrozenRecencyBoundaries(row.recencyDays, frozenRecencyBoundaries),
      f: classifyF(row.frequencyOrders),
      mDynamic,
      mFrozen: classifyByFrozenMonetaryBoundaries(row.grossMonetaryTaxIncl, frozenMonetaryBoundaries),
    });
  }
  return snapshot;
}

export type DimensionStats = {
  readonly comparedCustomers: number;
  readonly identicalCount: number;
  readonly identicalPercent: string;
  readonly withinOneCount: number;
  readonly withinOnePercent: string;
  readonly overOneCount: number;
  readonly overOnePercent: string;
  readonly averageAbsoluteChange: string;
  readonly transitionMatrix: readonly (readonly number[])[];
};

function computeDimensionStats(fromScores: readonly Score[], toScores: readonly Score[]): DimensionStats {
  const total = fromScores.length;
  const matrix: number[][] = Array.from({ length: 5 }, () => new Array(5).fill(0) as number[]);
  let identical = 0;
  let withinOne = 0;
  let overOne = 0;
  let absSum = 0;
  for (let i = 0; i < total; i += 1) {
    const from = fromScores[i]!;
    const to = toScores[i]!;
    matrix[from - 1]![to - 1] = matrix[from - 1]![to - 1]! + 1;
    const delta = Math.abs(from - to);
    absSum += delta;
    if (delta === 0) identical += 1;
    else if (delta === 1) withinOne += 1;
    else overOne += 1;
  }
  return {
    comparedCustomers: total,
    identicalCount: identical,
    identicalPercent: percentage(identical, total),
    withinOneCount: withinOne,
    withinOnePercent: percentage(withinOne, total),
    overOneCount: overOne,
    overOnePercent: percentage(overOne, total),
    averageAbsoluteChange: total === 0 ? '0.000000' : divideAuditDecimal(String(absSum), String(total)),
    transitionMatrix: matrix,
  };
}

export type CodeStreamStats = {
  readonly comparedCustomers: number;
  readonly identicalCodeCount: number;
  readonly identicalCodePercent: string;
  readonly manhattanDistanceHistogram: Record<string, number>;
  readonly dimensionsChangedHistogram: { readonly zero: number; readonly one: number; readonly two: number; readonly three: number };
  readonly r: DimensionStats;
  readonly f: DimensionStats;
  readonly m: DimensionStats;
};

export type FinalMigrationStats = {
  readonly comparedCustomers: number;
  readonly onlyInBaseline: number;
  readonly onlyInComparison: number;
  readonly dynamic: CodeStreamStats;
  readonly frozen: CodeStreamStats;
  readonly changeAttribution: ChangeAttribution;
};

export function compareFinalSnapshots(
  baseline: ReadonlyMap<number, FinalCustomerSnapshot>,
  comparison: ReadonlyMap<number, FinalCustomerSnapshot>,
): FinalMigrationStats {
  const baselineIds = new Set(baseline.keys());
  const comparisonIds = new Set(comparison.keys());
  const commonIds = Array.from(baselineIds).filter((id) => comparisonIds.has(id));

  const rFromDyn: Score[] = [];
  const rToDyn: Score[] = [];
  const rFromFrz: Score[] = [];
  const rToFrz: Score[] = [];
  const fFrom: Score[] = [];
  const fTo: Score[] = [];
  const mFromDyn: Score[] = [];
  const mToDyn: Score[] = [];
  const mFromFrz: Score[] = [];
  const mToFrz: Score[] = [];

  for (const id of commonIds) {
    const before = baseline.get(id)!;
    const after = comparison.get(id)!;
    rFromDyn.push(before.rDynamic);
    rToDyn.push(after.rDynamic);
    rFromFrz.push(before.rFrozen);
    rToFrz.push(after.rFrozen);
    fFrom.push(before.f);
    fTo.push(after.f);
    mFromDyn.push(before.mDynamic);
    mToDyn.push(after.mDynamic);
    mFromFrz.push(before.mFrozen);
    mToFrz.push(after.mFrozen);
  }

  const dynamic = buildCodeStreamStats(rFromDyn, rToDyn, fFrom, fTo, mFromDyn, mToDyn);
  const frozen = buildCodeStreamStats(rFromFrz, rToFrz, fFrom, fTo, mFromFrz, mToFrz);

  return {
    comparedCustomers: commonIds.length,
    onlyInBaseline: Array.from(baselineIds).filter((id) => !comparisonIds.has(id)).length,
    onlyInComparison: Array.from(comparisonIds).filter((id) => !baselineIds.has(id)).length,
    dynamic,
    frozen,
    changeAttribution: computeChangeAttribution(baseline, comparison, commonIds),
  };
}

function buildCodeStreamStats(
  rFrom: readonly Score[],
  rTo: readonly Score[],
  fFrom: readonly Score[],
  fTo: readonly Score[],
  mFrom: readonly Score[],
  mTo: readonly Score[],
): CodeStreamStats {
  const total = rFrom.length;
  const r = computeDimensionStats(rFrom, rTo);
  const f = computeDimensionStats(fFrom, fTo);
  const m = computeDimensionStats(mFrom, mTo);

  const manhattanHistogram: Record<string, number> = {};
  const dimensionsChanged = { zero: 0, one: 0, two: 0, three: 0 };
  let identicalCode = 0;
  for (let i = 0; i < total; i += 1) {
    const dr = Math.abs(rFrom[i]! - rTo[i]!);
    const df = Math.abs(fFrom[i]! - fTo[i]!);
    const dm = Math.abs(mFrom[i]! - mTo[i]!);
    const manhattan = dr + df + dm;
    manhattanHistogram[String(manhattan)] = (manhattanHistogram[String(manhattan)] ?? 0) + 1;
    if (manhattan === 0) identicalCode += 1;
    const changedDims = (dr > 0 ? 1 : 0) + (df > 0 ? 1 : 0) + (dm > 0 ? 1 : 0);
    if (changedDims === 0) dimensionsChanged.zero += 1;
    else if (changedDims === 1) dimensionsChanged.one += 1;
    else if (changedDims === 2) dimensionsChanged.two += 1;
    else dimensionsChanged.three += 1;
  }

  return {
    comparedCustomers: total,
    identicalCodeCount: identicalCode,
    identicalCodePercent: percentage(identicalCode, total),
    manhattanDistanceHistogram: manhattanHistogram,
    dimensionsChangedHistogram: dimensionsChanged,
    r,
    f,
    m,
  };
}

export type ChangeAttribution = {
  readonly noChangeAtAll: number;
  readonly explainedByWindowActivityChange: number;
  readonly explainedByTimePassingOnly: number;
  readonly explainedByPopulationChangeOnly: number;
  readonly noChangeAtAllPercent: string;
  readonly explainedByWindowActivityChangePercent: string;
  readonly explainedByTimePassingOnlyPercent: string;
  readonly explainedByPopulationChangeOnlyPercent: string;
};

// Attribution logic, per customer present in both snapshots:
//   1. raw metrics (frequencyOrders, grossMonetaryTaxIncl) differ -> their window order set
//      actually changed (a new order landed, or an old one aged out of the rolling window):
//      "window activity change". Dominates over any score movement.
//   2. raw metrics identical, but the Frozen-boundary score differs -> nothing about the
//      customer's own orders changed, only the calendar date did (recencyDays increased),
//      and that alone crossed a fixed cut point: "time passing only".
//   3. raw metrics identical, Frozen score identical, but the Dynamic score differs -> the
//      only thing that could have moved a rank-based score with no boundary crossed is the
//      population around this customer: "population change only".
//   4. everything identical: "no change at all".
function computeChangeAttribution(
  baseline: ReadonlyMap<number, FinalCustomerSnapshot>,
  comparison: ReadonlyMap<number, FinalCustomerSnapshot>,
  commonIds: readonly number[],
): ChangeAttribution {
  let noChange = 0;
  let windowActivity = 0;
  let timePassing = 0;
  let populationChange = 0;

  for (const id of commonIds) {
    const before = baseline.get(id)!;
    const after = comparison.get(id)!;
    const rawChanged = before.frequencyOrders !== after.frequencyOrders || before.grossMonetaryTaxIncl !== after.grossMonetaryTaxIncl;
    if (rawChanged) {
      windowActivity += 1;
      continue;
    }
    const frozenChanged = before.rFrozen !== after.rFrozen || before.mFrozen !== after.mFrozen;
    if (frozenChanged) {
      timePassing += 1;
      continue;
    }
    const dynamicChanged = before.rDynamic !== after.rDynamic || before.mDynamic !== after.mDynamic;
    if (dynamicChanged) {
      populationChange += 1;
      continue;
    }
    noChange += 1;
  }

  const total = commonIds.length;
  return {
    noChangeAtAll: noChange,
    explainedByWindowActivityChange: windowActivity,
    explainedByTimePassingOnly: timePassing,
    explainedByPopulationChangeOnly: populationChange,
    noChangeAtAllPercent: percentage(noChange, total),
    explainedByWindowActivityChangePercent: percentage(windowActivity, total),
    explainedByTimePassingOnlyPercent: percentage(timePassing, total),
    explainedByPopulationChangeOnlyPercent: percentage(populationChange, total),
  };
}
