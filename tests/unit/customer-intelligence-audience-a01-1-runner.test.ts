import { describe, expect, it } from 'vitest';
import {
  assertEvaluationInvariants,
  buildRepresentativeDefinitions,
  evaluationFingerprint,
} from '../../scripts/customer-intelligence-audience/a01-1-helpers.js';
import type { AudienceEvaluationResultV1 } from '../../src/domain/customer-intelligence-audience/index.js';

const context = {
  contextVersion: 'customer-intelligence-audience-context-v1',
  referenceTime: '2026-09-01T00:00:00.000Z',
  population: {
    universeId: 'customer-analytics-population-b-v1',
    identityAuthority: 'prestashop_customer',
    policyVersion: 'population-v1',
    populationSize: 3,
    populationChecksum: 'feature-checksum',
  },
  lineage: {
    feature: {
      snapshotId: '2', referenceTime: '2026-09-01T00:00:00.000Z', featureVersion: 'features-v1',
      populationPolicyVersion: 'population-v1', featureDatasetChecksum: 'feature-checksum',
    },
    rfm: null, cluster: null, clv: null, commercialAffinity: null,
  },
  resolutionPolicyVersion: 'customer-intelligence-audience-lineage-v1',
} as const;

describe('A01.1 operational runner helpers', () => {
  it('builds the fixed suite with discovered values and no SQL fragments', () => {
    const definitions = buildRepresentativeDefinitions({
      rfmSegmentCode: 'LOYAL',
      rfmSegmentVersion: 'rfm-v1',
      clusterId: 4,
      clusterModelVersion: 'cluster-v1',
      secondAffinity: { axis: 'USE_CONTEXT', code: 'HOME' },
    });
    expect(definitions.map((item) => item.name)).toEqual([
      'FEATURE', 'RAW_RFM', 'RFM_SEGMENT', 'CLUSTER', 'CLV', 'AFFINITY', 'MIXED', 'MULTI_AFFINITY_OR',
    ]);
    expect(JSON.stringify(definitions)).toContain('LOYAL');
    expect(JSON.stringify(definitions)).toContain('cluster-v1');
    expect(JSON.stringify(definitions)).toContain('HOME');
    expect(JSON.stringify(definitions)).not.toContain('SELECT');
  });

  it('enforces the persisted-evaluation invariants and fingerprints only deterministic fields', () => {
    const result: AudienceEvaluationResultV1 = {
      status: 'completed', resultVersion: 'customer-intelligence-audience-evaluation-v1',
      definitionVersion: 'customer-intelligence-audience-definition-v1', definitionChecksum: 'definition-checksum',
      audienceDefinitionChecksum: 'definition-checksum', evaluationId: null, evaluatedAt: '2026-09-02T00:00:00.000Z',
      referenceTime: context.referenceTime, populationUniverseCount: 3, trueCount: 2, falseCount: 1, unknownCount: 0,
      matchedCount: 2, returnedCount: 2, previewMembers: [{ customerId: 10 }, { customerId: 20 }],
      members: [{ customerId: 10 }, { customerId: 20 }], truncated: false, context,
      componentAvailability: { feature: 'AVAILABLE', rfm: 'AVAILABLE', cluster: 'AVAILABLE', clv: 'AVAILABLE', commercialAffinity: 'AVAILABLE' },
      durationMs: 12, performance: { queryDurationMs: 8, totalDurationMs: 12 },
      provenance: { definitionChecksum: 'definition-checksum', context: context.lineage }, warnings: [],
      canonicalDefinition: { definitionVersion: 'customer-intelligence-audience-definition-v1', root: { kind: 'SCALAR', field: 'commercial.validOrders', operator: 'GTE', value: 2 } },
    };
    expect(() => assertEvaluationInvariants(result, 1000)).not.toThrow();
    expect(evaluationFingerprint(result)).toEqual({
      definitionChecksum: 'definition-checksum', context, populationUniverseCount: 3,
      trueCount: 2, falseCount: 1, unknownCount: 0, matchedCount: 2, previewCustomerIds: [10, 20],
    });
  });
});
