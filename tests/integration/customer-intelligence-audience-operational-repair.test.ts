import { describe, expect, it } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { createEvaluateAudience } from '../../src/application/customer-intelligence-audience/index.js';
import { createMysqlAudienceSqlExecutor } from '../../src/infrastructure/customer-intelligence-audience/mysql-audience-sql-executor.js';
import type { AudienceEvaluationContextV1 } from '../../src/domain/customer-intelligence-audience/index.js';
import type { QueryExecutor } from '../../src/infrastructure/shared/query-executor.js';

const context: AudienceEvaluationContextV1 = {
  contextVersion: 'customer-intelligence-audience-context-v1',
  referenceTime: '2026-09-01T00:00:00.000Z',
  population: {
    universeId: 'customer-analytics-population-b-v1', identityAuthority: 'prestashop_customer',
    policyVersion: 'population-v1', populationSize: 3, populationChecksum: 'f'.repeat(64),
  },
  lineage: {
    feature: { snapshotId: '2', referenceTime: '2026-09-01T00:00:00.000Z', featureVersion: 'features-v1', populationPolicyVersion: 'population-v1', featureDatasetChecksum: 'a'.repeat(64) },
    rfm: { snapshotId: '1', referenceTime: '2026-08-18T00:00:00.000Z', calculationVersion: 'rfm-v1', segmentVersion: 'rfm-commercial-v1' },
    cluster: { snapshotId: '1', referenceTime: '2026-08-20T22:49:05.000Z', modelId: '1', modelVersion: 'cluster-v1' },
    clv: { snapshotId: '1', snapshotKey: 'clv-1', referenceTime: '2026-09-01T00:00:00.000Z', generatedAt: '2026-09-01T00:01:00.000Z', modelVersion: 'clv-v1', estimatorPolicyVersion: 'clv-policy-v1', horizonMonths: 12, currencyIsoCode: 'CLP' },
    commercialAffinity: { snapshotId: '4', referenceTime: '2026-09-01T00:00:00.000Z', calculationVersion: 'affinity-v1', productSemanticSnapshotId: 'semantic-1', productSemanticSchemaVersion: 'schema-v1', ontologyVersion: 'ontology-v1', ontologyHash: 'b'.repeat(64), sourceSemanticChecksum: 'c'.repeat(64), consumerSemanticChecksum: 'd'.repeat(64), affinityDatasetChecksum: 'e'.repeat(64), populationChecksum: '1'.repeat(64) },
  },
  resolutionPolicyVersion: 'customer-intelligence-audience-lineage-v1',
};

describe('Audience operational SQL wiring', () => {
  it('preserves the complete feature population with distinct component snapshot ids', async () => {
    const calls: Array<{ readonly params: readonly unknown[] }> = [];
    const queryExecutor: QueryExecutor = {
      async execute(_sql, params) {
        calls.push({ params });
        return [
          { customerId: 100, truth: 'TRUE' },
          { customerId: 200, truth: 'FALSE' },
          { customerId: 300, truth: 'UNKNOWN' },
        ] as unknown as RowDataPacket[];
      },
    };
    const resolver = {
      resolveCurrent: async () => ({ status: 'available' as const, context, availability: { feature: 'AVAILABLE' as const, rfm: 'AVAILABLE' as const, cluster: 'AVAILABLE' as const, clv: 'AVAILABLE' as const, commercialAffinity: 'AVAILABLE' as const } }),
      resolveForFeatureSnapshot: async () => ({ status: 'available' as const, context, availability: { feature: 'AVAILABLE' as const, rfm: 'AVAILABLE' as const, cluster: 'AVAILABLE' as const, clv: 'AVAILABLE' as const, commercialAffinity: 'AVAILABLE' as const } }),
    };
    const evaluateAudience = createEvaluateAudience({ contextResolver: resolver, sqlExecutor: createMysqlAudienceSqlExecutor(queryExecutor), clock: () => '2026-09-02T00:00:00.000Z' });
    const result = await evaluateAudience({ definition: { definitionVersion: 'customer-intelligence-audience-definition-v1', root: { kind: 'SCALAR', field: 'rfm.recencyDays', operator: 'LTE', value: 180 } } });
    expect(result).toMatchObject({ status: 'completed', populationUniverseCount: 3, trueCount: 1, falseCount: 1, unknownCount: 1, matchedCount: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toEqual([180, '1', '1', '1', '2']);
  });

  it('pairs a segment code with the selected RFM version without a false incompatibility block', async () => {
    const queryExecutor: QueryExecutor = { execute: async () => [{ customerId: 100, truth: 'TRUE' }] as unknown as RowDataPacket[] };
    const resolver = {
      resolveCurrent: async () => ({ status: 'available' as const, context, availability: { feature: 'AVAILABLE' as const, rfm: 'AVAILABLE' as const, cluster: 'AVAILABLE' as const, clv: 'AVAILABLE' as const, commercialAffinity: 'AVAILABLE' as const } }),
      resolveForFeatureSnapshot: async () => ({ status: 'available' as const, context, availability: { feature: 'AVAILABLE' as const, rfm: 'AVAILABLE' as const, cluster: 'AVAILABLE' as const, clv: 'AVAILABLE' as const, commercialAffinity: 'AVAILABLE' as const } }),
    };
    const evaluateAudience = createEvaluateAudience({ contextResolver: resolver, sqlExecutor: createMysqlAudienceSqlExecutor(queryExecutor) });
    const result = await evaluateAudience({ definition: { definitionVersion: 'customer-intelligence-audience-definition-v1', root: { kind: 'AND', children: [{ kind: 'SCALAR', field: 'rfm.segmentCode', operator: 'EQ', value: 'LOYAL' }, { kind: 'SCALAR', field: 'rfm.segmentVersion', operator: 'EQ', value: 'rfm-commercial-v1' }] } } });
    expect(result.status).toBe('completed');
  });
});
