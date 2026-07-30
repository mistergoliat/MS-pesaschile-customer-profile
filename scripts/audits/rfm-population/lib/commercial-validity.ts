// CP-R1-T10A extension (section 8): per-score-group commercial aggregates, shared shape
// for R, F (any of the three candidate models) and M so the same table structure can be
// compared side by side. Money stays in audit-decimal strings end to end — see
// ./decimal.ts and ./distribution.ts percentileDecimal for why (no float parsing).
import { addAuditDecimals, compareAuditDecimalAsc, divideAuditDecimal, formatAuditDecimal, percentage } from './decimal.js';
import { describeNumericDistribution, percentileDecimal } from './distribution.js';

export type CommercialScore = 1 | 2 | 3 | 4 | 5;

export type CommercialRow = {
  readonly frequencyOrders: number;
  readonly grossMonetaryTaxIncl: string;
  readonly recencyDays: number;
};

export type CommercialGroupRow = {
  readonly score: CommercialScore;
  readonly customerCount: number;
  readonly percentOfActivePopulation: string;
  readonly grossMonetaryTaxInclTotal: string;
  readonly percentOfActiveSpend: string;
  readonly averageGrossMonetaryTaxIncl: string;
  readonly medianGrossMonetaryTaxIncl: string | null;
  readonly averageFrequencyOrders: string | null;
  readonly averageRecencyDays: string | null;
};

export function buildCommercialGroupTable(
  rows: readonly CommercialRow[],
  scoreOf: (row: CommercialRow) => CommercialScore,
): readonly CommercialGroupRow[] {
  const totalCount = rows.length;
  const totalSpend = rows.length === 0 ? '0.000000' : addAuditDecimals(rows.map((row) => row.grossMonetaryTaxIncl));
  const groups = new Map<CommercialScore, CommercialRow[]>([
    [1, []],
    [2, []],
    [3, []],
    [4, []],
    [5, []],
  ]);
  for (const row of rows) {
    groups.get(scoreOf(row))!.push(row);
  }
  return Array.from(groups.entries()).map(([score, groupRows]) => {
    const spend = groupRows.length === 0 ? '0.000000' : addAuditDecimals(groupRows.map((row) => row.grossMonetaryTaxIncl));
    const sortedSpend = [...groupRows.map((row) => row.grossMonetaryTaxIncl)].sort(compareAuditDecimalAsc);
    const frequencyDist = describeNumericDistribution(groupRows.map((row) => row.frequencyOrders));
    const recencyDist = describeNumericDistribution(groupRows.map((row) => row.recencyDays));
    return {
      score,
      customerCount: groupRows.length,
      percentOfActivePopulation: percentage(groupRows.length, totalCount),
      grossMonetaryTaxInclTotal: spend,
      percentOfActiveSpend: divideAuditDecimal(spend, totalSpend),
      averageGrossMonetaryTaxIncl: groupRows.length === 0 ? '0.000000' : divideAuditDecimal(spend, String(groupRows.length)),
      medianGrossMonetaryTaxIncl: percentileDecimal(sortedSpend, 0.5),
      averageFrequencyOrders: frequencyDist.average,
      averageRecencyDays: recencyDist.average,
    };
  });
}

export type DistinguishabilityCheck = {
  readonly fromScore: CommercialScore;
  readonly toScore: CommercialScore;
  readonly averageSpendRatio: string;
  readonly distinguishable: boolean;
};

// Data-driven signal only — not a commercial label. "Distinguishable" here means the
// higher score's average spend is at least 20% above the lower score's; it flags where a
// candidate cut is (or is not) separating economically different groups, it does not
// assert those groups are ready to be named segments.
export function evaluateDistinguishability(groups: readonly CommercialGroupRow[]): readonly DistinguishabilityCheck[] {
  const sorted = [...groups].sort((a, b) => a.score - b.score);
  const checks: DistinguishabilityCheck[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const lower = sorted[i]!;
    const higher = sorted[i + 1]!;
    if (lower.customerCount === 0 || higher.customerCount === 0) {
      checks.push({ fromScore: lower.score, toScore: higher.score, averageSpendRatio: 'n/a_empty_group', distinguishable: false });
      continue;
    }
    const ratio = divideAuditDecimal(higher.averageGrossMonetaryTaxIncl, lower.averageGrossMonetaryTaxIncl);
    checks.push({
      fromScore: lower.score,
      toScore: higher.score,
      averageSpendRatio: ratio,
      distinguishable: compareAuditDecimalAsc(ratio, formatAuditDecimal('1.2')) >= 0,
    });
  }
  return checks;
}
