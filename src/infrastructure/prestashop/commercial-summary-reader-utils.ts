import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../application/customer-profile/errors.js';

const SAFE_PREFIX_PATTERN = /^[A-Za-z0-9_]+$/;

const TIMEOUT_ERROR_CODES = new Set(['ETIMEDOUT', 'PROTOCOL_SEQUENCE_TIMEOUT']);
const UNAVAILABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
  'POOL_CLOSED',
  'ER_CON_COUNT_ERROR',
]);

export function assertSafePrestashopTablePrefix(tablePrefix: string): void {
  if (!SAFE_PREFIX_PATTERN.test(tablePrefix)) {
    throw new Error(`Unsafe PrestaShop table prefix: "${tablePrefix}"`);
  }
}

export function resolvePrestashopCustomerId(customerId: number): number {
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    throw new Error(`Invalid PrestaShop customer id: ${String(customerId)}`);
  }
  return customerId;
}

export function coerceNonNegativeSafeInteger(value: unknown, field: string): number {
  let numericValue: number;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    numericValue = Number(value);
  } else if (typeof value === 'number') {
    numericValue = value;
  } else {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }

  if (!Number.isSafeInteger(numericValue) || numericValue < 0) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return numericValue;
}

export function parseNullableUtcDateTime(value: unknown, field: string): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Invalid ${field}`);
    }
    return value;
  }
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${field}`);
  }

  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${field}`);
  }
  return parsed;
}

export function mapPrestashopReadError(error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;

  if (code && TIMEOUT_ERROR_CODES.has(code)) {
    return new PrestashopTimeoutError('PrestaShop query timed out', { cause: error });
  }
  if (code && UNAVAILABLE_ERROR_CODES.has(code)) {
    return new PrestashopUnavailableError('PrestaShop is unavailable', { cause: error });
  }
  return error instanceof Error ? error : new Error('Unknown PrestaShop read error', { cause: error });
}
