import { describe, expect, it } from 'vitest';
import {
  AUDIENCE_DEFINITION_VERSION, AUDIENCE_FIELD_REGISTRY_V1, audienceDefinitionChecksum, canonicalAudienceJson,
  canonicalizeAudienceDefinition, evaluateAudienceFilter, normalizeAudienceDecimal,
  validateAudienceDefinition, type AudienceEvaluationContextV1, type AudienceRowV1,
} from '../../src/domain/customer-intelligence-audience/index.js';
import { compileAudienceSql } from '../../src/application/customer-intelligence-audience/compile-audience-sql.js';
import { createAudienceContextResolver } from '../../src/application/customer-intelligence-audience/context-resolver.js';
import { evaluateAudienceRows } from '../../src/application/customer-intelligence-audience/evaluate-audience.js';

const scalar = (field: string, operator: string, value?: unknown): any => ({ kind: 'SCALAR', field, operator, ...(value === undefined ? {} : { value }) });
const affinity = (extra: Record<string, unknown> = {}): any => ({ kind: 'HAS_AFFINITY', axis: 'DISCIPLINE', code: 'HYROX', ...extra });
const definition = (root: any): any => ({ definitionVersion: AUDIENCE_DEFINITION_VERSION, root });
const context: AudienceEvaluationContextV1 = {
  contextVersion: 'customer-intelligence-audience-context-v1', referenceTime: '2026-09-01T00:00:00.000Z',
  population: { universeId: 'customer-analytics-population-b-v1', identityAuthority: 'prestashop_customer', policyVersion: 'population-v1', populationSize: 3, populationChecksum: 'f'.repeat(64) },
  lineage: {
    feature: { snapshotId: '4', referenceTime: '2026-09-01T00:00:00.000Z', featureVersion: 'features-v1', populationPolicyVersion: 'population-v1', featureDatasetChecksum: 'a'.repeat(64) },
    rfm: { snapshotId: '2', referenceTime: '2026-08-01T00:00:00.000Z', calculationVersion: 'rfm-v1', segmentVersion: 'segment-v1', datasetChecksum: 'b'.repeat(64) },
    cluster: { snapshotId: '3', referenceTime: '2026-08-01T00:00:00.000Z', modelId: '10', modelVersion: 'cluster-v1', assignmentChecksum: 'c'.repeat(64) },
    clv: { snapshotId: '5', snapshotKey: 'clv-key', referenceTime: '2026-08-01T00:00:00.000Z', generatedAt: '2026-08-01T01:00:00.000Z', modelVersion: 'clv-v1', estimatorPolicyVersion: 'policy-v1', horizonMonths: 12, currencyIsoCode: 'CLP', outputChecksum: 'd'.repeat(64) },
    commercialAffinity: { snapshotId: '4', referenceTime: '2026-08-01T00:00:00.000Z', calculationVersion: 'affinity-v1', productSemanticSnapshotId: 'semantic-1', productSemanticSchemaVersion: 'schema-1', ontologyVersion: 'ontology-1', ontologyHash: 'e'.repeat(64), sourceSemanticChecksum: '1'.repeat(64), consumerSemanticChecksum: '2'.repeat(64), affinityDatasetChecksum: '3'.repeat(64), populationChecksum: '4'.repeat(64) },
  }, resolutionPolicyVersion: 'customer-intelligence-audience-lineage-v1',
};
const row = (id: number, changes: Partial<AudienceRowV1> = {}): AudienceRowV1 => ({ customerId: id, feature: { validOrders: 2, purchaseFrequencyDays: null, totalSpentTaxIncl: '100.00', lastOrderAt: '2026-01-01T00:00:00.000Z' }, rfm: { segmentCode: 'AT_RISK_HIGH_VALUE', segmentVersion: 'segment-v1', rfmCode: '555', recencyDays: 180, frequencyOrders: 2, grossOrderValueTaxIncl: '100.00', recencyScore: 2, frequencyScore: 3, monetaryScore: 4 }, cluster: { clusterId: 1, modelVersion: 'cluster-v1' }, clv: { expectedRevenueTaxIncl: '500.00', expectedOrders: '2.000000', estimateSupportLevel: 'SUPPORTED' }, affinityPopulationMember: true, affinityRows: [{ affinityAxis: 'DISCIPLINE', affinityCode: 'HYROX', score: '0.30', supportingOrderCount: 1, supportingProductCount: 1, supportingSpend: '10.00', explicitEvidenceCoverage: '1', lastEvidenceAt: '2026-08-01T00:00:00.000Z' }], ...changes });

