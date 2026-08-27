import { describe, expect, it } from 'vitest';
import {
  EXPORT_DATA_MODEL,
  PRODUCT_EXPLORATION_CSV_COLUMNS,
  SOURCE_TABLE_MAP,
  XLSX_REVIEW_COLUMNS,
  findPiiLikeExportFields,
  normalizeEvidenceName,
} from '../../scripts/audits/product-intelligence-exploration/lib/model.js';

describe('CUSTOMER-INTELLIGENCE-R2-A00 export model', () => {
  it('defines the required external logical tables instead of raw database dumps', () => {
    expect(EXPORT_DATA_MODEL.map((entry) => entry.table)).toEqual([
      'Products',
      'Categories',
      'ProductCategories',
      'Features',
      'ProductFeatures',
      'Combinations',
      'SalesAggregates',
      'Relationships',
      'DataQuality',
    ]);
    expect(EXPORT_DATA_MODEL.find((entry) => entry.table === 'Products')).toMatchObject({
      primaryKey: 'productId',
      grain: 'one row per PrestaShop base product',
      required: true,
    });
  });

  it('keeps human review columns separate from the CSV export contract', () => {
    expect(XLSX_REVIEW_COLUMNS).toContain('review_primary_family');
    expect(PRODUCT_EXPLORATION_CSV_COLUMNS).not.toContain('review_primary_family');
  });

  it('does not expose customer PII-like fields in product exports', () => {
    expect(findPiiLikeExportFields(PRODUCT_EXPLORATION_CSV_COLUMNS)).toEqual([]);
    expect(findPiiLikeExportFields(['productId', 'email', 'uniqueCustomerCount'])).toEqual(['email']);
  });

  it('marks customer and address source tables as raw non-exports', () => {
    const blockedTables = SOURCE_TABLE_MAP.filter((entry) => entry.exportStrategy === 'do-not-export-raw').map((entry) => entry.table);

    expect(blockedTables).toContain('<prefix>customer');
    expect(blockedTables).toContain('<prefix>address');
  });

  it('normalizes names deterministically for duplicate-name evidence only', () => {
    expect(normalizeEvidenceName('Banco Olímpico 20 kg')).toBe('banco olimpico 20 kg');
    expect(normalizeEvidenceName('  Banco-Olimpico / 20KG ')).toBe('banco olimpico 20kg');
  });
});
