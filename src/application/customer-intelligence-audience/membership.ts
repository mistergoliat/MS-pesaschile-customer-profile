import {
  AUDIENCE_EVALUATION_CHECKSUM_VERSION,
  AUDIENCE_EVALUATION_VERSION,
  AUDIENCE_MEMBERSHIP_CHECKSUM_VERSION,
  AUDIENCE_MEMBERSHIP_VERSION,
  AUDIENCE_REPRODUCIBILITY_LEVEL,
  type AudienceDefinitionV1,
  type AudienceEvaluationContextV1,
  type AudienceEvaluationLineageV1,
  type AudienceEvaluationResultV1,
  type AudienceMembershipResultV1,
  type AudienceMemberV1,
  type AudienceRelevantSnapshotLineageV1,
  type AudienceTruthV1,
} from '../../domain/customer-intelligence-audience/index.js';
import { sha256Stable, stableStringify } from '../../shared/stable-checksum.js';
import { compileAudienceSql } from './compile-audience-sql.js';
import { prepareAudienceEvaluation, referencedAudienceComponents } from './evaluation-preparation.js';
import type { AudienceContextResolver, AudienceSqlExecutor, EvaluateAudienceRequest } from './ports.js';

export type ResolveAudienceMembershipRequest = Omit<EvaluateAudienceRequest, 'previewLimit'>;

export type AudienceMembershipBlockedReasonV1 =
  | Extract<AudienceEvaluationResultV1, { readonly status: 'blocked' }>['reason']
  | 'POPULATION_COUNT_MISMATCH'
  | 'DUPLICATE_CUSTOMER_ID'
  | 'INVALID_CUSTOMER_ID'
  | 'INVALID_TRUTH'
  | 'COUNT_INVARIANT_FAILED'
  | 'MEMBERSHIP_INVARIANT_FAILED'
  | 'INCOMPLETE_LINEAGE';

export type AudienceMembershipBlockedResultV1 = {
  readonly status: 'blocked';
  readonly membershipVersion: typeof AUDIENCE_MEMBERSHIP_VERSION;
  readonly evaluatedAt: string;
  readonly definitionChecksum: string | null;
  readonly evaluationContext: AudienceEvaluationContextV1 | null;
  readonly lineage: AudienceEvaluationLineageV1 | null;
  readonly reason: AudienceMembershipBlockedReasonV1;
  readonly blockingComponents: readonly string[];
  readonly warnings: readonly string[];
};

export type AudienceMembershipResolutionResultV1 = AudienceMembershipResultV1 | AudienceMembershipBlockedResultV1;

export type ResolveAudienceMembershipDependencies = {
  readonly contextResolver: AudienceContextResolver;
  readonly sqlExecutor: AudienceSqlExecutor;
  readonly clock?: () => string;
};

export type ResolveAudienceMembership = (
  request: ResolveAudienceMembershipRequest,
) => Promise<AudienceMembershipResolutionResultV1>;

type OrderedAudienceTruth = {
  readonly customerId: number;
  readonly truth: AudienceTruthV1;
};

/**
 * Resolves the complete authoritative TRUE customer set from the same context and SQL
 * compiler used by A02. The bounded A02 preview is deliberately not an input here.
 */