describe('Audience field registry and validation', () => {
  it('contains only fixed approved fields', () => expect(AUDIENCE_FIELD_REGISTRY_V1.has('customer.email' as never)).toBe(false));
  it.each(['rfm.segmentCode', 'rfm.recencyDays', 'rfm.frequencyOrders', 'rfm.grossOrderValueTaxIncl', 'cluster.clusterId', 'cluster.modelVersion', 'clv.expectedRevenueTaxIncl', 'clv.expectedOrders', 'clv.estimateSupportLevel', 'commercial.validOrders', 'commercial.purchaseFrequencyDays'])('accepts supported field %s', (field) => { const type = AUDIENCE_FIELD_REGISTRY_V1.get(field as never)?.type; const value = type === 'integer' ? 1 : type === 'decimal' ? '1' : 'x'; expect(validateAudienceDefinition(definition(scalar(field, 'EQ', value))).ok).toBe(true); });
  it('rejects arbitrary field', () => expect(validateAudienceDefinition(definition(scalar('fr.email', 'EQ', 'x'))).ok).toBe(false));
  it('rejects arbitrary operator', () => expect(validateAudienceDefinition(definition(scalar('rfm.rfmCode', 'LIKE', '5'))).ok).toBe(false));
  it('rejects wrong integer type', () => expect(validateAudienceDefinition(definition(scalar('rfm.recencyDays', 'GTE', '5'))).ok).toBe(false));
  it('rejects wrong string type', () => expect(validateAudienceDefinition(definition(scalar('rfm.rfmCode', 'EQ', 5))).ok).toBe(false));
  it('accepts all scalar operators', () => expect(['EQ', 'NEQ', 'IN', 'NOT_IN', 'GT', 'GTE', 'LT', 'LTE', 'BETWEEN', 'IS_NULL', 'IS_NOT_NULL'].every((op) => validateAudienceDefinition(definition(scalar('rfm.rfmCode', op, op === 'IS_NULL' || op === 'IS_NOT_NULL' ? undefined : op === 'IN' || op === 'NOT_IN' ? ['5'] : op === 'BETWEEN' ? ['4', '6'] : '5'))).ok)).toBe(true));
  it('rejects empty AND', () => expect(validateAudienceDefinition(definition({ kind: 'AND', children: [] })).ok).toBe(false));
  it('rejects empty OR', () => expect(validateAudienceDefinition(definition({ kind: 'OR', children: [] })).ok).toBe(false));
  it('rejects missing NOT child', () => expect(validateAudienceDefinition(definition({ kind: 'NOT' })).ok).toBe(false));
  it('rejects depth over five', () => { let root: any = scalar('rfm.rfmCode', 'EQ', '5'); for (let i = 0; i < 6; i += 1) root = { kind: 'NOT', child: root }; expect(validateAudienceDefinition(definition(root)).ok).toBe(false); });
  it('rejects more than twenty conditions', () => expect(validateAudienceDefinition(definition({ kind: 'AND', children: Array.from({ length: 21 }, () => scalar('rfm.rfmCode', 'EQ', '5')) })).ok).toBe(false));
  it('rejects more than five hundred IN values', () => expect(validateAudienceDefinition(definition(scalar('rfm.rfmCode', 'IN', Array.from({ length: 501 }, (_, i) => String(i))))).ok).toBe(false));
  it('rejects inverted BETWEEN', () => expect(validateAudienceDefinition(definition(scalar('rfm.recencyDays', 'BETWEEN', [5, 1]))).ok).toBe(false));
  it('rejects null as EQ value', () => expect(validateAudienceDefinition(definition(scalar('rfm.rfmCode', 'EQ', null))).ok).toBe(false));
  it('accepts explicit null test', () => expect(validateAudienceDefinition(definition(scalar('commercial.purchaseFrequencyDays', 'IS_NULL'))).ok).toBe(true));
  it('validates affinity axis and opaque code syntax', () => expect(validateAudienceDefinition(definition(affinity())).ok).toBe(true));
  it('does not reject unobserved affinity code', () => expect(validateAudienceDefinition(definition(affinity({ code: 'CATALOG_CODE_NOT_OBSERVED' }))).ok).toBe(true));
  it('rejects empty affinity code', () => expect(validateAudienceDefinition(definition(affinity({ code: '   ' }))).ok).toBe(false));
  it('rejects invalid affinity axis', () => expect(validateAudienceDefinition(definition(affinity({ axis: 'OTHER' }))).ok).toBe(false));
  it('rejects negative affinity count', () => expect(validateAudienceDefinition(definition(affinity({ minSupportingOrderCount: -1 }))).ok).toBe(false));
  it('rejects out-of-range affinity score', () => expect(validateAudienceDefinition(definition(affinity({ minScore: '1.1' }))).ok).toBe(false));
  it('rejects invalid last-evidence timestamp', () => expect(validateAudienceDefinition(definition(affinity({ lastEvidenceAt: { operator: 'GTE', value: 'tomorrow' } }))).ok).toBe(false));
});

