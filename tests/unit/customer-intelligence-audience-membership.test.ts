import { describe, expect, it, vi } from 'vitest';
import {
  AUDIENCE_DEFINITION_VERSION,
  type AudienceDefinitionV1,
  type AudienceEvaluationContextV1,
  type AudienceSnapshotLineageV1,
} from '../../src/domain/customer-intelligence-audience/index.js';
import {
  createResolveAudienceMembership,
  type AudienceMembershipResolutionResultV1,
} from '../../src/application/customer-intelligence-audience/membership.js';
import type { AudienceSqlRow } from '../../src/application/customer-intelligence-audience/ports.js';

const featureLineage: AudienceSnapshotLineageV1['feature'] = {
  snapshotId: 'feature-10',
  referenceTime: '2026-09-01T00:00:00.000Z',
  featureVersion: 'features-v1',
  populationPolicyVersion: 'population-v1',
  featureDatasetChecksum: 'f'.repeat(64),
  populationChecksum: 'p'.repeat(64),
};

const fullLineage: AudienceSnapshotLineageV1 = {
  feature: featureLineage,
  rfm: {
    snapshotId: 'rfm-1', referenceTime: '2026-09-01T00:00:00.000Z', calculationVersion: 'rfm-v1',
    segmentVersion: 'segment-v1', datasetChecksum: 'r'.repeat(64),
  },
  cluster: {
    snapshotId: 'cluster-1', referenceTime: '2026-09-01T00:00:00.000Z', modelId: 'cluster-model',
    modelVersion: 'cluster-v1', populationPolicyVersion: 'population-v1', assignmentChecksum: 'c'.repeat(64),
  },
  clv: {
    snapshotId: 'clv-1', snapshotKey: 'clv-key-1', referenceTime: '2026-09-01T00:00:00.000Z',
    generatedAt: '2026-09-01T01:00:00.000Z', modelVersion: 'clv-v1', estimatorPolicyVersion: 'clv-policy-v1',
    horizonMonths: 12, currencyIsoCode: 'CLP', outputChecksum: 'v'.repeat(64),
  },
  commercialAffinity: {
    snapshotId: 'affinity-1', referenceTime: '2026-09-01T00:00:00.000Z', calculationVersion: 'affinity-v1',
    productSemanticSnapshotId: 'semantic-1', productSemanticSchemaVersion: 'schema-v1', ontologyVersion: 'ontology-v1',
    ontologyHash: 'o'.repeat(64), sourceSemanticChecksum: 's'.repeat(64), consumerSemanticChecksum: 'd'.repeat(64),
    affinityDatasetChecksum: 'a'.repeat(64), populationChecksum: 'q'.repeat(64),
  },
};

const scalar = (field: string, operator: string, value?: string | number): Record<string, unknown> => ({
  kind: 'SCALAR', field, operator, ...(value === undefined ? {} : { value }),
});

const featureDefinition: AudienceDefinitionV1 = {
  definitionVersion: AUDIENCE_DEFINITION_VERSION,
  root: scalar('commercial.validOrders', 'GTE', 1) as AudienceDefinitionV1['root'],
};

const rfmDefinition: AudienceDefinitionV1 = {
  definitionVersion: AUDIENCE_DEFINITION_VERSION,
  root: scalar('rfm.rfmCode', 'EQ', '555') as AudienceDefinitionV1['root'],
};

function contextFor(populationSize: number, lineage: AudienceSnapshotLineageV1 = fullLineage): AudienceEvaluationContextV1 {
  return {
    contextVersion: 'customer-intelligence-audience-context-v1',
    referenceTime: '2026-09-01T00:00:00.000Z',
    population: {
      universeId: 'customer-analytics-population-b-v1',
      identityAuthority: 'prestashop_customer',
      policyVersion: 'population-v1',
      populationSize,
      populationChecksum: 'population-'.concat(String(populationSize)),
    },
    lineage,
    resolutionPolicyVersion: 'customer-intelligence-audience-lineage-v1',
  };
}

function available(): {
  readonly feature: 'AVAILABLE';
  readonly rfm: 'AVAILABLE';
  readonly cluster: 'AVAILABLE';
  readonly clv: 'AVAILABLE';
  readonly commercialAffinity: 'AVAILABLE';
} {
  return { feature: 'AVAILABLE', rfm: 'AVAILABLE', cluster: 'AVAILABLE', clv: 'AVAILABLE', commercialAffinity: 'AVAILABLE' };
}

function rows(...truths: readonly (AudienceSqlRow['truth'])[]): AudienceSqlRow[] {
  return truths.map((truth, index) => ({ customerId: index + 1, truth }));
}

function createResolver(
  sourceRows: readonly { readonly customerId: number; readonly truth: unknown }[],
  context = contextFor(sourceRows.length),
) {
  return createResolveAudienceMembership({
    contextResolver: {
      resolveCurrent: async () => ({ status: 'available' as const, context, availability: available() }),
      resolveForFeatureSnapshot: async () => ({ status: 'available' as const, context, availability: available() }),
    },
    sqlExecutor: { execute: vi.fn(async () => sourceRows as readonly AudienceSqlRow[]) },
    clock: () => '2026-09-10T12:00:00.000Z',
  });
}