export function createResolveAudienceMembership(
  deps: ResolveAudienceMembershipDependencies,
): ResolveAudienceMembership {
  return async (request) => {
    const evaluatedAt = request.evaluatedAt ?? deps.clock?.() ?? new Date().toISOString();

    let prepared: Awaited<ReturnType<typeof prepareAudienceEvaluation>>;
    try {
      prepared = await prepareAudienceEvaluation(deps, {
        definition: request.definition,
        featureSnapshotId: request.featureSnapshotId,
        evaluatedAt,
      });
    } catch (error) {
      return blockedMembershipResult(
        evaluatedAt,
        null,
        null,
        'EXECUTION_FAILED',
        [errorMessage(error, 'Audience context resolution failed')],
      );
    }

    if (prepared.status !== 'ready') return fromBlockedAudienceEvaluation(prepared.evaluation);

    let lineage: AudienceEvaluationLineageV1;
    try {
      lineage = createAudienceEvaluationLineage(
        prepared.context,
        prepared.canonicalDefinition,
        prepared.definitionChecksum,
        evaluatedAt,
      );
    } catch (error) {
      return blockedMembershipResult(
        evaluatedAt,
        prepared.definitionChecksum,
        prepared.context,
        'INCOMPLETE_LINEAGE',
        [errorMessage(error, 'Audience lineage is incomplete')],
      );
    }

    let rows: readonly { readonly customerId: number; readonly truth: unknown }[];
    try {
      rows = await deps.sqlExecutor.execute(compileAudienceSql(prepared.context, prepared.canonicalDefinition.root));
    } catch (error) {
      const message = errorMessage(error, 'Audience SQL execution failed');
      return blockedMembershipResult(
        evaluatedAt,
        prepared.definitionChecksum,
        prepared.context,
        /timeout/i.test(message) ? 'QUERY_TIMEOUT' : 'EXECUTION_FAILED',
        [message],
        lineage,
      );
    }

    if (!Array.isArray(rows)) {
      return blockedMembershipResult(
        evaluatedAt,
        prepared.definitionChecksum,
        prepared.context,
        'POPULATION_COUNT_MISMATCH',
        ['Audience SQL executor did not return a row array'],
        lineage,
      );
    }

    return buildAudienceMembershipResult({
      evaluatedAt,
      canonicalDefinition: prepared.canonicalDefinition,
      definitionChecksum: prepared.definitionChecksum,
      context: prepared.context,
      lineage,
      rows,
    });
  };
}

export function buildAudienceMembershipResult(input: {
  readonly evaluatedAt: string;
  readonly canonicalDefinition: AudienceDefinitionV1;
  readonly definitionChecksum: string;
  readonly context: AudienceEvaluationContextV1;
  readonly lineage: AudienceEvaluationLineageV1;
  readonly rows: readonly { readonly customerId: number; readonly truth: unknown }[];
}): AudienceMembershipResolutionResultV1 {
  const expectedPopulation = input.context.population.populationSize;
  if (input.rows.length !== expectedPopulation) {
    return blockedMembershipResult(
      input.evaluatedAt,
      input.definitionChecksum,
      input.context,
      'POPULATION_COUNT_MISMATCH',
      [`received ${input.rows.length} rows for populationSize ${expectedPopulation}`],
      input.lineage,
    );
  }

  const seen = new Set<number>();
  const orderedTruth: OrderedAudienceTruth[] = [];
  for (const row of input.rows) {
    if (!Number.isSafeInteger(row.customerId) || row.customerId <= 0) {
      return blockedMembershipResult(
        input.evaluatedAt,
        input.definitionChecksum,
        input.context,
        'INVALID_CUSTOMER_ID',
        [`customerId must be a positive safe integer: ${String(row.customerId)}`],
        input.lineage,
      );
    }
    if (seen.has(row.customerId)) {
      return blockedMembershipResult(
        input.evaluatedAt,
        input.definitionChecksum,
        input.context,
        'DUPLICATE_CUSTOMER_ID',
        [`customerId appears more than once: ${row.customerId}`],
        input.lineage,
      );
    }
    seen.add(row.customerId);

    const truth = normalizeCompleteAudienceTruth(row.truth);
    if (truth === null) {
      return blockedMembershipResult(
        input.evaluatedAt,
        input.definitionChecksum,
        input.context,
        'INVALID_TRUTH',
        [`truth must be TRUE, FALSE, or UNKNOWN for customerId ${row.customerId}`],
        input.lineage,
      );
    }
    orderedTruth.push({ customerId: row.customerId, truth });
  }

  orderedTruth.sort((left, right) => left.customerId - right.customerId);
  const matched = orderedTruth.filter((row) => row.truth === 'TRUE').length;
  const notMatched = orderedTruth.filter((row) => row.truth === 'FALSE').length;
  const unknown = orderedTruth.filter((row) => row.truth === 'UNKNOWN').length;
  if (expectedPopulation !== matched + notMatched + unknown) {
    return blockedMembershipResult(
      input.evaluatedAt,
      input.definitionChecksum,
      input.context,
      'COUNT_INVARIANT_FAILED',
      [`population ${expectedPopulation} does not equal matched ${matched} + notMatched ${notMatched} + unknown ${unknown}`],
      input.lineage,
    );
  }

  const trueCustomerIds = orderedTruth.filter((row) => row.truth === 'TRUE').map((row) => row.customerId);
  const members: AudienceMemberV1[] = trueCustomerIds.map((customerId) => ({ customerId }));
  if (members.length !== matched || new Set(trueCustomerIds).size !== trueCustomerIds.length) {
    return blockedMembershipResult(
      input.evaluatedAt,
      input.definitionChecksum,
      input.context,
      'MEMBERSHIP_INVARIANT_FAILED',
      [`members.length ${members.length} does not equal matched ${matched} or TRUE IDs are not unique`],
      input.lineage,
    );
  }

  const truthByCustomerId = orderedTruth.map(({ customerId, truth }) => ({ customerId, truth }));
  const evaluationChecksum = createAudienceEvaluationChecksum({
    canonicalDefinition: input.canonicalDefinition,
    evaluatorVersion: AUDIENCE_EVALUATION_VERSION,
    relevantCanonicalLineage: canonicalRelevantLineage(input.lineage),
    truthByCustomerId,
  });
  const membershipChecksum = createAudienceMembershipChecksum({
    canonicalDefinition: input.canonicalDefinition,
    evaluatorVersion: AUDIENCE_EVALUATION_VERSION,
    relevantCanonicalLineage: canonicalRelevantLineage(input.lineage),
    trueCustomerIds,
  });

  return {
    status: 'completed',
    membershipVersion: AUDIENCE_MEMBERSHIP_VERSION,
    definition: input.canonicalDefinition,
    definitionChecksum: input.definitionChecksum,
    evaluationContext: input.context,
    lineage: input.lineage,
    evaluatedAt: input.evaluatedAt,
    counts: { population: expectedPopulation, matched, notMatched, unknown },
    members,
    evaluationChecksum,
    membershipChecksum,
    completeness: 'COMPLETE',
    warnings: [],
  };
}

