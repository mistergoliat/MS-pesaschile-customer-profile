import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertSafeSql, findForbiddenSqlPatterns } from '../../scripts/audits/rfm-population/lib/guardrails.js';
import {
  activePopulationSql,
  buildPrestashopTables,
  duplicatePrestashopLinksCrmSql,
  identityCoverageCrmSql,
  identityCoveragePrestashopSql,
  populationDatasetSql,
  requiredRfmPrestashopSuffixes,
  validOrderEvidenceSql,
} from '../../scripts/audits/rfm-population/lib/sql.js';

const tables = buildPrestashopTables('ps_');
const ALL_QUERIES = [
  validOrderEvidenceSql(tables),
  populationDatasetSql(tables),
  activePopulationSql(tables),
  identityCoveragePrestashopSql(tables),
  identityCoverageCrmSql(),
  duplicatePrestashopLinksCrmSql(),
];

function normalized(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toUpperCase();
}

describe('RFM population audit SQL', () => {
  it('targets only the required RFM source tables and validates prefixes', () => {
    expect(requiredRfmPrestashopSuffixes()).toEqual(['orders', 'customer']);
    expect(buildPrestashopTables('ps_').orders).toBe('ps_orders');
    expect(() => buildPrestashopTables('ps_;DROP')).toThrow();
  });

  it('keeps all queries read-only, aggregate-oriented and free of PII/order references', () => {
    for (const sql of ALL_QUERIES) {
      expect(findForbiddenSqlPatterns(sql)).toEqual([]);
      expect(() => assertSafeSql(sql, 'rfm-population')).not.toThrow();
      expect(normalized(sql)).not.toContain('SELECT *');
      expect(normalized(sql)).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|TRUNCATE|DROP|CREATE|GRANT|REVOKE)\b/);
      expect(normalized(sql)).not.toMatch(/\b(EMAIL|FIRSTNAME|LASTNAME|PHONE|ADDRESS|RUT|REFERENCE)\b/);
    }
  });

  it('uses valid = 1, distinct orders, total_paid_tax_incl and explicit window params', () => {
    const populationSql = normalized(populationDatasetSql(tables));
    const activeSql = normalized(activePopulationSql(tables));

    expect(populationSql).toContain('O.VALID = 1');
    expect(populationSql).toContain('COUNT(DISTINCT CASE WHEN O.VALID = 1 THEN O.ID_ORDER ELSE NULL END)');
    expect(populationSql).toContain('SUM(CASE WHEN O.VALID = 1 THEN O.TOTAL_PAID_TAX_INCL ELSE 0 END)');
    expect(activeSql).toContain('WHERE O.VALID = 1 AND O.DATE_ADD >= ? AND O.DATE_ADD < ?');
  });

  it('does not use state-paid semantics, server dates, lines, units or product/catalog tables', () => {
    const combinedSql = normalized(ALL_QUERIES.join('\n'));

    expect(combinedSql).not.toContain('CURRENT_DATE');
    expect(combinedSql).not.toContain('NOW()');
    expect(combinedSql).not.toContain('DATEDIFF');
    expect(combinedSql).not.toContain('ORDER_STATE');
    expect(combinedSql).not.toMatch(/\bPS_ORDER_STATE\.PAID\b|\bORDER_STATE\.PAID\b|\bPAID\s*=\s*1\b/);
    expect(combinedSql).not.toContain('ORDER_DETAIL');
    expect(combinedSql).not.toContain('PRODUCT');
    expect(combinedSql).not.toContain('CATEGORY');
    expect(combinedSql).not.toContain('MANUFACTURER');
  });

  it('keeps outputs ignored while preserving .gitkeep', () => {
    const gitignore = readFileSync('.gitignore', 'utf8');

    expect(gitignore).toContain('scripts/audits/rfm-population/outputs/*');
    expect(gitignore).toContain('!scripts/audits/rfm-population/outputs/.gitkeep');
  });
});
