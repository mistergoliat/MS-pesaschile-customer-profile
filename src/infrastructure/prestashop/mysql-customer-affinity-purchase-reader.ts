import type { RowDataPacket } from 'mysql2/promise';
import type {
  CustomerAffinityPurchaseEvidence,
  CustomerAffinityPurchaseEvidenceReader,
  CustomerAffinityPurchaseReaderPolicy,
  CustomerAffinityPurchaseReadMetrics,
  CustomerAffinityPurchaseReadOptions,
} from '../../application/customer-commercial-affinity-population/ports.js';
import { excludedOperationalAccountPrestashopCustomerIds } from '../../domain/customer-rfm/operational-account-exclusion-policy.js';
import type { QueryExecutor } from '../shared/query-executor.js';
import { assertSafePrestashopTablePrefix, mapPrestashopReadError } from './commercial-summary-reader-utils.js';

const DEFAULT_BATCH_SIZE = 1_000;
const MAX_BATCH_SIZE = 2_500;
const DEFAULT_MAX_RETRIES = 2;

type WatermarkRow = RowDataPacket & { sourceWatermarkOrderId: number | string | null };
type OrderIdRow = RowDataPacket & { orderId: number | string };
type EvidenceRow = RowDataPacket & {
  customerId: number | string;
  orderId: number | string;
  orderDetailId: number | string;
  orderCreatedAt: string;
  productId: number | string;
  lineRevenueTaxIncl: string | number;
};

const defaultPolicy: CustomerAffinityPurchaseReaderPolicy = {
  excludedOperationalCustomerIds: excludedOperationalAccountPrestashopCustomerIds,
};

// A01.4.1 source strategy: establish one immutable id_order watermark, page eligible order
// headers by keyset, then fetch all lines for that complete order-id page. The line query uses
// the order-id key and cannot split an order across pages. The fixed referenceTime is repeated in
// every source query so a historical run cannot leak post-cutoff data.
export function createMysqlCustomerAffinityPurchaseReader(
  executor: QueryExecutor,
  tablePrefix: string,
  policy: CustomerAffinityPurchaseReaderPolicy = defaultPolicy,
): CustomerAffinityPurchaseEvidenceReader {
  assertSafePrestashopTablePrefix(tablePrefix);
  const excludedIds = uniquePositiveIntegers(policy.excludedOperationalCustomerIds);
  if (excludedIds.length === 0) throw new Error('Affinity purchase reader requires operational customer exclusions');
  const excludedPlaceholders = excludedIds.map(() => '?').join(', ');
  const orders = `${tablePrefix}orders`;
  const customers = `${tablePrefix}customer`;
  const currency = `${tablePrefix}currency`;
  const orderDetail = `${tablePrefix}order_detail`;
  let lastMetrics: CustomerAffinityPurchaseReadMetrics = emptyMetrics();

  async function readEvidence(referenceTime: string, options: CustomerAffinityPurchaseReadOptions = {}): Promise<readonly CustomerAffinityPurchaseEvidence[]> {
    const batchSize = resolveBatchSize(options.batchSize);
    const maxRetries = resolveMaxRetries(options.maxRetries);
    const mysqlReferenceTime = toMysqlReferenceTime(referenceTime);
    const startedAt = performance.now();
    let sourceQueries = 0;
    let retries = 0;
    let batchNumber = 0;
    let ordersProcessed = 0;
    let linesProcessed = 0;
    let lastSeenOrderId = 0;
    const evidence: CustomerAffinityPurchaseEvidence[] = [];

    const watermarkRows = await executeWithRetry<WatermarkRow[]>(
      () => executor.execute(
        `
          SELECT MAX(o.id_order) AS sourceWatermarkOrderId
          FROM ${orders} o
          INNER JOIN ${customers} c ON c.id_customer = o.id_customer
          INNER JOIN ${currency} cur ON cur.id_currency = o.id_currency AND cur.iso_code = 'CLP'
          WHERE o.valid = 1
            AND o.total_paid_tax_incl > 0
            AND o.id_customer > 0
            AND o.id_customer NOT IN (${excludedPlaceholders})
            AND o.date_add < ?
        `,
        [...excludedIds, mysqlReferenceTime],
      ),
      maxRetries,
      () => { sourceQueries += 1; },
      (count) => { retries += count; },
    );
    const sourceWatermarkOrderId = coerceNullablePositiveInteger(watermarkRows[0]?.sourceWatermarkOrderId, 'sourceWatermarkOrderId');

    while (sourceWatermarkOrderId !== null && lastSeenOrderId < sourceWatermarkOrderId) {
      batchNumber += 1;
      const orderRows = await executeWithRetry<OrderIdRow[]>(
        () => executor.execute(
          `
            SELECT o.id_order AS orderId
            FROM ${orders} o
            INNER JOIN ${customers} c ON c.id_customer = o.id_customer
            INNER JOIN ${currency} cur ON cur.id_currency = o.id_currency AND cur.iso_code = 'CLP'
            WHERE o.valid = 1
              AND o.total_paid_tax_incl > 0
              AND o.id_customer > 0
              AND o.id_customer NOT IN (${excludedPlaceholders})
              AND o.date_add < ?
              AND o.id_order > ?
              AND o.id_order <= ?
            ORDER BY o.id_order ASC
            LIMIT ${batchSize}
          `,
          [...excludedIds, mysqlReferenceTime, lastSeenOrderId, sourceWatermarkOrderId],
        ),
        maxRetries,
        () => { sourceQueries += 1; },
        (count) => { retries += count; },
      );
      const orderIds = orderRows.map((row) => coercePositiveInteger(row.orderId, 'orderId'));
      if (orderIds.length === 0) break;
      const lineRows = await executeWithRetry<EvidenceRow[]>(
        () => executor.execute(
          `
            SELECT
              o.id_customer AS customerId,
              o.id_order AS orderId,
              od.id_order_detail AS orderDetailId,
              o.date_add AS orderCreatedAt,
              od.product_id AS productId,
              od.total_price_tax_incl AS lineRevenueTaxIncl
            FROM ${orders} o
            INNER JOIN ${customers} c ON c.id_customer = o.id_customer
            INNER JOIN ${currency} cur ON cur.id_currency = o.id_currency AND cur.iso_code = 'CLP'
            INNER JOIN ${orderDetail} od ON od.id_order = o.id_order
            WHERE o.id_order IN (${orderIds.map(() => '?').join(', ')})
              AND o.valid = 1
              AND o.total_paid_tax_incl > 0
              AND o.id_customer > 0
              AND o.id_customer NOT IN (${excludedPlaceholders})
              AND o.date_add < ?
              AND od.total_price_tax_incl > 0
            ORDER BY o.id_order ASC, od.id_order_detail ASC
          `,
          [...orderIds, ...excludedIds, mysqlReferenceTime],
        ),
        maxRetries,
        () => { sourceQueries += 1; },
        (count) => { retries += count; },
      );
      for (const row of lineRows) {
        evidence.push({
          customerId: coercePositiveInteger(row.customerId, 'customerId'),
          orderId: coercePositiveInteger(row.orderId, 'orderId'),
          orderDetailId: coercePositiveInteger(row.orderDetailId, 'orderDetailId'),
          orderCreatedAt: toUtcIsoTimestamp(row.orderCreatedAt),
          productId: coercePositiveInteger(row.productId, 'productId'),
          lineRevenueTaxIncl: String(row.lineRevenueTaxIncl),
        });
      }
      ordersProcessed += orderIds.length;
      linesProcessed += lineRows.length;
      lastSeenOrderId = orderIds[orderIds.length - 1]!;
      options.onProgress?.({
        batchNumber,
        ordersProcessed,
        linesProcessed,
        lastSeenOrderId,
        sourceWatermarkOrderId,
        elapsedMs: performance.now() - startedAt,
      });
    }

    lastMetrics = {
      sourceWatermarkOrderId,
      sourceQueries,
      batches: batchNumber,
      sourceOrdersRead: ordersProcessed,
      sourceLinesRead: linesProcessed,
      retries,
      durationMs: performance.now() - startedAt,
    };
    return evidence;
  }

  return { readEvidence, getLastReadMetrics: () => lastMetrics };
}

