const PUBLIC_MONEY_SCALE = 6;

type DecimalParts = {
  readonly units: bigint;
  readonly scale: number;
};

// Public money is rounded half-up to six decimal places. The implementation keeps the
// input as decimal text and BigInt throughout, so large DECIMAL values never pass through
// JavaScript floating point.
export function formatDecimalMoney(value: string): string {
  return formatScaledInteger(roundDecimalToScale(parseNonNegativeDecimal(value), PUBLIC_MONEY_SCALE), PUBLIC_MONEY_SCALE);
}

export function divideDecimalMoneyByInteger(value: string, divisor: number): string {
  if (!Number.isSafeInteger(divisor) || divisor < 0) {
    throw new Error(`Invalid money divisor: ${String(divisor)}`);
  }
  if (divisor === 0) {
    return '0.000000';
  }

  const decimal = parseNonNegativeDecimal(value);
  const numerator = decimal.units * 10n ** BigInt(PUBLIC_MONEY_SCALE);
  const denominator = BigInt(divisor) * 10n ** BigInt(decimal.scale);
  return formatScaledInteger(divideAndRoundHalfUp(numerator, denominator), PUBLIC_MONEY_SCALE);
}

export function assertNonNegativeDecimal(value: string): void {
  parseNonNegativeDecimal(value);
}

function parseNonNegativeDecimal(value: string): DecimalParts {
  if (typeof value !== 'string') {
    throw new Error('Invalid decimal money value');
  }

  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new Error('Invalid decimal money value');
  }

  const [whole, fractional = ''] = trimmed.split('.');
  return {
    units: BigInt(`${whole}${fractional}`),
    scale: fractional.length,
  };
}

function roundDecimalToScale(decimal: DecimalParts, targetScale: number): bigint {
  if (decimal.scale === targetScale) {
    return decimal.units;
  }
  if (decimal.scale < targetScale) {
    return decimal.units * 10n ** BigInt(targetScale - decimal.scale);
  }

  const factor = 10n ** BigInt(decimal.scale - targetScale);
  return divideAndRoundHalfUp(decimal.units, factor);
}

function divideAndRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function formatScaledInteger(value: bigint, scale: number): string {
  const raw = value.toString().padStart(scale + 1, '0');
  const whole = raw.slice(0, -scale);
  const fractional = raw.slice(-scale);
  return `${whole}.${fractional}`;
}