describe('Audience canonicalization', () => {
  it('is independent of object key order', () => {
    const one = definition(scalar('rfm.rfmCode', 'EQ', '5'));
    const two = { root: { operator: 'EQ', value: '5', field: 'rfm.rfmCode', kind: 'SCALAR' }, definitionVersion: AUDIENCE_DEFINITION_VERSION };
    expect(canonicalAudienceJson(one)).toBe(canonicalAudienceJson(two as any));
  });
  it('sorts AND children', () => {
    const one = definition({ kind: 'AND', children: [scalar('rfm.rfmCode', 'EQ', '5'), scalar('rfm.segmentCode', 'EQ', 'A')] });
    const two = definition({ kind: 'AND', children: [scalar('rfm.segmentCode', 'EQ', 'A'), scalar('rfm.rfmCode', 'EQ', '5')] });
    expect(canonicalAudienceJson(one)).toBe(canonicalAudienceJson(two));
  });
  it('sorts OR children', () => {
    const one = definition({ kind: 'OR', children: [scalar('rfm.rfmCode', 'EQ', '5'), scalar('rfm.segmentCode', 'EQ', 'A')] });
    const two = definition({ kind: 'OR', children: [scalar('rfm.segmentCode', 'EQ', 'A'), scalar('rfm.rfmCode', 'EQ', '5')] });
    expect(canonicalAudienceJson(one)).toBe(canonicalAudienceJson(two));
  });
  it('normalizes IN values', () => expect(canonicalAudienceJson(definition(scalar('rfm.rfmCode', 'IN', ['3', '1', '3', '2'])))).toContain('["1","2","3"]'));
  it('removes duplicate boolean children', () => expect((canonicalizeAudienceDefinition(definition({ kind: 'AND', children: [scalar('rfm.rfmCode', 'EQ', '5'), scalar('rfm.rfmCode', 'EQ', '5')] })).root as any).children).toHaveLength(1));
  it.each([['001.2300', '1.23'], ['1e3', '1000'], ['0.000', '0'], ['0005', '5'], ['10.500', '10.5']])('normalizes decimal %s', (input, expected) => expect(normalizeAudienceDecimal(input)).toBe(expected));
  it('produces deterministic checksum', () => expect(audienceDefinitionChecksum(definition(scalar('rfm.rfmCode', 'EQ', '5')))).toBe(audienceDefinitionChecksum(definition(scalar('rfm.rfmCode', 'EQ', '5')))));
  it('distinguishes semantic definitions', () => expect(audienceDefinitionChecksum(definition(scalar('rfm.rfmCode', 'EQ', '5')))).not.toBe(audienceDefinitionChecksum(definition(scalar('rfm.rfmCode', 'EQ', '6')))));
  it('does not perform theorem rewriting', () => expect((canonicalizeAudienceDefinition(definition({ kind: 'AND', children: [scalar('rfm.rfmCode', 'EQ', '5'), { kind: 'OR', children: [scalar('rfm.rfmCode', 'EQ', '5'), scalar('rfm.rfmCode', 'EQ', '6')] }] })).root as any).kind).toBe('AND'));
});

