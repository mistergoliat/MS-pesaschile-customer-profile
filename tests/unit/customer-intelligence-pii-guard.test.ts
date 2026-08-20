import { describe, expect, it } from 'vitest';
import { assertNoPiiInIntelligenceValue } from '../../src/domain/customer-intelligence/pii-guard.js';

describe('assertNoPiiInIntelligenceValue (task Section 37)', () => {
  it('accepts a realistic CustomerIntelligenceRow-shaped object', () => {
    const row = {
      prestashopCustomerId: 22066,
      featureSnapshot: { snapshotId: '1', referenceTime: '2026-08-19T00:00:00.000Z', featureVersion: 'customer-analytics-features-v1' },
      commercial: { totalSpentTaxIncl: '56433.000000', discountShare: '0.000000' },
      rfm: { rScore: 3, fScore: 2, mScore: 4, rfmCode: 'R3F2M4', segmentCode: 'LOYAL' },
      cluster: { clusterId: 3, distanceToCentroid: 1.42, label: 'NEW_BURST_THEN_LAPSED_BUYERS' },
      contractVersion: 'customer-intelligence-read-model-v1',
    };
    expect(() => assertNoPiiInIntelligenceValue(row)).not.toThrow();
  });

  it('rejects a PII-shaped field name anywhere in the object graph', () => {
    expect(() => assertNoPiiInIntelligenceValue({ nested: { customerEmail: 'x' } })).toThrow(/PII-shaped field/);
  });

  it('rejects an email-shaped string value', () => {
    expect(() => assertNoPiiInIntelligenceValue({ note: 'contact joaquin@example.com' })).toThrow(/PII-shaped value/);
  });

  it('rejects a Chilean-RUT-shaped string value', () => {
    expect(() => assertNoPiiInIntelligenceValue({ value: '12.345.678-9' })).toThrow(/PII-shaped value/);
  });

  it('allows prestashopCustomerId/customerId as the explicit technical identifiers', () => {
    expect(() => assertNoPiiInIntelligenceValue({ prestashopCustomerId: 22066, customerId: 1 })).not.toThrow();
  });

  it('walks arrays and nested arrays (e.g. a batch of rows)', () => {
    expect(() => assertNoPiiInIntelligenceValue([{ prestashopCustomerId: 1 }, { customerEmail: 'x@y.com' }])).toThrow(/PII-shaped/);
  });
});
