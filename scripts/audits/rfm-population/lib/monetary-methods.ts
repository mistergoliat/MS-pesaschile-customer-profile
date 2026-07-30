// CP-R1-T10A-3 (section 10): M-Dynamic (reuses distribution.ts scoreTieSafeDecimal,
// unchanged) vs M-Frozen (fixed monetary boundaries calibrated once, compared with
// decimal.ts's compareAuditDecimalAsc — never parsed through float). Boundaries are
// grossMonetaryTaxIncl audit-decimal strings in ascending order; higher spend is better.
import { compareAuditDecimalAsc } from './decimal.js';
import { percentileDecimal } from './distribution.js';

export type FrozenMonetaryBoundaries = readonly [p20: string, p40: string, p60: string, p80: string];

// sortedAscendingGrossMonetaryTaxIncl must already be sorted with compareAuditDecimalAsc.
export function calibrateFrozenMonetaryBoundaries(sortedAscendingGrossMonetaryTaxIncl: readonly string[]): FrozenMonetaryBoundaries {
  const zero = '0.000000';
  return [
    percentileDecimal(sortedAscendingGrossMonetaryTaxIncl, 0.2) ?? zero,
    percentileDecimal(sortedAscendingGrossMonetaryTaxIncl, 0.4) ?? zero,
    percentileDecimal(sortedAscendingGrossMonetaryTaxIncl, 0.6) ?? zero,
    percentileDecimal(sortedAscendingGrossMonetaryTaxIncl, 0.8) ?? zero,
  ];
}

export function classifyByFrozenMonetaryBoundaries(grossMonetaryTaxIncl: string, boundaries: FrozenMonetaryBoundaries): 1 | 2 | 3 | 4 | 5 {
  const [p20, p40, p60, p80] = boundaries;
  if (compareAuditDecimalAsc(grossMonetaryTaxIncl, p80) >= 0) return 5;
  if (compareAuditDecimalAsc(grossMonetaryTaxIncl, p60) >= 0) return 4;
  if (compareAuditDecimalAsc(grossMonetaryTaxIncl, p40) >= 0) return 3;
  if (compareAuditDecimalAsc(grossMonetaryTaxIncl, p20) >= 0) return 2;
  return 1;
}
