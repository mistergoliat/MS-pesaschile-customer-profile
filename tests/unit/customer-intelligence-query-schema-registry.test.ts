import { describe, expect, it } from 'vitest';
import { allowedAggregationsFor, allowedOperatorsFor, getRegisteredFields, lookupField } from '../../src/domain/customer-intelligence-query/schema-registry.js';

describe('schema-registry (task Section 8/9)', () => {
  it('exposes exactly the commercial (18) + rfm (5) + cluster (6) + customer (1) = 30 fields', () => {
    expect(getRegisteredFields()).toHaveLength(30);
  });

  it('lookupField resolves a known field and returns null for an unknown one', () => {
    expect(lookupField('commercial.totalSpentTaxIncl')?.logicalName).toBe('commercial.totalSpentTaxIncl');
    expect(lookupField('commercial.secretField')).toBeNull();
  });

  it('never exposes rScore/fScore/mScore/rfmCode/segmentCode/clusterId as anything but nullable (task Section 18)', () => {
    for (const name of ['rfm.rScore', 'rfm.fScore', 'rfm.mScore', 'rfm.rfmCode', 'rfm.segmentCode', 'cluster.clusterId', 'cluster.distanceToCentroid', 'cluster.modelVersion']) {
      expect(lookupField(name)?.nullable).toBe(true);
    }
  });

  it('every commercial field except purchaseFrequencyDays is non-nullable (task Section 6 CP-R3-T01)', () => {
    for (const f of getRegisteredFields().filter((x) => x.source === 'commercial')) {
      const expected = f.logicalName === 'commercial.purchaseFrequencyDays';
      expect(f.nullable).toBe(expected);
    }
  });

  it('reuses the task-provided exact descriptions verbatim (task Section 35 — no hallucinated semantics)', () => {
    expect(lookupField('commercial.totalSpentTaxIncl')?.description).toBe(
      'Lifetime total_paid_tax_incl over valid orders included by Customer Analytics Population B.',
    );
    expect(lookupField('rfm.segmentCode')?.description).toBe(
      'Segment produced by the selected persisted RFM snapshot; nullable when the customer is outside that snapshot population.',
    );
    expect(lookupField('cluster.clusterId')?.description).toBe(
      'Cluster assignment produced by the selected behavioral clustering snapshot; ID is meaningful only within its modelVersion.',
    );
    expect(lookupField('cluster.modelVersion')?.description).toContain('clusterId values are comparable only within this modelVersion');
  });

  it('string/datetime fields never allow sum/avg (task Section 58)', () => {
    for (const f of getRegisteredFields().filter((x) => x.type === 'string' || x.type === 'datetime')) {
      expect(allowedAggregationsFor(f)).not.toContain('sum');
      expect(allowedAggregationsFor(f)).not.toContain('avg');
    }
  });

  it('integer/decimal fields allow the full aggregation set', () => {
    for (const f of getRegisteredFields().filter((x) => x.type === 'integer' || x.type === 'decimal')) {
      expect(allowedAggregationsFor(f)).toEqual(['count', 'count_distinct', 'sum', 'avg', 'min', 'max']);
    }
  });

  it('string fields never allow range operators (gt/gte/lt/lte/between)', () => {
    for (const f of getRegisteredFields().filter((x) => x.type === 'string')) {
      for (const op of ['gt', 'gte', 'lt', 'lte', 'between'] as const) {
        expect(allowedOperatorsFor(f)).not.toContain(op);
      }
    }
  });

  it('no field logicalName/description contains a PII-shaped substring', () => {
    const forbidden = ['email', 'phone', 'rut', 'address', 'firstname', 'lastname', 'birthday'];
    for (const f of getRegisteredFields()) {
      const haystack = `${f.logicalName} ${f.description}`.toLowerCase();
      for (const word of forbidden) {
        expect(haystack).not.toContain(word);
      }
    }
  });
});
