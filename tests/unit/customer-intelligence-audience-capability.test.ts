import { describe, expect, it, vi } from 'vitest';
import { AUDIENCE_DEFINITION_VERSION } from '../../src/domain/customer-intelligence-audience/index.js';
import { createCustomerIntelligenceAudienceCapability } from '../../src/application/customer-intelligence-audience/capability.js';
import { createAudiencePreviewEnricher } from '../../src/application/customer-intelligence-audience/preview.js';
import { getAudienceCapabilitySchema } from '../../src/application/customer-intelligence-audience/schema.js';
import type { AudienceEvaluationContextV1, AudienceEvaluationResultV1 } from '../../src/domain/customer-intelligence-audience/index.js';
import type { AudiencePreviewReadRow } from '../../src/application/customer-intelligence-audience/ports.js';

const context: AudienceEvaluationContextV1 = {
  contextVersion: 'customer-intelligence-audience-context-v1', referenceTime: '2026-09-01T00:00:00.000Z',
  population: { universeId: 'customer-analytics-population-b-v1', identityAuthority: 'prestashop_customer', policyVersion: 'population-v1', populationSize: 2, populationChecksum: 'a'.repeat(64) },
  lineage: {
    feature: { snapshotId: '10', referenceTime: '2026-09-01T00:00:00.000Z', featureVersion: 'features-v1', populationPolicyVersion: 'population-v1', featureDatasetChecksum: 'b'.repeat(64) },
    rfm: null, cluster: null, clv: null, commercialAffinity: null,
  }, resolutionPolicyVersion: 'customer-intelligence-audience-lineage-v1',
};

const raw = (customerId: number): AudiencePreviewReadRow => ({
  customerId, validOrders: 2, totalSpentTaxIncl: '100.00', averageOrderValueTaxIncl: '50.00', firstOrderAt: '2025-01-01T00:00:00.000Z', lastOrderAt: '2026-08-01T00:00:00.000Z', daysSinceLastOrder: 31, purchaseFrequencyDays: '30.0',
  rfm: null, cluster: null, clv: null, affinityPopulationMember: false,
});

describe('Customer Intelligence Audience A02 capability', () => {
  it('derives schema metadata from the fixed registry and exposes the Catalog limitation', () => {
    const schema = getAudienceCapabilitySchema();
    expect(schema.fields.some((field) => field.fieldId === 'commercial.validOrders' && field.allowedOperators.includes('GTE'))).toBe(true);
    expect(schema.specialConditions.hasAffinity.allowedAxes).toEqual(['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT']);
    expect(schema.specialConditions.hasAffinity.code.enumerationStatus).toBe('CATALOG_REGISTRY_NOT_AVAILABLE');
    expect(schema.fields.some((field) => field.fieldId === 'customer.email')).toBe(false);
  });

  it('enriches all preview members with one bounded reader call and preserves lineage', async () => {
    const read = vi.fn(async () => [raw(2), raw(1)]);
    const preview = await createAudiencePreviewEnricher({ reader: { read } })({ context, customerIds: [2, 1], matchedCount: 2, limit: 50 });
    expect(read).toHaveBeenCalledTimes(1);
    expect(preview.rows.map((row) => row.customerId)).toEqual([2, 1]);
    expect(preview.lineage).toBe(context.lineage);
    expect(preview.rows[0]?.availability.commercialAffinity).toBe('UNAVAILABLE');
  });

  it.each([
    [0, 0, false],
    [43, 43, false],
    [100, 100, false],
    [101, 100, true],
    [45196, 100, true],
  ])('sets preview truncation from matchedCount=%s and returned=%s', async (matchedCount, returned, truncated) => {
    const customerIds = Array.from({ length: returned }, (_, index) => index + 1);
    const read = vi.fn(async () => customerIds.map(raw));
    const preview = await createAudiencePreviewEnricher({ reader: { read } })({ context, customerIds, matchedCount, limit: 100 });

    expect(preview.returned).toBe(returned);
    expect(preview.truncated).toBe(truncated);
  });

  it('keeps the evaluation result separate and unchanged when preview enrichment degrades', async () => {
    const evaluation = { status: 'completed', context, previewMembers: [{ customerId: 1 }], matchedCount: 1 } as unknown as AudienceEvaluationResultV1;
    const evaluateAudience = vi.fn(async () => evaluation);
    const capability = createCustomerIntelligenceAudienceCapability({
      evaluateAudience,
      previewEnricher: async () => ({ previewVersion: 'customer-intelligence-audience-preview-v1', limit: 50, returned: 0, rows: [], truncated: true, enrichmentStatus: 'degraded', degradedComponents: ['feature'], lineage: context.lineage }),
    });
    const result = await capability.evaluate({ definition: { definitionVersion: AUDIENCE_DEFINITION_VERSION, root: { kind: 'SCALAR', field: 'commercial.validOrders', operator: 'GTE', value: 1 } } });
    expect(result.evaluation).toBe(evaluation);
    expect(result.preview?.enrichmentStatus).toBe('degraded');
    expect(evaluateAudience).toHaveBeenCalledWith(expect.objectContaining({ previewLimit: 50 }));
  });
});
