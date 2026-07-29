const DECIMAL_SCALE = 6;
const SCALE_FACTOR = 10n ** BigInt(DECIMAL_SCALE);

export function parseNonNegativeDecimalToScaled(value: string | number | null): bigint {
  if (value === null) return 0n;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Invalid decimal number: ${String(value)}`);
    }
    return BigInt(value) * SCALE_FACTOR;
  }

  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid decimal string: ${value}`);
  }

  const [wholeRaw = '0', fractionalRaw = ''] = trimmed.split('.');
  const whole = BigInt(wholeRaw.replace(/^0+(?=\d)/, ''));
  const paddedFraction = `${fractionalRaw}${'0'.repeat(DECIMAL_SCALE)}`.slice(0, DECIMAL_SCALE);
  return whole * SCALE_FACTOR + BigInt(paddedFraction || '0');
}

export function formatScaledDecimal(value: bigint): string {
  if (value < 0n) {
    throw new Error('Cannot format a negative audit decimal');
  }
  const whole = value / SCALE_FACTOR;
  const fraction = value % SCALE_FACTOR;
  return `${whole.toString()}.${fraction.toString().padStart(DECIMAL_SCALE, '0')}`;
}

export function addDecimalStrings(values: readonly (string | number | null)[]): string {
  return formatScaledDecimal(values.reduce((total, value) => total + parseNonNegativeDecimalToScaled(value), 0n));
}

export function percentage(numerator: number, denominator: number, decimals = 2): number {
  if (denominator <= 0) return 0;
  const factor = 10 ** decimals;
  return Math.round((numerator / denominator) * 100 * factor) / factor;
}

export function decimalPercentage(numerator: string, denominator: string, decimals = 2): number {
  const numeratorScaled = parseNonNegativeDecimalToScaled(numerator);
  const denominatorScaled = parseNonNegativeDecimalToScaled(denominator);
  if (denominatorScaled === 0n) return 0;

  const factor = 10n ** BigInt(decimals);
  const scaledPercent = (numeratorScaled * 100n * factor + denominatorScaled / 2n) / denominatorScaled;
  return Number(scaledPercent) / 10 ** decimals;
}

