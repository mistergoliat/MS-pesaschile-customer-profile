import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../src/application/customer-profile/errors.js';
import { createMysqlCarriersReader } from '../../src/infrastructure/prestashop/mysql-carriers-reader.js';
import type { QueryExecutor } from '../../src/infrastructure/shared/query-executor.js';

function fakeExecutor(rows: RowDataPacket[]) {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const executor: QueryExecutor = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return rows;
    },
  };
  return { executor, calls };
}

function throwingExecutor(error: unknown): QueryExecutor {
  return {
    async execute() {
      throw error;
    },
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toUpperCase();
}

const sampleRow = {
  id_carrier: 2,
  id_reference: 2,
  name: 'Despacho a domicilio',
  delay: '3 a 5 días hábiles',
} as unknown as RowDataPacket;

describe('createMysqlCarriersReader', () => {
  it('joins carrier with carrier_lang, parameterizing id_lang, id_shop and carrierId', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlCarriersReader(executor, 'ps_');

    await reader.findById(2, 1, 1);

    expect(calls).toHaveLength(1);
    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).toContain('FROM PS_CARRIER C');
    expect(sql).toContain('LEFT JOIN PS_CARRIER_LANG CL');
    expect(sql).toContain('ON CL.ID_CARRIER = C.ID_CARRIER');
    expect(sql).toContain('AND CL.ID_LANG = ?');
    expect(sql).toContain('AND CL.ID_SHOP = ?');
    expect(sql).toContain('WHERE C.ID_CARRIER = ?');
    expect(sql).toContain('LIMIT 1');
    expect(calls[0]!.params).toEqual([1, 1, 2]);
  });

  it('rejects an unsafe table prefix instead of interpolating it', () => {
    const { executor } = fakeExecutor([]);

    expect(() => createMysqlCarriersReader(executor, 'ps_; DROP TABLE ps_carrier; --')).toThrow();
  });

  it('rejects an invalid carrierId (negative, decimal, NaN, Infinity, unsafe) without executing SQL', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlCarriersReader(executor, 'ps_');

    await expect(reader.findById(-1, 1, 1)).rejects.toThrow();
    await expect(reader.findById(1.5, 1, 1)).rejects.toThrow();
    await expect(reader.findById(Number.NaN, 1, 1)).rejects.toThrow();
    await expect(reader.findById(Number.POSITIVE_INFINITY, 1, 1)).rejects.toThrow();
    await expect(reader.findById(Number.NEGATIVE_INFINITY, 1, 1)).rejects.toThrow();
    await expect(reader.findById(Number.MAX_SAFE_INTEGER + 1, 1, 1)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('returns null for carrierId 0 without executing SQL (PrestaShop sentinel for orders with no shipping)', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlCarriersReader(executor, 'ps_');

    const result = await reader.findById(0, 1, 1);

    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('rejects an invalid languageId (zero, negative, decimal) without executing SQL', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlCarriersReader(executor, 'ps_');

    await expect(reader.findById(2, 0, 1)).rejects.toThrow();
    await expect(reader.findById(2, -1, 1)).rejects.toThrow();
    await expect(reader.findById(2, 1.5, 1)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('rejects an invalid shopId (zero, negative, decimal) without executing SQL', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlCarriersReader(executor, 'ps_');

    await expect(reader.findById(2, 1, 0)).rejects.toThrow();
    await expect(reader.findById(2, 1, -1)).rejects.toThrow();
    await expect(reader.findById(2, 1, 1.5)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('returns null when the carrier does not exist', async () => {
    const { executor } = fakeExecutor([]);
    const reader = createMysqlCarriersReader(executor, 'ps_');

    const result = await reader.findById(999, 1, 1);

    expect(result).toBeNull();
  });

  it('maps a row from snake_case to camelCase, delay included as-is', async () => {
    const { executor } = fakeExecutor([sampleRow]);
    const reader = createMysqlCarriersReader(executor, 'ps_');

    const result = await reader.findById(2, 1, 1);

    expect(result).toEqual({
      carrierId: 2,
      referenceId: 2,
      name: 'Despacho a domicilio',
      delay: '3 a 5 días hábiles',
    });
  });

  it('maps a row with delay: null when carrier_lang has no matching row (LEFT JOIN, not an error)', async () => {
    const { executor } = fakeExecutor([{ ...sampleRow, delay: null } as unknown as RowDataPacket]);
    const reader = createMysqlCarriersReader(executor, 'ps_');

    const result = await reader.findById(2, 1, 1);

    expect(result).toEqual({
      carrierId: 2,
      referenceId: 2,
      name: 'Despacho a domicilio',
      delay: null,
    });
  });

  it('maps a timeout error code to PrestashopTimeoutError', async () => {
    const reader = createMysqlCarriersReader(throwingExecutor({ code: 'ETIMEDOUT' }), 'ps_');

    await expect(reader.findById(2, 1, 1)).rejects.toBeInstanceOf(PrestashopTimeoutError);
  });

  it('maps a connection-refused error code to PrestashopUnavailableError', async () => {
    const reader = createMysqlCarriersReader(throwingExecutor({ code: 'ECONNREFUSED' }), 'ps_');

    await expect(reader.findById(2, 1, 1)).rejects.toBeInstanceOf(PrestashopUnavailableError);
  });

  it('propagates an unclassified error unchanged instead of guessing', async () => {
    const reader = createMysqlCarriersReader(throwingExecutor(new Error('weird driver error')), 'ps_');

    await expect(reader.findById(2, 1, 1)).rejects.toThrow('weird driver error');
  });
});
