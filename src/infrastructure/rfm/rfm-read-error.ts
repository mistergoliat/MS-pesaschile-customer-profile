import { RfmSchemaIncompatibleError, RfmTimeoutError, RfmUnavailableError } from '../../application/customer-profile/errors.js';

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

export function mapRfmReadError(error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;

  if (code && SCHEMA_INCOMPATIBLE_ERROR_CODES.has(code)) {
    return new RfmSchemaIncompatibleError('RFM snapshot DB schema is incompatible with this service', { cause: error });
  }
  if (code && TIMEOUT_ERROR_CODES.has(code)) {
    return new RfmTimeoutError('RFM snapshot DB query timed out', { cause: error });
  }
  if (code && UNAVAILABLE_ERROR_CODES.has(code)) {
    return new RfmUnavailableError('RFM snapshot DB is unavailable', { cause: error });
  }
  return error instanceof Error ? error : new Error('Unknown RFM snapshot DB read error', { cause: error });
}