describe('Audience three-valued logic, nulls, and affinity', () => {
  const truthCases: Array<['TRUE' | 'FALSE' | 'UNKNOWN', 'TRUE' | 'FALSE' | 'UNKNOWN', 'TRUE' | 'FALSE' | 'UNKNOWN']> = [['TRUE', 'TRUE', 'TRUE'], ['TRUE', 'FALSE', 'FALSE'], ['TRUE', 'UNKNOWN', 'UNKNOWN'], ['FALSE', 'TRUE', 'FALSE'], ['FALSE', 'FALSE', 'FALSE'], ['FALSE', 'UNKNOWN', 'FALSE'], ['UNKNOWN', 'TRUE', 'UNKNOWN'], ['UNKNOWN', 'FALSE', 'FALSE'], ['UNKNOWN', 'UNKNOWN', 'UNKNOWN']];
  it.each(truthCases)('AND %s %s = %s', (left, right, expected) => { const rfmValue = left === 'TRUE' ? '5' : left === 'FALSE' ? '6' : null; const clusterValue = right === 'TRUE' ? 'cluster-v1' : right === 'FALSE' ? 'cluster-v2' : null; const actual = evaluateAudienceFilter({ kind: 'AND', children: [scalar('rfm.rfmCode', 'EQ', '5'), scalar('cluster.modelVersion', 'EQ', 'cluster-v1')] } as any, row(1, { rfm: { rfmCode: rfmValue }, cluster: { modelVersion: clusterValue } })); expect(actual).toBe(expected); });
  it.each(truthCases)('OR %s %s follows dominance', (left, right) => { const rfmValue = left === 'TRUE' ? '5' : left === 'FALSE' ? '6' : null; const clusterValue = right === 'TRUE' ? 'cluster-v1' : right === 'FALSE' ? 'cluster-v2' : null; const expected = left === 'TRUE' || right === 'TRUE' ? 'TRUE' : left === 'FALSE' && right === 'FALSE' ? 'FALSE' : 'UNKNOWN'; const actual = evaluateAudienceFilter({ kind: 'OR', children: [scalar('rfm.rfmCode', 'EQ', '5'), scalar('cluster.modelVersion', 'EQ', 'cluster-v1')] } as any, row(1, { rfm: { rfmCode: rfmValue }, cluster: { modelVersion: clusterValue } })); expect(actual).toBe(expected); });
  it.each([['TRUE', 'FALSE'], ['FALSE', 'TRUE'], ['UNKNOWN', 'UNKNOWN']] as const)('NOT is explicit for %s', (value, expected) => { const source = value === 'UNKNOWN' ? null : value === 'TRUE' ? '5' : '6'; expect(evaluateAudienceFilter({ kind: 'NOT', child: scalar('rfm.rfmCode', 'EQ', '5') } as any, row(1, { rfm: { rfmCode: source } }))).toBe(expected); });
  it('supports explicit nullable IS_NULL', () => expect(evaluateAudienceFilter(scalar('commercial.purchaseFrequencyDays', 'IS_NULL'), row(1))).toBe('TRUE'));
  it('distinguishes null from missing component', () => expect(evaluateAudienceFilter(scalar('commercial.purchaseFrequencyDays', 'IS_NULL'), row(1, { feature: {} }))).toBe('UNKNOWN'));
  it('treats zero as a real value', () => expect(evaluateAudienceFilter(scalar('commercial.validOrders', 'EQ', 0), row(1, { feature: { validOrders: 0 } }))).toBe('TRUE'));
  it('returns affinity TRUE for one matching row', () => expect(evaluateAudienceFilter(affinity(), row(1))).toBe('TRUE'));
  it('returns affinity FALSE for eligible customer without requested row', () => expect(evaluateAudienceFilter(affinity(), row(1, { affinityRows: [] }))).toBe('FALSE'));
  it('returns affinity UNKNOWN outside population', () => expect(evaluateAudienceFilter(affinity(), row(1, { affinityPopulationMember: false }))).toBe('UNKNOWN'));
  it('requires all affinity qualifiers on one row', () => expect(evaluateAudienceFilter(affinity({ minScore: '0.9', minSupportingProductCount: 5 }), row(1, { affinityRows: [{ affinityAxis: 'DISCIPLINE', affinityCode: 'HYROX', score: '0.9', supportingProductCount: 1 }] }))).toBe('FALSE'));
  it('accepts passing affinity qualifiers', () => expect(evaluateAudienceFilter(affinity({ minScore: '0.30', minSupportingOrderCount: 1 }), row(1))).toBe('TRUE'));
  it('composes UNKNOWN through AND', () => expect(evaluateAudienceFilter({ kind: 'AND', children: [scalar('rfm.rfmCode', 'EQ', '5'), affinity()] } as any, row(1, { rfm: null, affinityPopulationMember: false }))).toBe('UNKNOWN'));
  it('composes TRUE through OR', () => expect(evaluateAudienceFilter({ kind: 'OR', children: [scalar('rfm.rfmCode', 'EQ', '5'), affinity()] } as any, row(1))).toBe('TRUE'));
});