function completed(result: AudienceMembershipResolutionResultV1) {
  expect(result.status).toBe('completed');
  if (result.status !== 'completed') throw new Error(`Expected completed result, got ${result.reason}`);
  return result;
}

describe('A04.1 authoritative audience membership', () => {
  it.each([
    [['TRUE', 'TRUE', 'TRUE'], { population: 3, matched: 3, notMatched: 0, unknown: 0 }, [1, 2, 3]],
    [['FALSE', 'FALSE', 'FALSE'], { population: 3, matched: 0, notMatched: 3, unknown: 0 }, []],
    [['UNKNOWN', 'UNKNOWN', 'UNKNOWN'], { population: 3, matched: 0, notMatched: 0, unknown: 3 }, []],
    [['TRUE', 'FALSE', 'UNKNOWN', 'TRUE'], { population: 4, matched: 2, notMatched: 1, unknown: 1 }, [1, 4]],
  ] as const)('counts complete truth states and includes only TRUE (%s)', async (truth, counts, memberIds) => {
    const result = completed(await createResolver(rows(...truth))( { definition: featureDefinition } ));
    expect(result.counts).toEqual(counts);
    expect(result.members.map((member) => member.customerId)).toEqual(memberIds);
    expect(result.members.length).toBe(result.counts.matched);
    expect(result.counts.population).toBe(result.counts.matched + result.counts.notMatched + result.counts.unknown);
    expect(result.completeness).toBe('COMPLETE');
  });

  it('canonicalizes unordered complete rows and sorts members by customerId ASC', async () => {
    const context = contextFor(3);
    const result = completed(await createResolver([
      { customerId: 9, truth: 'TRUE' }, { customerId: 2, truth: 'FALSE' }, { customerId: 5, truth: 'TRUE' },
    ], context)({ definition: featureDefinition }));
    expect(result.members.map((member) => member.customerId)).toEqual([5, 9]);
    expect(result.evaluationChecksum).toBeDefined();
  });

  it.each([
    ['duplicate customer ID', [{ customerId: 1, truth: 'TRUE' }, { customerId: 1, truth: 'FALSE' }], 2, 'DUPLICATE_CUSTOMER_ID'],
    ['missing population row', [{ customerId: 1, truth: 'TRUE' }], 2, 'POPULATION_COUNT_MISMATCH'],
    ['invalid customer ID', [{ customerId: 0, truth: 'TRUE' }, { customerId: 2, truth: 'FALSE' }], 2, 'INVALID_CUSTOMER_ID'],
    ['unsafe customer ID', [{ customerId: Number.MAX_SAFE_INTEGER + 1, truth: 'TRUE' }, { customerId: 2, truth: 'FALSE' }], 2, 'INVALID_CUSTOMER_ID'],
    ['invalid truth', [{ customerId: 1, truth: 'MAYBE' }, { customerId: 2, truth: 'FALSE' }], 2, 'INVALID_TRUTH'],
  ] as const)('fails closed for %s', async (_label, sourceRows, populationSize, reason) => {
    const result = await createResolver(sourceRows, contextFor(populationSize))({ definition: featureDefinition });
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') expect(result.reason).toBe(reason);
  });

  it('does not use previewLimit as authoritative membership input or checksum input', async () => {
    const resolver = createResolver(rows('TRUE', 'FALSE', 'TRUE'));
    const first = completed(await resolver({ definition: featureDefinition, previewLimit: 0 } as ResolveAudienceMembershipRequestWithPreview));
    const second = completed(await resolver({ definition: featureDefinition, previewLimit: 100 } as ResolveAudienceMembershipRequestWithPreview));
    expect(first.members).toEqual([{ customerId: 1 }, { customerId: 3 }]);
    expect(first.evaluationChecksum).toBe(second.evaluationChecksum);
    expect(first.membershipChecksum).toBe(second.membershipChecksum);
  });

  it('keeps execution evaluatedAt out of both semantic checksums', async () => {
    const resolver = createResolver(rows('TRUE', 'FALSE'));
    const first = completed(await resolver({ definition: featureDefinition, evaluatedAt: '2026-09-10T12:00:00.000Z' }));
    const second = completed(await resolver({ definition: featureDefinition, evaluatedAt: '2026-09-11T12:00:00.000Z' }));
    expect(first.evaluatedAt).not.toBe(second.evaluatedAt);
    expect(first.evaluationChecksum).toBe(second.evaluationChecksum);
    expect(first.membershipChecksum).toBe(second.membershipChecksum);
  });

  it('resolves nested AND/OR/NOT definitions through the shared preparation path', async () => {
    const definition: AudienceDefinitionV1 = {
      definitionVersion: AUDIENCE_DEFINITION_VERSION,
      root: {
        kind: 'AND',
        children: [
          { kind: 'NOT', child: scalar('commercial.validOrders', 'LT', 1) as AudienceDefinitionV1['root'] },
          { kind: 'OR', children: [scalar('commercial.validOrders', 'GTE', 1) as AudienceDefinitionV1['root'], scalar('commercial.validOrders', 'EQ', 2) as AudienceDefinitionV1['root']] },
        ],
      },
    };
    const result = completed(await createResolver(rows('TRUE', 'FALSE'))({ definition }));
    expect(result.counts.matched).toBe(1);
  });

  it.each([
    ['HAS_AFFINITY', { kind: 'HAS_AFFINITY', axis: 'DISCIPLINE', code: 'HYROX' }],
    ['RFM', rfmDefinition.root],
    ['cluster', scalar('cluster.clusterId', 'EQ', 1)],
    ['CLV', scalar('clv.expectedOrders', 'GT', '1')],
    ['feature-only', featureDefinition.root],
  ] as const)('creates a completed membership for %s dependency', async (_name, root) => {
    const definition = { definitionVersion: AUDIENCE_DEFINITION_VERSION, root } as AudienceDefinitionV1;
    const result = completed(await createResolver(rows('TRUE', 'UNKNOWN'))({ definition }));
    expect(result.lineage.relevantSnapshotLineage.feature).toEqual(featureLineage);
    expect(result.members).toEqual([{ customerId: 1 }]);
  });

  it('retains only referenced component lineage and includes affinity Product Semantic lineage', async () => {
    const definition = { definitionVersion: AUDIENCE_DEFINITION_VERSION, root: { kind: 'HAS_AFFINITY', axis: 'DISCIPLINE', code: 'HYROX' } } as AudienceDefinitionV1;
    const result = completed(await createResolver(rows('TRUE'))({ definition }));
    expect(result.lineage.relevantSnapshotLineage).toEqual({ feature: featureLineage, commercialAffinity: fullLineage.commercialAffinity });
    expect(result.lineage.relevantSnapshotLineage.commercialAffinity?.productSemanticSnapshotId).toBe('semantic-1');
    expect(result.lineage.reproducibilityLevel).toBe('ACTIVE_SNAPSHOT_CONSISTENT');
  });

  it('excludes irrelevant lineage from checksums but changes when relevant lineage changes', async () => {
    const featureOnly = completed(await createResolver(rows('TRUE', 'FALSE'))({ definition: featureDefinition }));
    const irrelevantChanged = completed(await createResolver(rows('TRUE', 'FALSE'), contextFor(2, {
      ...fullLineage,
      clv: { ...fullLineage.clv!, outputChecksum: 'z'.repeat(64) },
    }))({ definition: featureDefinition }));
    expect(featureOnly.evaluationChecksum).toBe(irrelevantChanged.evaluationChecksum);
    expect(featureOnly.membershipChecksum).toBe(irrelevantChanged.membershipChecksum);

    const rfmChanged = completed(await createResolver(rows('TRUE', 'FALSE'), contextFor(2, {
      ...fullLineage,
      rfm: { ...fullLineage.rfm!, datasetChecksum: 'z'.repeat(64) },
    }))({ definition: rfmDefinition }));
    const rfmOriginal = completed(await createResolver(rows('TRUE', 'FALSE'))({ definition: rfmDefinition }));
    expect(rfmOriginal.evaluationChecksum).not.toBe(rfmChanged.evaluationChecksum);
    expect(rfmOriginal.membershipChecksum).not.toBe(rfmChanged.membershipChecksum);
  });

  it('is stable across definition key order and boolean child order', async () => {
    const first: AudienceDefinitionV1 = {
      definitionVersion: AUDIENCE_DEFINITION_VERSION,
      root: { kind: 'AND', children: [scalar('commercial.validOrders', 'GTE', 1) as AudienceDefinitionV1['root'], scalar('commercial.validOrders', 'LTE', 5) as AudienceDefinitionV1['root']] },
    };
    const second = {
      root: { children: [scalar('commercial.validOrders', 'LTE', 5), scalar('commercial.validOrders', 'GTE', 1)], kind: 'AND' },
      definitionVersion: AUDIENCE_DEFINITION_VERSION,
    } as unknown as AudienceDefinitionV1;
    const one = completed(await createResolver(rows('TRUE', 'FALSE'))({ definition: first }));
    const two = completed(await createResolver(rows('TRUE', 'FALSE'))({ definition: second }));
    expect(one.definition).toEqual(two.definition);
    expect(one.evaluationChecksum).toBe(two.evaluationChecksum);
    expect(one.membershipChecksum).toBe(two.membershipChecksum);
  });

  it('does not expose PII in the analytical membership result', async () => {
    const result = completed(await createResolver(rows('TRUE'))({ definition: featureDefinition }));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('phone');
    expect(result.members[0]).toEqual({ customerId: 1 });
  });
});

type ResolveAudienceMembershipRequestWithPreview = Parameters<ReturnType<typeof createResolveAudienceMembership>>[0] & { readonly previewLimit: number };
