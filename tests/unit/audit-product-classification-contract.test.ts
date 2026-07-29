import { describe, expect, it } from 'vitest';
import { buildObservedPreferencesContractDocs } from '../../scripts/audits/product-classification/lib/contract-proposal.js';

const EXPECTED_FIELDS = [
  'topCategories',
  'topBrands',
  'classifiedCategorySpentTaxIncl',
  'unclassifiedCategorySpentTaxIncl',
  'classifiedBrandSpentTaxIncl',
  'unclassifiedBrandSpentTaxIncl',
  'categoryDiversity',
  'brandDiversity',
  'dominantCategoryId',
  'dominantManufacturerId',
  'calculatedAt',
];

describe('buildObservedPreferencesContractDocs', () => {
  it('documents the proposed T09 observed preferences contract fields only', () => {
    const docs = buildObservedPreferencesContractDocs();

    expect(docs.map((doc) => doc.field)).toEqual(EXPECTED_FIELDS);
    expect(docs.map((doc) => doc.field)).not.toContain('preferredProductType');
  });

  it('documents source, filter, formula, nullability, precision and limitations for every field', () => {
    for (const doc of buildObservedPreferencesContractDocs()) {
      expect(doc.source).not.toBe('');
      expect(doc.filter).not.toBe('');
      expect(doc.formula).not.toBe('');
      expect(doc.nullability).not.toBe('');
      expect(doc.precision).not.toBe('');
      expect(doc.limitations).not.toBe('');
    }
  });

  it('keeps money as six-decimal strings and spendShare as number percent', () => {
    const docs = buildObservedPreferencesContractDocs();

    expect(docs.find((doc) => doc.field === 'classifiedCategorySpentTaxIncl')?.type).toBe('string');
    expect(docs.find((doc) => doc.field === 'topCategories')?.precision).toContain('spendShare');
  });
});