export function createAudienceEvaluationLineage(
  context: AudienceEvaluationContextV1,
  canonicalDefinition: AudienceDefinitionV1,
  definitionChecksum: string,
  evaluatedAt: string,
): AudienceEvaluationLineageV1 {
  const relevantSnapshotLineage = {
    feature: context.lineage.feature,
  } as {
    feature: AudienceRelevantSnapshotLineageV1['feature'];
    rfm?: AudienceRelevantSnapshotLineageV1['rfm'];
    cluster?: AudienceRelevantSnapshotLineageV1['cluster'];
    clv?: AudienceRelevantSnapshotLineageV1['clv'];
    commercialAffinity?: AudienceRelevantSnapshotLineageV1['commercialAffinity'];
  };
  const referenced = new Set(referencedAudienceComponents(canonicalDefinition.root));

  if (referenced.has('rfm')) {
    if (context.lineage.rfm === null) throw new Error('Referenced RFM lineage is missing');
    relevantSnapshotLineage.rfm = context.lineage.rfm;
  }
  if (referenced.has('cluster')) {
    if (context.lineage.cluster === null) throw new Error('Referenced cluster lineage is missing');
    relevantSnapshotLineage.cluster = context.lineage.cluster;
  }
  if (referenced.has('clv')) {
    if (context.lineage.clv === null) throw new Error('Referenced CLV lineage is missing');
    relevantSnapshotLineage.clv = context.lineage.clv;
  }
  if (referenced.has('commercialAffinity')) {
    if (context.lineage.commercialAffinity === null) throw new Error('Referenced affinity lineage is missing');
    relevantSnapshotLineage.commercialAffinity = context.lineage.commercialAffinity;
  }

  return {
    lineageVersion: 'customer-intelligence-audience-evaluation-lineage-v1',
    evaluatorVersion: AUDIENCE_EVALUATION_VERSION,
    reproducibilityLevel: AUDIENCE_REPRODUCIBILITY_LEVEL,
    definitionChecksum,
    contextVersion: context.contextVersion,
    referenceTime: context.referenceTime,
    population: context.population,
    resolutionPolicyVersion: context.resolutionPolicyVersion,
    relevantSnapshotLineage,
    evaluatedAt,
  };
}

