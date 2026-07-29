import { describe, expect, it } from 'vitest';
import { assertSafeSql, findForbiddenSqlPatterns } from '../../scripts/audits/product-classification/lib/guardrails.js';
import {
  buildTables,
  catalogShopExistsSql,
  categoryCoverageSql,
  categoryRankingSql,
  combinedCustomerPreferenceCandidateSql,
  customerCategoryPreferenceCandidateSql,
  customerCoverageCandidateSql,
  customerManufacturerPreferenceCandidateSql,
  manufacturerCoverageSql,
  manufacturerRankingSql,
  multicategorySql,
  productCoverageSql,
  productShopDivergenceSql,
  reconciliationSql,
  requiredProductClassificationSuffixes,
  universeSummarySql,
} from '../../scripts/audits/product-classification/lib/sql.js';

const tables = buildTables('ps_');

const ALL_QUERIES = [
  universeSummarySql(tables),
  catalogShopExistsSql(tables),
  productCoverageSql(tables),
  productShopDivergenceSql(tables),
  categoryCoverageSql(tables),
  categoryRankingSql(tables),
  multicategorySql(tables),
  manufacturerCoverageSql(tables),
  manufacturerRankingSql(tables),
  reconciliationSql(tables),
  customerCategoryPreferenceCandidateSql(tables),
  customerManufacturerPreferenceCandidateSql(tables),
  customerCoverageCandidateSql(tables),
  combinedCustomerPreferenceCandidateSql(tables),
];

function normalized(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toUpperCase();
}

describe('product classification audit SQL', () => {
  it('targets all required PrestaShop classification tables', () => {
    expect(requiredProductClassificationSuffixes()).toEqual([
      'orders',
      'order_detail',
      'product',
      'product_shop',
      'category',
      'category_lang',
      'category_product',
      'manufacturer',
    ]);
  });

  it('builds safe prefixed table names and rejects unsafe prefixes', () => {
    expect(buildTables('ps_').orders).toBe('ps_orders');
    expect(() => buildTables('ps_;DROP_')).toThrow();
  });

  it('keeps all audit queries read-only, aggregate-only and free of PII/order references', () => {
    for (const sql of ALL_QUERIES) {
      expect(findForbiddenSqlPatterns(sql)).toEqual([]);
      expect(() => assertSafeSql(sql, 'product-classification')).not.toThrow();
      expect(normalized(sql)).not.toContain('SELECT *');
      expect(normalized(sql)).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|TRUNCATE|DROP|CREATE|GRANT|REVOKE)\b/);
      expect(normalized(sql)).not.toMatch(/\b(EMAIL|FIRSTNAME|LASTNAME|PHONE|ADDRESS|RUT|REFERENCE)\b/);
    }
  });

  it('uses only valid orders as the commercial purchase filter', () => {
    expect(normalized(universeSummarySql(tables))).toContain('WHERE O.VALID = 1');
    expect(normalized(categoryCoverageSql(tables))).toContain('WHERE O.VALID = 1');
    expect(normalized(manufacturerCoverageSql(tables))).toContain('WHERE O.VALID = 1');
  });

  it('keeps deleted products through LEFT JOIN for coverage but INNER JOINs current catalog for classified rankings', () => {
    expect(normalized(productCoverageSql(tables))).toContain('LEFT JOIN PS_PRODUCT P ON P.ID_PRODUCT = OD.PRODUCT_ID');
    expect(normalized(categoryRankingSql(tables))).toContain('INNER JOIN PS_PRODUCT P ON P.ID_PRODUCT = OD.PRODUCT_ID');
    expect(normalized(manufacturerRankingSql(tables))).toContain('INNER JOIN PS_MANUFACTURER M');
  });

  it('audits default category, product_shop multishop and multicategory without financial double counting', () => {
    expect(normalized(catalogShopExistsSql(tables))).toContain('FROM PS_PRODUCT_SHOP');
    expect(normalized(catalogShopExistsSql(tables))).toContain('WHERE ID_SHOP = ?');
    expect(normalized(categoryCoverageSql(tables))).toContain('PS.CONFIGUREDSHOPDEFAULT');
    expect(normalized(productShopDivergenceSql(tables))).toContain('PRODUCTSWITHMULTIPLESHOPROWS');
    expect(normalized(multicategorySql(tables))).toContain('COUNT(CP.ID_CATEGORY) AS CATEGORYCOUNT');
    expect(normalized(categoryRankingSql(tables))).not.toContain('CATEGORY_PRODUCT');
  });

  it('is compatible with MariaDB 10.6 constructs used by this audit', () => {
    for (const sql of ALL_QUERIES) {
      const text = normalized(sql);
      expect(text).not.toContain('ANY_VALUE');
      expect(text).not.toContain('QUALIFY ');
      expect(text).not.toContain('FILTER (');
    }
  });
});
