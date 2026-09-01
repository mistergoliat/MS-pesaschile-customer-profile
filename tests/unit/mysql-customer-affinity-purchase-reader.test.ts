import { describe, expect, it } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { createMysqlCustomerAffinityPurchaseReader } from '../../src/infrastructure/prestashop/mysql-customer-affinity-purchase-reader.js';
import type { QueryExecutor } from '../../src/infrastructure/shared/query-executor.js';

const referenceTime = '2026-09-01T00:00:00.000Z';

describe('MySQL customer affinity purchase reader', () => {
  it('uses a fixed watermark and complete-order keyset batches without splitting or duplicating orders', async () => {
    const calls: string[] = [];
    const executor: QueryExecutor = {
      async execute(sql) {
        calls.push(sql);
        if (/MAX\(o\.id_order\)/u.test(sql)) return [{ sourceWatermarkOrderId: 3 } as RowDataPacket];
        if (/SELECT o\.id_order AS orderId/u.test(sql)) {
          return calls.filter((call) => /SELECT o\.id_order AS orderId/u.test(call)).length === 1
            ? [{ orderId: 1 }, { orderId: 2 }].map((row) => row as RowDataPacket)
            : [{ orderId: 3 } as RowDataPacket];
        }
        if (/o\.id_order IN/u.test(sql)) {
          return sql.includes('?, ?')
            ? [{ customerId: 10, orderId: 1, orderDetailId: 11, orderCreatedAt: '2026-08-01 00:00:00', productId: 22, lineRevenueTaxIncl: '100.10' }, { customerId: 10, orderId: 2, orderDetailId: 21, orderCreatedAt: '2026-08-02 00:00:00', productId: 22, lineRevenueTaxIncl: '200.20' }].map((row) => row as RowDataPacket)
            : [{ customerId: 11, orderId: 3, orderDetailId: 31, orderCreatedAt: '2026-08-03 00:00:00', productId: 23, lineRevenueTaxIncl: '300.30' } as RowDataPacket];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };

    const progress: number[] = [];
    const reader = createMysqlCustomerAffinityPurchaseReader(executor, 'ps_', { excludedOperationalCustomerIds: [999] });
    const evidence = await reader.readEvidence(referenceTime, { batchSize: 2, onProgress: (event) => progress.push(event.batchNumber) });

    expect(evidence.map((row) => row.orderId)).toEqual([1, 2, 3]);
    expect(progress).toEqual([1, 2]);
    expect(reader.getLastReadMetrics()).toMatchObject({ sourceWatermarkOrderId: 3, sourceQueries: 5, batches: 2, sourceOrdersRead: 3, sourceLinesRead: 3, retries: 0 });
    expect(calls.every((sql) => !/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i.test(sql))).toBe(true);
    expect(calls.filter((sql) => /date_add\s*</u.test(sql)).length).toBe(5);
  });

  it('retries a transient page failure a bounded number of times', async () => {
    let pageAttempts = 0;
    const executor: QueryExecutor = {
      async execute(sql) {
        if (/MAX\(o\.id_order\)/u.test(sql)) return [{ sourceWatermarkOrderId: 1 } as RowDataPacket];
        if (/SELECT o\.id_order AS orderId/u.test(sql)) {
          pageAttempts += 1;
          if (pageAttempts < 3) throw Object.assign(new Error('temporary timeout'), { code: 'ETIMEDOUT' });
          return [{ orderId: 1 } as RowDataPacket];
        }
        return [];
      },
    };
    const reader = createMysqlCustomerAffinityPurchaseReader(executor, 'ps_', { excludedOperationalCustomerIds: [999] });
    await expect(reader.readEvidence(referenceTime, { maxRetries: 2, batchSize: 1 })).resolves.toEqual([]);
    expect(reader.getLastReadMetrics().retries).toBe(2);
    expect(pageAttempts).toBe(3);
  });

  it('rejects an empty operational exclusion policy instead of broadening the population', () => {
    expect(() => createMysqlCustomerAffinityPurchaseReader({ execute: async () => [] }, 'ps_', { excludedOperationalCustomerIds: [] })).toThrow(/operational customer exclusions/);
  });

  it('returns the same ordered evidence for different complete-order batch sizes', async () => {
    const allOrders = [1, 2, 3, 4, 5];
    const allEvidence = allOrders.map((orderId) => ({
      customerId: 10,
      orderId,
      orderDetailId: orderId * 10,
      orderCreatedAt: `2026-08-0${orderId} 00:00:00`,
      productId: 20 + orderId,
      lineRevenueTaxIncl: `${orderId}.00`,
    }));

    const read = async (batchSize: number) => {
      const executor: QueryExecutor = {
        async execute(sql, values = []) {
          if (/MAX\(o\.id_order\)/u.test(sql)) return [{ sourceWatermarkOrderId: 5 } as RowDataPacket];
          if (/SELECT o\.id_order AS orderId/u.test(sql)) {
            const lastSeen = Number(values.at(-2));
            const limit = Number(sql.match(/LIMIT (\d+)/u)?.[1]);
            return allOrders.filter((orderId) => orderId > lastSeen).slice(0, limit).map((orderId) => ({ orderId } as RowDataPacket));
          }
          if (/o\.id_order IN/u.test(sql)) {
            const orderIdList = sql.match(/o\.id_order IN \(([^)]+)/u)?.[1] ?? '';
            const orderIdCount = (orderIdList.match(/\?/gu) ?? []).length;
            const orderIds = values.slice(0, orderIdCount).map(Number);
            return allEvidence.filter((row) => orderIds.includes(row.orderId)) as unknown as RowDataPacket[];
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
      return createMysqlCustomerAffinityPurchaseReader(executor, 'ps_', { excludedOperationalCustomerIds: [999] })
        .readEvidence(referenceTime, { batchSize });
    };

    const small = await read(2);
    const large = await read(4);
    expect(small).toEqual(large);
    expect(small[0]?.orderCreatedAt).toBe('2026-08-01T00:00:00.000Z');
  });
});
