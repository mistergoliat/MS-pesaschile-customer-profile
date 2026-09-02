import type {
  AudienceAffinityAxisV1,
  AudienceDefinitionV1,
  AudienceEvaluationContextV1,
  AudienceEvaluationResultV1,
  AudienceTruthV1,
} from '../../src/domain/customer-intelligence-audience/index.js';

export type DiscoveredAudienceValues = {
  readonly rfmSegmentCode: string;
  readonly rfmSegmentVersion: string;
  readonly clusterId: number;
  readonly clusterModelVersion: string;
  readonly secondAffinity: {
    readonly axis: AudienceAffinityAxisV1;
    readonly code: string;
  };
};

export type RepresentativeAudienceDefinition = {
  readonly name: 'FEATURE' | 'RAW_RFM' | 'RFM_SEGMENT' | 'CLUSTER' | 'CLV' | 'AFFINITY' | 'MIXED' | 'MULTI_AFFINITY_OR';
  readonly definition: AudienceDefinitionV1;
};

const scalar = (field: string, operator: string, value?: string | number): Record<string, unknown> => ({
  kind: 'SCALAR', field, operator, ...(value === undefined ? {} : { value }),
});

const affinity = (axis: AudienceAffinityAxisV1, code: string): Record<string, unknown> => ({
  kind: 'HAS_AFFINITY', axis, code,
});

const and = (...children: readonly Record<string, unknown>[]): Record<string, unknown> => ({ kind: 'AND', children });

const definition = (root: Record<string, unknown>): AudienceDefinitionV1 => ({
  definitionVersion: 'customer-intelligence-audience-definition-v1',
  root,
} as AudienceDefinitionV1);

export function buildRepresentativeDefinitions(values: DiscoveredAudienceValues): readonly RepresentativeAudienceDefinition[] {
  const hyrox = affinity('DISCIPLINE', 'HYROX');
  const second = affinity(values.secondAffinity.axis, values.secondAffinity.code);
  return [
    { name: 'FEATURE', definition: definition(scalar('commercial.validOrders', 'GTE', 2)) },
    { name: 'RAW_RFM', definition: definition(scalar('rfm.recencyDays', 'LTE', 180)) },
    { name: 'RFM_SEGMENT', definition: definition(and(
      scalar('rfm.segmentCode', 'EQ', values.rfmSegmentCode),
      scalar('rfm.segmentVersion', 'EQ', values.rfmSegmentVersion),
    )) },
    { name: 'CLUSTER', definition: definition(and(
      scalar('cluster.clusterId', 'EQ', values.clusterId),
      scalar('cluster.modelVersion', 'EQ', values.clusterModelVersion),
    )) },
    { name: 'CLV', definition: definition(scalar('clv.expectedRevenueTaxIncl', 'GTE', '100000')) },
    { name: 'AFFINITY', definition: definition(hyrox) },
    { name: 'MIXED', definition: definition(and(
      scalar('rfm.recencyDays', 'LTE', 180),
      hyrox,
    )) },
    { name: 'MULTI_AFFINITY_OR', definition: definition({ kind: 'OR', children: [hyrox, second] }) },
  ];
}

export type EvaluationFingerprint = {
  readonly definitionChecksum: string;
  readonly context: AudienceEvaluationContextV1;
  readonly populationUniverseCount: number;
  readonly trueCount: number;
  readonly falseCount: number;
  readonly unknownCount: number;
  readonly matchedCount: number;
  readonly previewCustomerIds: readonly number[];
};

export function evaluationFingerprint(result: AudienceEvaluationResultV1): EvaluationFingerprint {
  if (result.status !== 'completed') throw new Error(`Expected completed evaluation, got ${result.status}`);
  return {
    definitionChecksum: result.definitionChecksum,
    context: result.context,
    populationUniverseCount: result.populationUniverseCount,
    trueCount: result.trueCount,
    falseCount: result.falseCount,
    unknownCount: result.unknownCount,
    matchedCount: result.matchedCount,
    previewCustomerIds: result.previewMembers.map((member) => member.customerId),
  };
}

export function assertEvaluationInvariants(result: AudienceEvaluationResultV1, previewLimit: number): void {
  if (result.status !== 'completed') throw new Error(`Audience evaluation blocked: ${result.reason}`);
  if (result.trueCount + result.falseCount + result.unknownCount !== result.populationUniverseCount) {
    throw new Error('Audience count invariant failed');
  }
  if (result.matchedCount !== result.trueCount) throw new Error('Audience matchedCount invariant failed');
  if (result.previewMembers.length > previewLimit || result.previewMembers.length > 1000) {
    throw new Error('Audience preview bound failed');
  }
  const ids = result.previewMembers.map((member) => member.customerId);
  if (ids.some((id, index) => index > 0 && ids[index - 1] !== undefined && ids[index - 1]! >= id)) {
    throw new Error('Audience preview ordering invariant failed');
  }
  if (result.truncated !== (result.previewMembers.length < result.trueCount)) {
    throw new Error('Audience truncated invariant failed');
  }
}

export function hasValidRealPopulationEvidence(populationUniverseCount: number, resolvedPopulationSize: number): boolean {
  return resolvedPopulationSize > 0 && populationUniverseCount === resolvedPopulationSize;
}

export function assertEvaluationPopulation(result: AudienceEvaluationResultV1, resolvedPopulationSize: number): void {
  if (result.status !== 'completed') throw new Error(`Expected completed evaluation, got ${result.status}`);
  if (!hasValidRealPopulationEvidence(result.populationUniverseCount, resolvedPopulationSize)) {
    throw new Error(`Evaluation populationUniverseCount=${result.populationUniverseCount} does not match resolved populationSize=${resolvedPopulationSize}`);
  }
}

export function sameEvaluationFingerprint(left: AudienceEvaluationResultV1, right: AudienceEvaluationResultV1): boolean {
  return JSON.stringify(evaluationFingerprint(left)) === JSON.stringify(evaluationFingerprint(right));
}

export type AffinityProbeInput = {
  readonly trueProbe: { readonly customerId: number | null; readonly truth: AudienceTruthV1 | null };
  readonly falseProbe: { readonly customerId: number | null; readonly truth: AudienceTruthV1 | null };
  readonly unknownProbe: { readonly customerId: number | null; readonly truth: AudienceTruthV1 | null };
};

export type AffinityProbeAssessment = {
  readonly ok: boolean;
  readonly trueProbe: AffinityProbeInput['trueProbe'];
  readonly falseProbe: AffinityProbeInput['falseProbe'];
  readonly unknownProbe: AffinityProbeInput['unknownProbe'] & {
    readonly status: 'AVAILABLE' | 'UNAVAILABLE_NO_OUTSIDE_POPULATION_CUSTOMER';
  };
};

export function assessAffinityProbes(input: AffinityProbeInput): AffinityProbeAssessment {
  const unknownAvailable = input.unknownProbe.customerId !== null;
  const unknownProbe = {
    ...input.unknownProbe,
    status: unknownAvailable ? 'AVAILABLE' as const : 'UNAVAILABLE_NO_OUTSIDE_POPULATION_CUSTOMER' as const,
  };
  return {
    ok: input.trueProbe.customerId !== null && input.trueProbe.truth === 'TRUE'
      && input.falseProbe.customerId !== null && input.falseProbe.truth === 'FALSE'
      && (!unknownAvailable || input.unknownProbe.truth === 'UNKNOWN'),
    trueProbe: input.trueProbe,
    falseProbe: input.falseProbe,
    unknownProbe,
  };
}