async function executeWithRetry<T extends RowDataPacket[]>(
  execute: () => Promise<RowDataPacket[]>,
  maxRetries: number,
  onQuery: () => void,
  onRetries: (count: number) => void,
): Promise<T> {
  let attempt = 0;
  while (true) {
    onQuery();
    try {
      return await execute() as T;
    } catch (error) {
      if (attempt >= maxRetries || !isTransientReadError(error)) throw mapPrestashopReadError(error);
      attempt += 1;
      onRetries(1);
      await new Promise((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
}

function isTransientReadError(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return ['ETIMEDOUT', 'PROTOCOL_SEQUENCE_TIMEOUT', 'ECONNRESET', 'EPIPE', 'PROTOCOL_CONNECTION_LOST', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(code);
}

function resolveBatchSize(value: number | undefined): number {
  const result = value ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(result) || result < 1 || result > MAX_BATCH_SIZE) throw new Error(`Invalid affinity purchase batchSize: ${String(value)}`);
  return result;
}

function resolveMaxRetries(value: number | undefined): number {
  const result = value ?? DEFAULT_MAX_RETRIES;
  if (!Number.isSafeInteger(result) || result < 0 || result > 5) throw new Error(`Invalid affinity purchase maxRetries: ${String(value)}`);
  return result;
}

function uniquePositiveIntegers(values: readonly number[]): readonly number[] {
  const unique = [...new Set(values.map(Number))].sort((left, right) => left - right);
  if (unique.some((value) => !Number.isSafeInteger(value) || value <= 0)) throw new Error('Invalid operational customer exclusions');
  return unique;
}

function coercePositiveInteger(value: unknown, field: string): number {
  const number = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`Invalid ${field}: ${String(value)}`);
  return number;
}

function coerceNullablePositiveInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  return coercePositiveInteger(value, field);
}

function emptyMetrics(): CustomerAffinityPurchaseReadMetrics {
  return { sourceWatermarkOrderId: null, sourceQueries: 0, batches: 0, sourceOrdersRead: 0, sourceLinesRead: 0, retries: 0, durationMs: 0 };
}

function toMysqlReferenceTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid affinity referenceTime: ${value}`);
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

function toUtcIsoTimestamp(value: unknown): string {
  const raw = String(value).trim();
  const mysqlDateTime = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/u.exec(raw);
  if (mysqlDateTime) {
    const fraction = (mysqlDateTime[3] ?? '').padEnd(3, '0').slice(0, 3);
    return `${mysqlDateTime[1]}T${mysqlDateTime[2]}.${fraction}Z`;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid orderCreatedAt: ${raw}`);
  return date.toISOString();
}
