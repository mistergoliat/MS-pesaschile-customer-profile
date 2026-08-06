import type { RowDataPacket } from 'mysql2/promise';
import type { CarriersReader } from '../../application/customer-order-status/ports.js';
import type { CarrierRecord } from '../../domain/customer-order-status/carrier-record.js';
import type { QueryExecutor } from '../shared/query-executor.js';
import { assertSafePrestashopTablePrefix, mapPrestashopReadError } from './commercial-summary-reader-utils.js';

interface CarrierRow extends RowDataPacket {
  id_carrier: number;
  id_reference: number;
  name: string;
  delay: string | null;
}

// Read-only, parameterized by id_carrier — never by name. `delay` is LEFT JOINed from
// carrier_lang (id_lang + id_shop both parameterized) so a missing translation still
// returns the carrier with delay: null instead of the whole row disappearing — a
// carrier genuinely absent from ps_carrier is the only case that returns null overall.
// Neither `name` nor `delay` is ever used to classify anything here — see
// resolveDeliveryMethod, which only ever looks at carrierId.
export function createMysqlCarriersReader(executor: QueryExecutor, tablePrefix: string): CarriersReader {
  assertSafePrestashopTablePrefix(tablePrefix);

  const selectByIdSql = `
    SELECT
      c.id_carrier,
      c.id_reference,
      c.name,
      cl.delay
    FROM ${tablePrefix}carrier c
    LEFT JOIN ${tablePrefix}carrier_lang cl
      ON cl.id_carrier = c.id_carrier
     AND cl.id_lang = ?
     AND cl.id_shop = ?
    WHERE c.id_carrier = ?
    LIMIT 1
  `;

  return {
    async findById(carrierId, languageId, shopId) {
      const safeCarrierId = resolveCarrierId(carrierId);
      // id_carrier = 0 is a legitimate PrestaShop sentinel for orders with no shipping
      // (e.g. virtual-only products) — a valid "no carrier" outcome, never a row in
      // ps_carrier, so it short-circuits to null before any SQL runs. See CP-R1-T06 audit.
      if (safeCarrierId === 0) {
        return null;
      }

      const safeLanguageId = resolvePositiveInt(languageId, 'carrier language id');
      const safeShopId = resolvePositiveInt(shopId, 'carrier shop id');

      let rows: RowDataPacket[];
      try {
        rows = await executor.execute(selectByIdSql, [safeLanguageId, safeShopId, safeCarrierId]);
      } catch (error) {
        throw mapPrestashopReadError(error);
      }

      const row = rows[0] as CarrierRow | undefined;
      if (!row) {
        return null;
      }

      const record: CarrierRecord = {
        carrierId: row.id_carrier,
        referenceId: row.id_reference,
        name: row.name,
        delay: row.delay,
      };
      return record;
    },
  };
}

// Unlike resolvePositiveInt below, 0 is a valid carrier id (see findById above) —
// negative, decimal, NaN, Infinity and unsafe integers are still rejected.
function resolveCarrierId(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid carrier id: ${String(value)}`);
  }
  return value;
}

function resolvePositiveInt(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }
  return value;
}
