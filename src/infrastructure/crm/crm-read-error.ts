import { CrmSchemaIncompatibleError, CrmTimeoutError, CrmUnavailableError } from '../../application/customer-profile/errors.js';

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

export function mapCrmReadError(error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;

  if (code && SCHEMA_INCOMPATIBLE_ERROR_CODES.has(code)) {
    return new CrmSchemaIncompatibleError('CRM schema is incompatible with this service', { cause: error });
  }
  if (code && TIMEOUT_ERROR_CODES.has(code)) {
    return new CrmTimeoutError('CRM query timed out', { cause: error });
  }
  if (code && UNAVAILABLE_ERROR_CODES.has(code)) {
    return new CrmUnavailableError('CRM is unavailable', { cause: error });
  }
  return error instanceof Error ? error : new Error('Unknown CRM read error', { cause: error });
}
