import { describe, expect, it } from 'vitest';
import { getAnalyticalSchema } from '../../src/application/customer-intelligence-query/get-analytical-schema.js';
import { assertNoPiiInAnalyticalValue } from '../../src/domain/customer-intelligence-query/pii-guard.js';
import { CUSTOMER_INTELLIGENCE_QUERY_SCHEMA_VERSION } from '../../src/domain/customer-intelligence-query/contracts.js';
import { CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION } from '../../src/domain/customer-intelligence/index.js';

describe('getAnalyticalSchema (task Section 34/74)', () => {
  it('carries schemaVersion and the read model version it composes over', () => {
    const schema = getAnalyticalSchema();
    expect(schema.schemaVersion).toBe(CUSTOMER_INTELLIGENCE_QUERY_SCHEMA_VERSION);
    expect(schema.readModelVersion).toBe(CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION);
    expect(schema.fields.length).toBeGreaterThan(0);
  });

  it('never exposes a physical column/table identifier (task Section 8)', () => {
    const schema = getAnalyticalSchema();
    for (const field of schema.fields) {
      expect(field).not.toHaveProperty('sqlExpression');
      const json = JSON.stringify(field);
      expect(json).not.toMatch(/customer_feature_snapshot_row|customer_rfm_snapshot_row|customer_cluster_snapshot_row|customer_cluster_model|\bfr\.|\brr\.|\bcr\.|\bcm\.|\bci\./);
    }
  });

  it('every field declares allowedOperators and allowedAggregations', () => {
    for (const field of getAnalyticalSchema().fields) {
      expect(Array.isArray(field.allowedOperators)).toBe(true);
      expect(Array.isArray(field.allowedAggregations)).toBe(true);
      expect(field.allowedOperators.length).toBeGreaterThan(0);
    }
  });

  it('is PII-free end to end (task Section 61)', () => {
    expect(() => assertNoPiiInAnalyticalValue(getAnalyticalSchema())).not.toThrow();
  });
});
