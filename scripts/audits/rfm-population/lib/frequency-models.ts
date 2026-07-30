// CP-R1-T10A extension (section 6): three candidate discrete F-score models, simulated
// against the same active population without ever using NTILE. Model C reuses the
// existing tie-safe rank-by-distinct-value method (./distribution.ts scoreTieSafe) that R
// and M already use; Models A and B are fixed threshold rules to compare against it.
import { addAuditDecimals, divideAuditDecimal, percentage } from './decimal.js';
import { describeNumericDistribution, scoreTieSafe } from './distribution.js';

export type FrequencyScore = 1 | 2 | 3 | 4 | 5;

export type FrequencyModelRow = {
  readonly frequencyOrders: number;
  readonly grossMonetaryTaxIncl: string;
  readonly recencyDays: number;
};

export type FrequencyModelGroupRow = {
  readonly score: FrequencyScore;
  readonly customerCount: number;
  readonly percentOfActivePopulation: string;
  readonly grossMonetaryTaxIncl: string;
  readonly percentOfActiveSpend: string;
  readonly averageRecencyDays: string | null;
  readonly medianRecencyDays: number | null;
  readonly averageFrequencyOrders: string | null;
};

export const FREQUENCY_MODEL_DEFINITIONS = {
  A: { F1: '1', F2: '2', F3: '3', F4: '4-5', F5: '6+' },
  B: { F1: '1', F2: '2', F3: '3-4', F4: '5-9', F5: '10+' },
  C: {
    F1: 'tie-safe rank over distinct observed frequency values (bottom rank)',
    F5: 'tie-safe rank over distinct observed frequency values (top rank)',
    note: 'quantile-derived from distinct values, never NTILE over rows',
  },
  // CP-R1-T10A-3 (section 9): Model D, a slightly wider top bucket than Model A.
  D: { F1: '1', F2: '2', F3: '3', F4: '4-6', F5: '7+' },
  // Model E reuses the same tie-safe rank mechanism as Model C (via modelCClassifier
  // below) — the only difference is which population it is computed over: Model C ranks
  // CP-R1-T10A-2's pooled all-shops active population, Model E ranks CP-R1-T10A-3's
  // shop-1 commercial population (P1). No separate classifier function is needed; callers
  // pass P1 rows into modelCClassifier and label the result "E".
  E: {
    F1: 'tie-safe rank over distinct observed frequency values in the shop-1 commercial population (bottom rank)',
    F5: 'tie-safe rank over distinct observed frequency values in the shop-1 commercial population (top rank)',
    note: 'same method as Model C, computed over the final commercial population instead of the pooled all-shops population',
  },
} as const;

export function classifyFrequencyModelA(frequencyOrders: number): FrequencyScore {
  if (frequencyOrders <= 1) return 1;
  if (frequencyOrders === 2) return 2;
  if (frequencyOrders === 3) return 3;
  if (frequencyOrders <= 5) return 4;
  return 5;
}

export function classifyFrequencyModelB(frequencyOrders: number): FrequencyScore {
  if (frequencyOrders <= 1) return 1;
  if (frequencyOrders === 2) return 2;
  if (frequencyOrders <= 4) return 3;
  if (frequencyOrders <= 9) return 4;
  return 5;
}

export function classifyFrequencyModelD(frequencyOrders: number): FrequencyScore {
  if (frequencyOrders <= 1) return 1;
  if (frequencyOrders === 2) return 2;
  if (frequencyOrders === 3) return 3;
  if (frequencyOrders <= 6) return 4;
  return 5;
}

export function modelCClassifier(rows: readonly FrequencyModelRow[]): (frequencyOrders: number) => FrequencyScore {
  const scores = scoreTieSafe(rows.map((row) => row.frequencyOrders), 'higher_value_better');
  return (frequencyOrders: number) => {
    const score = scores.get(frequencyOrders);
    if (!score) throw new Error(`Missing Model C score for frequency ${frequencyOrders}`);
    return score;
  };
}

export function buildFrequencyModelGroups(
  rows: readonly FrequencyModelRow[],
  classify: (frequencyOrders: number) => FrequencyScore,
): readonly FrequencyModelGroupRow[] {
  const totalCount = rows.length;
  const totalSpend = rows.length === 0 ? '0.000000' : addAuditDecimals(rows.map((row) => row.grossMonetaryTaxIncl));
  const groups = new Map<FrequencyScore, FrequencyModelRow[]>([
    [1, []],
    [2, []],
    [3, []],
    [4, []],
    [5, []],
  ]);
  for (const row of rows) {
    groups.get(classify(row.frequencyOrders))!.push(row);
  }
  return Array.from(groups.entries()).map(([score, groupRows]) => {
    const spend = groupRows.length === 0 ? '0.000000' : addAuditDecimals(groupRows.map((row) => row.grossMonetaryTaxIncl));
    const recencyDist = describeNumericDistribution(groupRows.map((row) => row.recencyDays));
    const frequencyDist = describeNumericDistribution(groupRows.map((row) => row.frequencyOrders));
    return {
      score,
      customerCount: groupRows.length,
      percentOfActivePopulation: percentage(groupRows.length, totalCount),
      grossMonetaryTaxIncl: spend,
      percentOfActiveSpend: divideAuditDecimal(spend, totalSpend),
      averageRecencyDays: recencyDist.average,
      medianRecencyDays: recencyDist.median,
      averageFrequencyOrders: frequencyDist.average,
    };
  });
}
