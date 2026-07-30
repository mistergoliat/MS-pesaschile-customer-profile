const SCALE = 6;

type DecimalParts = {
  readonly units: bigint;
  readonly scale: number;
};

export function formatAuditDecimal(value: string): string {
  return formatScaledInteger(decimalToScaled(parseNonNegativeDecimal(value)), SCALE);
}

export function addAuditDecimals(values: readonly string[]): string {
  return formatScaledInteger(
    values.reduce((total, value) => total + decimalToScaled(parseNonNegativeDecimal(value)), 0n),
    SCALE,
  );
}

export function divideAuditDecimal(numerator: string, denominator: string): string {
  const numeratorScaled = decimalToScaled(parseNonNegativeDecimal(numerator));
  const denominatorScaled = decimalToScaled(parseNonNegativeDecimal(denominator));
  if (denominatorScaled === 0n) return '0.000000';
  return formatScaledInteger(divideAndRoundHalfUp(numeratorScaled * 10n ** BigInt(SCALE), denominatorScaled), SCALE);
}

export function percentage(numerator: number, denominator: number): string {
  if (!Number.isSafeInteger(numerator) || numerator < 0 || !Number.isSafeInteger(denominator) || denominator < 0) {
    throw new Error('Invalid percentage inputs');
  }
  if (denominator === 0) return '0.000000';
  return formatScaledInteger(divideAndRoundHalfUp(BigInt(numerator) * 10n ** BigInt(SCALE), BigInt(denominator)), SCALE);
}

export function compareAuditDecimalAsc(a: string, b: string): number {
  const left = decimalToScaled(parseNonNegativeDecimal(a));
  const right = decimalToScaled(parseNonNegativeDecimal(b));
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function parseNonNegativeDecimal(value: string): DecimalParts {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new Error('Invalid audit decimal');
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
