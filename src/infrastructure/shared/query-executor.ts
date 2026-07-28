import type { Pool, RowDataPacket } from 'mysql2/promise';

// Thin seam over mysql2 so domain/application code never imports mysql2 directly, and so
// adapter tests can inject a fake executor instead of mocking the mysql2 pool.
export type QueryExecutor = {
  execute(sql: string, params: readonly unknown[]): Promise<RowDataPacket[]>;
};

export function createQueryExecutor(pool: Pool, queryTimeoutMs: number): QueryExecutor {
  return {
    async execute(sql, params) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        { sql, timeout: queryTimeoutMs },
        [...params] as Array<string | number | null>,
      );
      return rows;
    },
  };
}
