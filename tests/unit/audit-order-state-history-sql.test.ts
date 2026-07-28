import { describe, expect, it } from 'vitest';
import {
  buildHistoryEventsPerOrderSql,
  buildLatestHistoryDuplicatesSql,
  buildLatestHistorySql,
  buildOrphanedHistorySql,
} from '../../scripts/audits/order-state-semantics/lib/history-sql.js';

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toUpperCase();
}

function assertReadOnly(sql: string): void {
  expect(sql).not.toMatch(/\bCREATE\s+TEMPORARY\s+TABLE\b/i);
  expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
}

describe('buildLatestHistorySql', () => {
  it('uses ROW_NUMBER()/OVER when window functions are supported', () => {
    const sql = buildLatestHistorySql('ps_', true);

    expect(normalizeSql(sql)).toContain('ROW_NUMBER()');
    expect(normalizeSql(sql)).toContain('OVER (');
    assertReadOnly(sql);
  });

  it('does not use ROW_NUMBER()/OVER on the pre-8.0 fallback', () => {
    const sql = buildLatestHistorySql('ps_', false);

    expect(normalizeSql(sql)).not.toContain('ROW_NUMBER()');
    expect(normalizeSql(sql)).not.toContain(' OVER (');
    assertReadOnly(sql);
  });

  it('does not use WITH (CTEs) on the pre-8.0 fallback either — CTEs also require MySQL 8.0.1+', () => {
    const sql = buildLatestHistorySql('ps_', false);

    expect(normalizeSql(sql)).not.toMatch(/^WITH\b/);
    expect(normalizeSql(sql)).not.toContain(') AS LATEST_DATES');
  });

  it('interpolates the given prefix into both orders and order_history', () => {
    const sql = buildLatestHistorySql('custom_', true);

    expect(normalizeSql(sql)).toContain('FROM CUSTOM_ORDER_HISTORY');
    expect(normalizeSql(sql)).toContain('FROM CUSTOM_ORDERS');
  });

  it('never selects individual order ids in the final projection (aggregated only)', () => {
    const windowSql = normalizeSql(buildLatestHistorySql('ps_', true));
    const fallbackSql = normalizeSql(buildLatestHistorySql('ps_', false));

    expect(windowSql).toContain('COUNT(*) AS ORDER_COUNT');
    expect(fallbackSql).toContain('COUNT(*) AS ORDER_COUNT');
  });
});

describe('buildLatestHistoryDuplicatesSql', () => {
  it('does not require window functions and stays read-only', () => {
    const sql = buildLatestHistoryDuplicatesSql('ps_');

    expect(normalizeSql(sql)).not.toContain('ROW_NUMBER()');
    assertReadOnly(sql);
    expect(normalizeSql(sql)).toContain('HAVING COUNT(DISTINCT OH.ID_ORDER_STATE) > 1');
  });
});

describe('buildHistoryEventsPerOrderSql', () => {
  it('aggregates min/avg/max events per order without listing individual orders', () => {
    const sql = buildHistoryEventsPerOrderSql('ps_');

    const normalized = normalizeSql(sql);
    expect(normalized).toContain('MIN(EVENTS_PER_ORDER)');
    expect(normalized).toContain('AVG(EVENTS_PER_ORDER)');
    expect(normalized).toContain('MAX(EVENTS_PER_ORDER)');
    assertReadOnly(sql);
  });
});

describe('buildOrphanedHistorySql', () => {
  it('detects rows with a missing order or a missing state via LEFT JOIN', () => {
    const sql = buildOrphanedHistorySql('ps_');

    const normalized = normalizeSql(sql);
    expect(normalized).toContain('LEFT JOIN PS_ORDERS O ON O.ID_ORDER = OH.ID_ORDER');
    expect(normalized).toContain('LEFT JOIN PS_ORDER_STATE OS ON OS.ID_ORDER_STATE = OH.ID_ORDER_STATE');
    assertReadOnly(sql);
  });
});
