import type { RowDataPacket } from 'mysql2/promise';
import type { AudienceExportContactReader } from '../../application/customer-intelligence-audience/ports.js';
import type { AudienceExportContactV1 } from '../../domain/customer-intelligence-audience/index.js';
import type { QueryExecutor } from '../shared/query-executor.js';
import { assertSafePrestashopTablePrefix, mapPrestashopReadError } from './commercial-summary-reader-utils.js';

export const DEFAULT_AUDIENCE_EXPORT_CONTACT_CHUNK_SIZE = 1000;

type AudienceExportContactReaderOptions = {
  readonly chunkSize?: number;
};

interface PrestashopExportContactRow extends RowDataPacket {
  readonly customerId: number | string;
  readonly email: string | null;
  readonly firstname: string | null;
  readonly lastname: string | null;
}

/**
 * Read-only, set-based contact hydration for an authoritative audience member set.
 * The table is queried in bounded IN-list chunks; no single-customer profile call is used.
 */
export function createMysqlPrestashopCustomerExportReader(
  executor: QueryExecutor,
  tablePrefix: string,
  options: AudienceExportContactReaderOptions = {},
): AudienceExportContactReader {
  assertSafePrestashopTablePrefix(tablePrefix);
  const chunkSize = options.chunkSize ?? DEFAULT_AUDIENCE_EXPORT_CONTACT_CHUNK_SIZE;
  assertChunkSize(chunkSize);

  return {
    async readByCustomerIds(customerIds) {
      const ids = uniqueCustomerIds(customerIds);
      if (ids.length === 0) return [];

      const contacts = new Map<number, AudienceExportContactV1>();
      try {
        for (const chunk of chunkIds(ids, chunkSize)) {
          const placeholders = chunk.map(() => '?').join(', ');
          const sql = [
            'SELECT id_customer AS customerId, email, firstname, lastname',
            `FROM ${tablePrefix}customer`,
            `WHERE id_customer IN (${placeholders})`,
            'ORDER BY id_customer ASC',
          ].join(' ');
          const rows = await executor.execute(sql, chunk);
          for (const row of rows as PrestashopExportContactRow[]) {
            const customerId = parseCustomerId(row.customerId);
            if (!new Set(chunk).has(customerId)) {
              throw new Error('PrestaShop bulk contact reader returned an unrequested customer');
            }
            if (contacts.has(customerId)) {
              throw new Error('PrestaShop bulk contact reader returned duplicate customer rows');
            }
            contacts.set(customerId, {
              customerId,
              email: nullableText(row.email),
              firstname: nullableText(row.firstname),
              lastname: nullableText(row.lastname),
            });
          }
        }
      } catch (error) {
        throw mapPrestashopReadError(error);
      }

      return [...contacts.values()].sort((left, right) => left.customerId - right.customerId);
    },
  };
}

export const createMysqlPrestashopBulkContactReader = createMysqlPrestashopCustomerExportReader;

function uniqueCustomerIds(customerIds: readonly number[]): number[] {
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const customerId of customerIds) {
    const validId = parseCustomerId(customerId);
    if (!seen.has(validId)) {
      seen.add(validId);
      ids.push(validId);
    }
  }
  return ids.sort((left, right) => left - right);
}

function parseCustomerId(value: unknown): number {
  const customerId = typeof value === 'string' && /^\d+$/.test(value)
    ? Number(value)
    : typeof value === 'number'
      ? value
      : Number.NaN;
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    throw new Error('Invalid PrestaShop customer id in bulk contact reader');
  }
  return customerId;
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function assertChunkSize(chunkSize: number): void {
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0 || chunkSize > 5000) {
    throw new Error(`Invalid audience export contact chunk size: ${String(chunkSize)}`);
  }
}

function* chunkIds(ids: readonly number[], chunkSize: number): Generator<readonly number[]> {
  for (let index = 0; index < ids.length; index += chunkSize) {
    yield ids.slice(index, index + chunkSize);
  }
}
