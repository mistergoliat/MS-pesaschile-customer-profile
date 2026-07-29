import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const REQUIRED_DOCS = [
  'docs/audits/product-classification/CP-R1-T09A-product-classification-audit.md',
  'docs/audits/product-classification/CP-R1-T09A-runtime-recommendation.md',
  'docs/audits/product-classification/CP-R1-T09A-category-coverage.md',
  'docs/audits/product-classification/CP-R1-T09A-category-hierarchy.md',
  'docs/audits/product-classification/CP-R1-T09A-manufacturer-coverage.md',
] as const;

const REQUIRED_DECISIONS = [
  'ps_product_shop.id_category_default',
  'PRESTASHOP_CATALOG_SHOP_ID',
  'id_lang',
  'Default category',
  'not used for spend attribution',
  'Deleted products',
  '95.28%',
  '85.05%',
  'spendShare',
  'Unclassified spend',
  'gross spend descending, units descending, then id ascending',
  'defaults to 10 items and caps at 20',
  'Runtime direct reads',
  'separate endpoint',
  'curated commercial taxonomy is mandatory before clustering',
  'rawCategoryId',
  'commercialFamilyId',
  'manufacturerId',
  'diversity',
  'unclassifiedShare',
] as const;

function readDoc(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('CP-R1-T09A audit documentation', () => {
  it('has Decisions and Follow-up sections in every required document, with no Open Decisions section', () => {
    for (const path of REQUIRED_DOCS) {
      const content = readDoc(path);

      expect(content, path).toContain('## Decisions');
      expect(content, path).toContain('## Follow-up');
      expect(content, path).not.toContain('## Open Decisions');
    }
  });

  it('documents the 16 closed decisions explicitly', () => {
    const combinedDocs = REQUIRED_DOCS.map(readDoc).join('\n');

    for (const decisionEvidence of REQUIRED_DECISIONS) {
      expect(combinedDocs).toContain(decisionEvidence);
    }
  });

  it('documents categoryId 2 evidence and the clustering limitation', () => {
    const categoryCoverage = readDoc('docs/audits/product-classification/CP-R1-T09A-category-coverage.md');

    expect(categoryCoverage).toContain('categoryId 2');
    expect(categoryCoverage).toContain('CATEGORÍAS');
    expect(categoryCoverage).toContain('10146068032.735700');
    expect(categoryCoverage).toContain('lines 164816');
    expect(categoryCoverage).toContain('distinctProducts 1289');
    expect(categoryCoverage).toContain(
      'The category default presents high technical coverage, but not enough commercial granularity for fine clustering or purchase-family definition.',
    );
    expect(categoryCoverage).toContain('Clustering must not use categoryId 2 as the primary feature.');
    expect(categoryCoverage).toContain('preferredProductType remains outside T09.');
  });
});
