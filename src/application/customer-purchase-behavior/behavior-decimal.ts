const SCALE = 6;
const SCALE_FACTOR = 10n ** BigInt(SCALE);

type DecimalParts = {
  readonly units: bigint;
  readonly scale: number;
};

export function formatBehaviorDecimal(value: string): string {
  return formatScaledInteger(roundDecimalToScale(parseNonNegativeDecimal(value), SCALE), SCALE);
}

export function addBehaviorDecimals(values: readonly string[]): string {
  return formatScaledInteger(
    values.reduce((total, value) => total + decimalToScaled(parseNonNegativeDecimal(value)), 0n),
    SCALE,
  );
}

export function divideIntegerToBehaviorDecimal(numerator: number, denominator: number): string {
  if (!Number.isSafeInteger(numerator) || numerator < 0 || !Number.isSafeInteger(denominator) || denominator < 0) {
    throw new Error('Invalid integer behavior ratio');
  }
  if (denominator === 0) return '0.000000';
  return formatScaledInteger(divideAndRoundHalfUp(BigInt(numerator) * SCALE_FACTOR, BigInt(denominator)), SCALE);
}

export function divideDecimalToBehaviorDecimal(numerator: string, denominator: string): string {
  const numeratorScaled = decimalToScaled(parseNonNegativeDecimal(numerator));
  const denominatorScaled = decimalToScaled(parseNonNegativeDecimal(denominator));
  if (denominatorScaled === 0n) return '0.000000';
  return formatScaledInteger(divideAndRoundHalfUp(numeratorScaled * SCALE_FACTOR, denominatorScaled), SCALE);
}

export function squareBehaviorShare(value: string): string {
  const scaled = parseScaledBehaviorDecimal(value);
  return formatScaledInteger(divideAndRoundHalfUp(scaled * scaled, SCALE_FACTOR), SCALE);
}

export function sumBehaviorShares(values: readonly string[]): string {
  return formatScaledInteger(
    values.reduce((total, value) => total + parseScaledBehaviorDecimal(value), 0n),
    SCALE,
  );
}

export function effectiveDiversityFromHhi(hhi: string): string {
  const hhiScaled = parseScaledBehaviorDecimal(hhi);
  if (hhiScaled === 0n) return '0.000000';
  return formatScaledInteger(divideAndRoundHalfUp(SCALE_FACTOR * SCALE_FACTOR, hhiScaled), SCALE);
}

export function compareDecimalDesc(a: string, b: string): number {
  const left = decimalToScaled(parseNonNegativeDecimal(a));
  const right = decimalToScaled(parseNonNegativeDecimal(b));
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

function parseNonNegativeDecimal(value: string): DecimalParts {
  if (typeof value !== 'string') {
    throw new Error('Invalid behavior decimal');
  }
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new Error('Invalid behavior decimal');
  }
  const [whole, fractional = ''] = trimmed.split('.');
  return {
    units: BigInt(`${whole}${fractional}`),
    scale: fractional.length,
  };
}

function decimalToScaled(decimal: DecimalParts): bigint {
  return roundDecimalToScale(decimal, SCALE);
}

function roundDecimalToScale(decimal: DecimalParts, targetScale: number): bigint {
  if (decimal.scale === targetScale) return decimal.units;
  if (decimal.scale < targetScale) {
    return decimal.units * 10n ** BigInt(targetScale - decimal.scale);
  }
  return divideAndRoundHalfUp(decimal.units, 10n ** BigInt(decimal.scale - targetScale));
}

function parseScaledBehaviorDecimal(value: string): bigint {
  const decimal = parseNonNegativeDecimal(value);
  if (decimal.scale > SCALE) {
    throw new Error('Behavior share must already be rounded to six decimals');
  }
  return decimalToScaled(decimal);
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

