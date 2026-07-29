import type { CurrencyDetectionResult, CurrencyRow } from './types.js';

// CP-R1-T07A section 5/11: CustomerCommercialSummary exposes money as `string`, never
// `number` — the same reasoning already applied to CustomerOrderRecord.totalPaidTaxIncl
// (see src/domain/customer-profile/customer-order-record.ts). SUM()/AVG() aggregates
// coming back from mysql2 for a DECIMAL column are strings when `decimalNumbers` is left
// unset (as this script's connection does) — this function formats that string via pure
// string manipulation, never parseFloat/toFixed on a float, so a large sum never drifts.
// A JS number input is accepted defensively (e.g. a driver returning an aggregate as a
// number in some configurations) and formatted with toFixed, which is precision-safe only
// up to Number.MAX_SAFE_INTEGER — documented, not hidden.
export function formatDecimalString(value: string | number | null, decimals = 6): string {
  if (value === null) return `0.${'0'.repeat(decimals)}`;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid monetary value: ${String(value)}`);
    }
    return value.toFixed(decimals);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) return `0.${'0'.repeat(decimals)}`;

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [wholePartRaw = '', fractionalPartRaw = ''] = unsigned.split('.');
  const wholePart = wholePartRaw.replace(/[^0-9]/g, '') || '0';
  const fractionalDigits = fractionalPartRaw.replace(/[^0-9]/g, '');
  const paddedFraction = `${fractionalDigits}${'0'.repeat(decimals)}`.slice(0, decimals);

  const isZero = wholePart.replace(/^0+/, '') === '' && paddedFraction.replace(/0/g, '') === '';
  const sign = negative && !isZero ? '-' : '';
  return `${sign}${wholePart}.${paddedFraction}`;
}

// CP-R1-T07A section 5, questions 8-10: given order counts grouped by id_currency (never
// individual orders), determines whether the dataset is effectively single-currency —
// the precondition for exposing a flat `currencyIsoCode: string | null` in the proposed
// contract instead of a per-order currency breakdown. Does not convert currency (out of
// scope for this audit) — only detects whether more than one is present at all.
export function detectCurrencyMix(rows: readonly CurrencyRow[]): CurrencyDetectionResult {
  if (rows.length === 0) {
    return { isSingleCurrency: true, dominantCurrencyId: null, dominantIsoCode: null, currencies: [] };
  }

  const sorted = [...rows].sort((a, b) => b.orderCount - a.orderCount);
  const dominant = sorted[0]!;

  return {
    isSingleCurrency: rows.length === 1,
    dominantCurrencyId: dominant.idCurrency,
    dominantIsoCode: dominant.isoCode,
    currencies: sorted,
  };
}
