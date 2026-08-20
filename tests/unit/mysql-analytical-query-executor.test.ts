import { describe, expect, it, vi } from 'vitest';
import { createMysqlAnalyticalQueryExecutor } from '../../src/infrastructure/customer-intelligence-query/mysql-analytical-query-executor.js';
import type { QueryExecutor } from '../../src/infrastructure/shared/query-executor.js';
import { AnalyticsTimeoutError, AnalyticsUnavailableError } from '../../src/application/customer-profile/errors.js';

describe('createMysqlAnalyticalQueryExecutor', () => {
  it('runs the compiled sql/params through the underlying QueryExecutor and returns its rows', async () => {
    const rows = [{ clusterId: 0, customers: 4 }];
    const execute = vi.fn(async () => rows);
    const executor = createMysqlAnalyticalQueryExecutor({ execute } as unknown as QueryExecutor);

    const result = await executor.execute({ sql: 'SELECT 1', params: ['a', 1] });

    expect(result).toBe(rows);
    expect(execute).toHaveBeenCalledWith('SELECT 1', ['a', 1]);
  });

  it('rejects a compiled statement that is not SELECT-only, before ever calling the DB (task Section 28)', async () => {
    const execute = vi.fn();
    const executor = createMysqlAnalyticalQueryExecutor({ execute } as unknown as QueryExecutor);

    await expect(executor.execute({ sql: 'DELETE FROM customer_feature_snapshot_row', params: [] })).rejects.toThrow(/only ever executes SELECT/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('maps a timeout error through the shared analytics error taxonomy, never a raw DB error (task Section 27/64)', async () => {
    const dbError = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    const execute = vi.fn(async () => {
      throw dbError;
    });
    const executor = createMysqlAnalyticalQueryExecutor({ execute } as unknown as QueryExecutor);

    await expect(executor.execute({ sql: 'SELECT 1', params: [] })).rejects.toBeInstanceOf(AnalyticsTimeoutError);
  });

  it('maps an unavailable-connection error through the same taxonomy', async () => {
    const dbError = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
    const execute = vi.fn(async () => {
      throw dbError;
    });
    const executor = createMysqlAnalyticalQueryExecutor({ execute } as unknown as QueryExecutor);

    await expect(executor.execute({ sql: 'SELECT 1', params: [] })).rejects.toBeInstanceOf(AnalyticsUnavailableError);
  });
});
