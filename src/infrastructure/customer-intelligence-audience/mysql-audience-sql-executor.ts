import type { RowDataPacket } from 'mysql2/promise';
import type { AudienceSqlExecutor, CompiledAudienceSql, AudienceSqlRow } from '../../application/customer-intelligence-audience/ports.js';
import type { QueryExecutor } from '../shared/query-executor.js';
import { mapAnalyticsReadError } from '../customer-analytics/analytics-read-error.js';

export function createMysqlAudienceSqlExecutor(queryExecutor: QueryExecutor): AudienceSqlExecutor {
  return {
    async execute(compiled: CompiledAudienceSql): Promise<readonly AudienceSqlRow[]> {
      if (!/^\s*SELECT\b/iu.test(compiled.sql) || /;|\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/iu.test(compiled.sql)) throw new Error('Audience evaluator accepts one SELECT statement only');
      try {
        const rows = await queryExecutor.execute(compiled.sql, compiled.params);
        return (rows as RowDataPacket[]).map((row) => ({ customerId: Number(row.customerId), truth: row.truth as AudienceSqlRow['truth'] }));
      } catch (error) { throw mapAnalyticsReadError(error); }
    },
  };
}
