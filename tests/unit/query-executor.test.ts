import type { Pool, RowDataPacket } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { createQueryExecutor } from '../../src/infrastructure/shared/query-executor.js';

function fakePool(rows: RowDataPacket[]) {
  const executeMock = vi.fn(async (_options: unknown, _params: unknown) => [rows, []]);
  const pool = { execute: executeMock } as unknown as Pool;
  return { pool, executeMock };
}

describe('createQueryExecutor', () => {
  it('passes sql, timeout and params to pool.execute in the right shape and order', async () => {
    const { pool, executeMock } = fakePool([]);
    const executor = createQueryExecutor(pool, 3000);

    await executor.execute('SELECT * FROM table WHERE id = ?', ['123']);

    expect(executeMock).toHaveBeenCalledTimes(1);
    const [options, params] = executeMock.mock.calls[0]!;
    expect(options).toEqual({ sql: 'SELECT * FROM table WHERE id = ?', timeout: 3000 });
    expect(params).toEqual(['123']);
  });

  it('returns the rows from the pool unaltered', async () => {
    const rows = [{ id: '1' } as unknown as RowDataPacket];
    const { pool } = fakePool(rows);
    const executor = createQueryExecutor(pool, 3000);

    const result = await executor.execute('SELECT 1', []);

    expect(result).toBe(rows);
  });
});
