import type { RowDataPacket } from 'mysql2/promise';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../application/customer-profile/errors.js';
import type { OrderStatesReader } from '../../application/customer-profile/ports.js';
import type { OrderStateRecord } from '../../domain/customer-profile/order-state-record.js';
import type { QueryExecutor } from '../shared/query-executor.js';

// The prefix is concatenated into the table names because SQL cannot parameterize
// identifiers — so it must be validated as safe before it ever touches a query string.
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

interface OrderStateRow extends RowDataPacket {
  id_order_state: number;
  name: string;
}

// Read-only, batch lookup by id_order_state only — never by name. Never one query per id:
// callers are expected to dedupe (this adapter re-dedupes defensively too), and a single
// IN (...) query is built with exactly as many placeholders as there are unique ids. A
// stateId with no matching row (missing translation, stale/removed state) is simply
// absent from the result — this reader never fails because an individual id is unknown,
// it only fails for the whole batch (timeout/unavailable/unknown driver error). See CP-R1-T05.
export function createMysqlOrderStatesReader(executor: QueryExecutor, tablePrefix: string): OrderStatesReader {
  if (!SAFE_PREFIX_PATTERN.test(tablePrefix)) {
    throw new Error(`Unsafe PrestaShop table prefix: "${tablePrefix}"`);
  }

  return {
    async findByIds(stateIds, languageId) {
      if (stateIds.length === 0) {
        return [];
      }

      const uniqueStateIds = resolveStateIds(stateIds);
      const safeLanguageId = resolveLanguageId(languageId);

      // Exactly one placeholder per unique id — no GROUP_CONCAT, no per-id query, no
      // interpolated numeric literals: every id and the language id are bound params.
      const placeholders = uniqueStateIds.map(() => '?').join(', ');
      const selectByIdsSql = `
        SELECT os.id_order_state, osl.name
        FROM ${tablePrefix}order_state os
        INNER JOIN ${tablePrefix}order_state_lang osl
          ON osl.id_order_state = os.id_order_state
        WHERE os.id_order_state IN (${placeholders})
          AND osl.id_lang = ?
      `;

      let rows: RowDataPacket[];
      try {
        rows = await executor.execute(selectByIdsSql, [...uniqueStateIds, safeLanguageId]);
      } catch (error) {
        throw mapReadError(error);
      }

      return (rows as OrderStateRow[]).map(
        (row): OrderStateRecord => ({
          stateId: row.id_order_state,
          name: row.name,
        }),
      );
    },
  };
}

function resolveStateIds(stateIds: readonly number[]): number[] {
  const unique = Array.from(new Set(stateIds));
  for (const id of unique) {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error(`Invalid order state id: ${String(id)}`);
    }
  }
  return unique;
}

function resolveLanguageId(languageId: number): number {
  if (!Number.isSafeInteger(languageId) || languageId <= 0) {
    throw new Error(`Invalid order state language id: ${String(languageId)}`);
  }
  return languageId;
}

function mapReadError(error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;

  if (code && TIMEOUT_ERROR_CODES.has(code)) {
    return new PrestashopTimeoutError('PrestaShop query timed out', { cause: error });
  }
  if (code && UNAVAILABLE_ERROR_CODES.has(code)) {
    return new PrestashopUnavailableError('PrestaShop is unavailable', { cause: error });
  }
  // Unknown/unclassified failure: propagate as-is rather than guessing a degraded reason.
  return error instanceof Error ? error : new Error('Unknown PrestaShop read error', { cause: error });
}
