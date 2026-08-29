// Generic, domain-neutral decimal-string arithmetic (BigInt-backed, 6-decimal scale, round-half-up).
// Extracted in CUSTOMER-INTELLIGENCE-R2-A01.2.1 from customer-rfm/decimal.ts: Customer Commercial
// Affinity needed the same decimal-safe summation (never floating-point currency addition) but had
// no reason to depend on the RFM domain merely for arithmetic (task Section 14/15). customer-rfm's
// own formatRfmDecimal/addRfmDecimals/divideRfmDecimal/compareRfmDecimalAsc now delegate here
// unchanged — see customer-rfm/decimal.ts for the thin RFM-named wrappers.
//
// Behavior, precision, and rounding are byte-for-byte identical to the pre-extraction
// implementation: only the location moved, not the algorithm.

const SCALE = 6;

type DecimalParts = {
  readonly units: bigint;
  readonly scale: number;
};

export function formatDecimal(value: string | number): string {
  return formatScaledInteger(decimalToScaled(parseNonNegativeDecimal(String(value))), SCALE);
}

export function addDecimals(values: readonly string[]): string {
  return formatScaledInteger(
    values.reduce((total, value) => total + decimalToScaled(parseNonNegativeDecimal(value)), 0n),
    SCALE,
  );
}

export function divideDecimal(numerator: string, denominator: number): string {
  if (!Number.isSafeInteger(denominator) || denominator < 0) {
    throw new Error('Invalid decimal denominator');
  }
  if (denominator === 0) {
    return '0.000000';
  }
  const numeratorScaled = decimalToScaled(parseNonNegativeDecimal(numerator));
  return formatScaledInteger(divideAndRoundHalfUp(numeratorScaled, BigInt(denominator)), SCALE);
}

export function compareDecimalAsc(a: string, b: string): number {
  const left = decimalToScaled(parseNonNegativeDecimal(a));
  const right = decimalToScaled(parseNonNegativeDecimal(b));
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function parseNonNegativeDecimal(value: string): DecimalParts {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid non-negative decimal: ${value}`);
  }
  const [whole, fractional = ''] = trimmed.split('.');
  return { units: BigInt(`${whole}${fractional}`), scale: fractional.length };
}

function decimalToScaled(decimal: DecimalParts): bigint {
  if (decimal.scale === SCALE) return decimal.units;
  if (decimal.scale < SCALE) {
    return decimal.units * 10n ** BigInt(SCALE - decimal.scale);
  }
  return divideAndRoundHalfUp(decimal.units, 10n ** BigInt(decimal.scale - SCALE));
}

function divideAndRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function formatScaledInteger(value: bigint, scale: number): string {
  const raw = value.toString().padStart(scale + 1, '0');
  return `${raw.slice(0, -scale)}.${raw.slice(-scale)}`;
}
