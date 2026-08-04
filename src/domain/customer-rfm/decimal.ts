const SCALE = 6;

type DecimalParts = {
  readonly units: bigint;
  readonly scale: number;
};

export function formatRfmDecimal(value: string | number): string {
  return formatScaledInteger(decimalToScaled(parseNonNegativeDecimal(String(value))), SCALE);
}

export function addRfmDecimals(values: readonly string[]): string {
  return formatScaledInteger(
    values.reduce((total, value) => total + decimalToScaled(parseNonNegativeDecimal(value)), 0n),
    SCALE,
  );
}

export function divideRfmDecimal(numerator: string, denominator: number): string {
  if (!Number.isSafeInteger(denominator) || denominator < 0) {
    throw new Error('Invalid RFM decimal denominator');
  }
  if (denominator === 0) {
    return '0.000000';
  }
  const numeratorScaled = decimalToScaled(parseNonNegativeDecimal(numerator));
  return formatScaledInteger(divideAndRoundHalfUp(numeratorScaled, BigInt(denominator)), SCALE);
}

export function compareRfmDecimalAsc(a: string, b: string): number {
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
