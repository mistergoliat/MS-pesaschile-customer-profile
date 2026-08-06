import type { RowDataPacket } from 'mysql2/promise';
import type { OrderStatesReader } from '../../application/customer-profile/ports.js';
import type { OrderStateRecord } from '../../domain/customer-profile/order-state-record.js';
import type { QueryExecutor } from '../shared/query-executor.js';
import { assertSafePrestashopTablePrefix, mapPrestashopReadError } from './commercial-summary-reader-utils.js';

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
  assertSafePrestashopTablePrefix(tablePrefix);

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
        throw mapPrestashopReadError(error);
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
