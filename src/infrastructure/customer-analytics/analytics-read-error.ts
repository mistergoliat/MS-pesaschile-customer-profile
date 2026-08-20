import {
  AnalyticsSchemaIncompatibleError,
  AnalyticsTimeoutError,
  AnalyticsUnavailableError,
} from '../../application/customer-profile/errors.js';

// Mirrors src/infrastructure/clustering/cluster-read-error.ts exactly.
const TIMEOUT_ERROR_CODES = new Set(['ETIMEDOUT', 'PROTOCOL_SEQUENCE_TIMEOUT']);
const UNAVAILABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
]);
const SCHEMA_INCOMPATIBLE_ERROR_CODES = new Set(['ER_BAD_FIELD_ERROR', 'ER_NO_SUCH_TABLE']);

export function mapAnalyticsReadError(error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;

  if (code && SCHEMA_INCOMPATIBLE_ERROR_CODES.has(code)) {
    return new AnalyticsSchemaIncompatibleError('Analytics DB schema is incompatible with this service', { cause: error });
  }
  if (code && TIMEOUT_ERROR_CODES.has(code)) {
    return new AnalyticsTimeoutError('Analytics DB query timed out', { cause: error });
  }
  if (code && UNAVAILABLE_ERROR_CODES.has(code)) {
    return new AnalyticsUnavailableError('Analytics DB is unavailable', { cause: error });
  }
  return error instanceof Error ? error : new Error('Unknown analytics DB read error', { cause: error });
}
