import { describe, expect, it } from 'vitest';
import { assertSafeSql, findForbiddenSqlPatterns } from '../../scripts/audits/rfm-population/lib/guardrails.js';
import { assertAggregateOnlySql } from '../../scripts/audits/rfm-population/lib/pii-guard.js';
import {
  buildPrestashopTables,
  crossShopCustomerCountSql,
  populationDatasetSql,
  shopLabelsSql,
  shopLifetimeTotalsSql,
  shopScopedActivePopulationSql,
} from '../../scripts/audits/rfm-population/lib/sql.js';
import {
  duplicateEmailGroupsSql,
  duplicateEmailOrderImpactSql,
  emailQualitySql,
  identityCoreCountsSql,
  lifetimeFrequencyThresholdsSql,
  potentialSharedAccountsSql,
} from '../../scripts/audits/rfm-population/lib/identity-quality-sql.js';
import {
  frequencyOutlierAccountFlagsSql,
  frequencyOutlierProfileSql,
  frequencyOutlierShopBreakdownSql,
} from '../../scripts/audits/rfm-population/lib/outlier-sql.js';

const tables = buildPrestashopTables('ps_');

function normalized(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toUpperCase();
}

describe('CP-R1-T10A extended SQL (sections 2/3/4)', () => {
  it('keeps identity-core, frequency-threshold, shared-account, outlier and multishop queries free of PII columns under the strict shared guardrail', () => {
    const strictQueries = [
      identityCoreCountsSql(tables),
      lifetimeFrequencyThresholdsSql(tables),
      potentialSharedAccountsSql(tables),
      frequencyOutlierProfileSql(tables),
      frequencyOutlierAccountFlagsSql(tables),
      frequencyOutlierShopBreakdownSql(tables),
      shopLifetimeTotalsSql(tables),
      crossShopCustomerCountSql(tables),
      shopScopedActivePopulationSql(tables),
      shopLabelsSql('ps_shop'),
    ];
    for (const sql of strictQueries) {
      expect(findForbiddenSqlPatterns(sql)).toEqual([]);
      expect(() => assertSafeSql(sql, 'extended-sql')).not.toThrow();
      expect(normalized(sql)).not.toContain('SELECT *');
      expect(normalized(sql)).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|TRUNCATE|DROP|CREATE|GRANT|REVOKE)\b/);
    }
  });

  it('rejects the email-aggregate queries under the strict shared guardrail (why they need the relaxed one)', () => {
    const emailQueries = [emailQualitySql(tables), duplicateEmailGroupsSql(tables), duplicateEmailOrderImpactSql(tables)];
    for (const sql of emailQueries) {
      expect(() => assertSafeSql(sql, 'strict-should-reject')).toThrow(/forbidden column: email/);
    }
  });

  it('accepts the same email-aggregate queries under the relaxed aggregate-only guardrail', () => {
    const emailQueries = [emailQualitySql(tables), duplicateEmailGroupsSql(tables), duplicateEmailOrderImpactSql(tables)];
    for (const sql of emailQueries) {
      expect(() => assertAggregateOnlySql(sql, 'relaxed-should-accept')).not.toThrow();
      expect(normalized(sql)).not.toContain('SELECT *');
    }
  });

  it('validates unsafe shop table identifiers before interpolation', () => {
    expect(() => shopLabelsSql('ps_shop; DROP TABLE ps_customer')).toThrow();
    expect(shopLabelsSql('ps_shop')).toContain('FROM ps_shop');
  });

  it('extends populationDatasetSql additively (existing window aggregates untouched, new non-PII columns added)', () => {
    const sql = normalized(populationDatasetSql(tables));
    expect(sql).toContain('O.VALID = 1');
    // CP-R1-T10A-3 correction: lifetime bounded by date_add < windowEndExclusive.
    expect(sql).toContain('COUNT(DISTINCT CASE WHEN O.VALID = 1 AND O.DATE_ADD < ? THEN O.ID_ORDER ELSE NULL END)');
    expect(sql).toContain('LIFETIMEDISTINCTSHOPS');
    expect(sql).toContain('CUSTOMERDELETEDFLAG');
    expect(sql).toContain('LEFT JOIN PS_CUSTOMER C');
    expect(findForbiddenSqlPatterns(populationDatasetSql(tables))).toEqual([]);
  });

  it('locates the frequency outlier only through a non-selected scalar subquery predicate', () => {
    for (const sql of [frequencyOutlierProfileSql(tables), frequencyOutlierAccountFlagsSql(tables), frequencyOutlierShopBreakdownSql(tables)]) {
      const upper = normalized(sql);
      expect(upper).toContain('ORDER BY COUNT(*) DESC');
      expect(upper).toContain('LIMIT 1');
      // id_customer may appear inside the locating subquery predicate, but the outermost
      // (published) SELECT list — everything between the first SELECT and the first FROM —
      // must never return it directly.
      const outerSelectList = upper.slice(upper.indexOf('SELECT') + 'SELECT'.length, upper.indexOf('FROM'));
      expect(outerSelectList).not.toContain('ID_CUSTOMER');
    }
  });
});