export function canonicalRelevantLineage(lineage: AudienceEvaluationLineageV1): {
  readonly contextVersion: AudienceEvaluationLineageV1['contextVersion'];
  readonly referenceTime: string;
  readonly population: AudienceEvaluationLineageV1['population'];
  readonly resolutionPolicyVersion: AudienceEvaluationLineageV1['resolutionPolicyVersion'];
  readonly relevantSnapshotLineage: AudienceRelevantSnapshotLineageV1;
} {
  return {
    contextVersion: lineage.contextVersion,
    referenceTime: lineage.referenceTime,
    population: lineage.population,
    resolutionPolicyVersion: lineage.resolutionPolicyVersion,
    relevantSnapshotLineage: lineage.relevantSnapshotLineage,
  };
}

export function createAudienceEvaluationChecksum(input: {
  readonly canonicalDefinition: AudienceDefinitionV1;
  readonly evaluatorVersion: typeof AUDIENCE_EVALUATION_VERSION;
  readonly relevantCanonicalLineage: ReturnType<typeof canonicalRelevantLineage>;
  readonly truthByCustomerId: readonly OrderedAudienceTruth[];
}): string {
  return stableSemanticChecksum({
    checksumVersion: AUDIENCE_EVALUATION_CHECKSUM_VERSION,
    canonicalDefinition: input.canonicalDefinition,
    evaluatorVersion: input.evaluatorVersion,
    relevantCanonicalLineage: input.relevantCanonicalLineage,
    truthByCustomerId: input.truthByCustomerId,
  });
}

export function createAudienceMembershipChecksum(input: {
  readonly canonicalDefinition: AudienceDefinitionV1;
  readonly evaluatorVersion: typeof AUDIENCE_EVALUATION_VERSION;
  readonly relevantCanonicalLineage: ReturnType<typeof canonicalRelevantLineage>;
  readonly trueCustomerIds: readonly number[];
}): string {
  return stableSemanticChecksum({
    checksumVersion: AUDIENCE_MEMBERSHIP_CHECKSUM_VERSION,
    canonicalDefinition: input.canonicalDefinition,
    evaluatorVersion: input.evaluatorVersion,
    relevantCanonicalLineage: input.relevantCanonicalLineage,
    trueCustomerIds: input.trueCustomerIds,
  });
}

function stableSemanticChecksum(input: unknown): string {
  // Normalize once explicitly through the repository's stable serializer so the checksum
  // helpers remain interchangeable with other analytical checksum code.
  return sha256Stable(JSON.parse(stableStringify(input)) as unknown);
}

function normalizeCompleteAudienceTruth(value: unknown): AudienceTruthV1 | null {
  return value === 'TRUE' || value === 'FALSE' || value === 'UNKNOWN' ? value : null;
}

function fromBlockedAudienceEvaluation(
  evaluation: Extract<AudienceEvaluationResultV1, { readonly status: 'blocked' }>,
): AudienceMembershipBlockedResultV1 {
  return {
    status: 'blocked',
    membershipVersion: AUDIENCE_MEMBERSHIP_VERSION,
    evaluatedAt: evaluation.evaluatedAt,
    definitionChecksum: evaluation.definitionChecksum,
    evaluationContext: evaluation.context,
    lineage: null,
    reason: evaluation.reason,
    blockingComponents: evaluation.blockingComponents,
    warnings: evaluation.warnings,
  };
}

function blockedMembershipResult(
  evaluatedAt: string,
  definitionChecksum: string | null,
  context: AudienceEvaluationContextV1 | null,
  reason: AudienceMembershipBlockedReasonV1,
  blockingComponents: readonly string[],
  lineage: AudienceEvaluationLineageV1 | null = null,
): AudienceMembershipBlockedResultV1 {
  return {
    status: 'blocked',
    membershipVersion: AUDIENCE_MEMBERSHIP_VERSION,
    evaluatedAt,
    definitionChecksum,
    evaluationContext: context,
    lineage,
    reason,
    blockingComponents,
    warnings: [],
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
