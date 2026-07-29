import { describe, expect, it } from 'vitest';
import { buildContractFieldDocs } from '../../scripts/audits/commercial-summary/lib/contract-proposal.js';

// CP-R1-T07A section 11: the proposed CustomerCommercialSummary type has exactly these
// 12 fields — this test locks the field-doc generator to that exact set, so a future
// edit that silently drops or renames a field's documentation fails loudly.
const EXPECTED_FIELDS = [
  'totalOrders',
  'totalSpentTaxIncl',
  'averageOrderValueTaxIncl',
  'firstOrderAt',
  'lastOrderAt',
  'daysSinceLastOrder',
  'purchaseFrequencyDays',
  'totalUnitsPurchased',
  'distinctProductsPurchased',
  'cancelledOrderCount',
  'refundedOrderCount',
  'currencyIsoCode',
];

describe('buildContractFieldDocs', () => {
  it('documents exactly the 12 fields of the proposed contract, no more, no fewer', () => {
    const docs = buildContractFieldDocs();

    expect(docs.map((doc) => doc.field)).toEqual(EXPECTED_FIELDS);
  });

  it('never documents a field outside the proposed contract (no operationalStage, trackingNumber, etc.)', () => {
    const docs = buildContractFieldDocs();
    const fieldNames = new Set(docs.map((doc) => doc.field));

    expect(fieldNames.has('operationalStage')).toBe(false);
    expect(fieldNames.has('trackingNumber')).toBe(false);
    expect(fieldNames.has('netSpent')).toBe(false);
  });

  it('fills in all six documentation facets for every field (source/filter/formula/nullability/precision/limitations)', () => {
    const docs = buildContractFieldDocs();

    for (const doc of docs) {
      expect(doc.source.length, `${doc.field}.source`).toBeGreaterThan(0);
      expect(doc.filter.length, `${doc.field}.filter`).toBeGreaterThan(0);
      expect(doc.formula.length, `${doc.field}.formula`).toBeGreaterThan(0);
      expect(doc.nullability.length, `${doc.field}.nullability`).toBeGreaterThan(0);
      expect(doc.precision.length, `${doc.field}.precision`).toBeGreaterThan(0);
      expect(doc.limitations.length, `${doc.field}.limitations`).toBeGreaterThan(0);
    }
  });

  it('documents totalSpentTaxIncl as gross (bruto), never claiming it is net of refunds', () => {
    const docs = buildContractFieldDocs();
    const totalSpent = docs.find((doc) => doc.field === 'totalSpentTaxIncl');

    expect(totalSpent?.limitations.toLowerCase()).toContain('bruto');
  });

  it('documents purchaseFrequencyDays as null when totalOrders < 2', () => {
    const docs = buildContractFieldDocs();
    const frequency = docs.find((doc) => doc.field === 'purchaseFrequencyDays');

    expect(frequency?.nullability).toContain('totalOrders < 2');
  });

  it('documents monetary fields as string type, never number (decimal precision)', () => {
    const docs = buildContractFieldDocs();
    const totalSpent = docs.find((doc) => doc.field === 'totalSpentTaxIncl');
    const aov = docs.find((doc) => doc.field === 'averageOrderValueTaxIncl');

    expect(totalSpent?.type).toBe('string');
    expect(aov?.type).toBe('string');
  });
});