describe('Audience context, SQL, and evaluation result', () => {
  const feature: any = { snapshotId: '10', featureVersion: 'features-v1', populationPolicyVersion: 'population-v1', referenceTime: new Date('2026-08-01T00:00:00.000Z'), generatedAt: new Date('2026-08-01T01:00:00.000Z'), publishedAt: new Date('2026-08-01T02:00:00.000Z'), populationSize: 3, sourceDatasetChecksum: 'a'.repeat(64), featureDatasetChecksum: 'b'.repeat(64), status: 'published' };
  const headers: any = { getPublishedRfmSnapshotHeaders: async () => [{ ...context.lineage.rfm, snapshotId: '1', referenceTime: '2026-07-01T00:00:00.000Z' }, { ...context.lineage.rfm, snapshotId: '9', referenceTime: '2026-08-02T00:00:00.000Z' }], getPublishedClusterSnapshotHeaders: async () => [{ ...context.lineage.cluster, snapshotId: '2', referenceTime: '2026-08-01T00:00:00.000Z' }, { ...context.lineage.cluster, snapshotId: '1', referenceTime: '2026-08-01T00:00:00.000Z' }], getPublishedClvSnapshotHeaders: async () => [context.lineage.clv], getPublishedAffinitySnapshotHeaders: async () => [context.lineage.commercialAffinity] };
  it('anchors context to feature snapshot', async () => { const result = await createAudienceContextResolver({ featureSnapshotReader: { getLatestPublishedSnapshot: async () => feature, getSnapshotById: async () => feature, getRow: async () => null }, snapshotHeaderReader: headers }).resolveCurrent(); expect(result.status === 'available' && result.context.referenceTime).toBe('2026-08-01T00:00:00.000Z'); });
  it('excludes future snapshots', async () => { const result = await createAudienceContextResolver({ featureSnapshotReader: { getLatestPublishedSnapshot: async () => feature, getSnapshotById: async () => feature, getRow: async () => null }, snapshotHeaderReader: headers }).resolveCurrent(); expect(result.status === 'available' && result.context.lineage.rfm?.snapshotId).toBe('1'); });
  it('uses deterministic id tie-break', async () => { const result = await createAudienceContextResolver({ featureSnapshotReader: { getLatestPublishedSnapshot: async () => feature, getSnapshotById: async () => feature, getRow: async () => null }, snapshotHeaderReader: headers }).resolveCurrent(); expect(result.status === 'available' && result.context.lineage.cluster?.snapshotId).toBe('2'); });
  it('resolves CLV at or before anchor', async () => { const result = await createAudienceContextResolver({ featureSnapshotReader: { getLatestPublishedSnapshot: async () => feature, getSnapshotById: async () => feature, getRow: async () => null }, snapshotHeaderReader: headers }).resolveCurrent(); expect(result.status === 'available' && result.context.lineage.clv?.snapshotId).toBe('5'); });
  it('returns feature-not-found as typed unavailable result', async () => { const result = await createAudienceContextResolver({ featureSnapshotReader: { getLatestPublishedSnapshot: async () => null, getSnapshotById: async () => null, getRow: async () => null }, snapshotHeaderReader: headers }).resolveCurrent(); expect(result).toMatchObject({ status: 'unavailable', reason: 'FEATURE_SNAPSHOT_NOT_FOUND' }); });
  it('compiles fixed SELECT-only SQL', () => { const compiled = compileAudienceSql(context, scalar('rfm.recencyDays', 'GTE', 180) as any); expect(compiled.sql).toMatch(/^SELECT/); expect(compiled.sql).toContain('customer_feature_snapshot_row'); expect(compiled.sql).toContain('rr.recency_days >= ?'); expect(compiled.sql).not.toContain('customer.email'); });
  it('compiles affinity as EXISTS without multiplying base rows', () => { const compiled = compileAudienceSql(context, affinity() as any); expect(compiled.sql).toContain('EXISTS (SELECT 1 FROM customer_commercial_affinity_snapshot_population'); expect(compiled.sql).toContain('EXISTS (SELECT 1 FROM customer_commercial_affinity_snapshot_row'); expect(compiled.sql).not.toMatch(/JOIN customer_commercial_affinity_snapshot_row/); });
  it('binds values instead of interpolating them', () => { const compiled = compileAudienceSql(context, scalar('rfm.rfmCode', 'EQ', "x' OR 1=1 --") as any); expect(compiled.sql).toContain('rr.rfm_code = ?'); expect(compiled.sql).not.toContain("x' OR 1=1"); expect(compiled.params).toContain("x' OR 1=1 --"); });
  it('blocks referenced unavailable component', () => expect(evaluateAudienceRows(definition(scalar('clv.expectedOrders', 'GT', '1')), [row(1)], { context, availability: { feature: 'AVAILABLE', rfm: 'AVAILABLE', cluster: 'AVAILABLE', clv: 'UNAVAILABLE', commercialAffinity: 'AVAILABLE' } }).status).toBe('blocked'));
  it('does not block unreferenced unavailable component', () => expect(evaluateAudienceRows(definition(scalar('rfm.rfmCode', 'EQ', '555')), [row(1)], { context, availability: { feature: 'AVAILABLE', rfm: 'AVAILABLE', cluster: 'AVAILABLE', clv: 'UNAVAILABLE', commercialAffinity: 'UNAVAILABLE' } }).status).toBe('completed'));
  it('preserves true false unknown counts', () => { const result = evaluateAudienceRows(definition(affinity()), [row(1), row(2, { affinityRows: [] }), row(3, { affinityPopulationMember: false })], { context }); expect(result).toMatchObject({ trueCount: 1, falseCount: 1, unknownCount: 1, populationUniverseCount: 3, matchedCount: 1 }); });
  it('orders preview customer ids ascending', () => { const result = evaluateAudienceRows(definition(scalar('rfm.rfmCode', 'EQ', '555')), [row(9), row(2), row(5)], { context, previewLimit: 2 }); expect(result.status === 'completed' && result.previewMembers.map((m) => m.customerId)).toEqual([2, 5]); });
  it('preview truncation does not change match count', () => { const result = evaluateAudienceRows(definition(scalar('rfm.rfmCode', 'EQ', '555')), [row(1), row(2), row(3)], { context, previewLimit: 1 }); expect(result).toMatchObject({ matchedCount: 3, returnedCount: 1, truncated: true }); });
  it('rejects preview above hard bound', async () => { const resolver = { resolveCurrent: async () => ({ status: 'available' as const, context, availability: { feature: 'AVAILABLE' as const, rfm: 'AVAILABLE' as const, cluster: 'AVAILABLE' as const, clv: 'AVAILABLE' as const, commercialAffinity: 'AVAILABLE' as const } }), resolveForFeatureSnapshot: async () => ({ status: 'available' as const, context, availability: { feature: 'AVAILABLE' as const, rfm: 'AVAILABLE' as const, cluster: 'AVAILABLE' as const, clv: 'AVAILABLE' as const, commercialAffinity: 'AVAILABLE' as const } }) }; const { createEvaluateAudience } = await import('../../src/application/customer-intelligence-audience/evaluate-audience.js'); const result = await createEvaluateAudience({ contextResolver: resolver, sqlExecutor: { execute: async () => [] } })({ definition: definition(scalar('rfm.rfmCode', 'EQ', '555')), previewLimit: 1001 }); expect(result.status === 'blocked' ? result.reason : null).toBe('BUDGET_EXCEEDED'); });
  it('blocks incompatible segment version', () => { const result = evaluateAudienceRows(definition(scalar('rfm.segmentVersion', 'EQ', 'other-version')), [row(1)], { context }); expect(result.status === 'blocked' ? result.reason : null).toBe('INCOMPATIBLE_SNAPSHOT'); });
});
