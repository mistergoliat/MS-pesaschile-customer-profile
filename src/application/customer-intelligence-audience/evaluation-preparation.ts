import {
  AUDIENCE_DEFINITION_VERSION,
  AUDIENCE_EVALUATION_VERSION,
  MAX_PREVIEW_MEMBERS,
  audienceDefinitionChecksum,
  canonicalizeAudienceDefinition,
  validateAudienceDefinition,
  type AudienceAvailabilityV1,
  type AudienceDefinitionV1,
  type AudienceEvaluationContextV1,
  type AudienceEvaluationResultV1,
  type AudienceFilterV1,
  type AudienceValidationErrorV1,
} from '../../domain/customer-intelligence-audience/index.js';
import type { AudienceContextResolver, EvaluateAudienceRequest } from './ports.js';

export type PreparedAudienceEvaluation = {
  readonly status: 'ready';
  readonly evaluatedAt: string;
  readonly canonicalDefinition: AudienceDefinitionV1;
  readonly definitionChecksum: string;
  readonly context: AudienceEvaluationContextV1;
  readonly availability: AudienceAvailabilityV1;
  readonly previewLimit: number;
};

export type AudienceEvaluationPreparation =
  | PreparedAudienceEvaluation
  | {
      readonly status: 'blocked';
      readonly evaluation: Extract<AudienceEvaluationResultV1, { readonly status: 'blocked' }>;
    };

export function prepareAudienceEvaluation(
  deps: { readonly contextResolver: AudienceContextResolver; readonly clock?: () => string },
  request: EvaluateAudienceRequest,
): Promise<AudienceEvaluationPreparation> {
  return prepare(deps, request);
}

async function prepare(
  deps: { readonly contextResolver: AudienceContextResolver; readonly clock?: () => string },
  request: EvaluateAudienceRequest,
): Promise<AudienceEvaluationPreparation> {
  const evaluatedAt = request.evaluatedAt ?? deps.clock?.() ?? new Date().toISOString();
  const validation = validateAudienceDefinition(request.definition);
  if (!validation.ok) {
    return {
      status: 'blocked',
      evaluation: blockedAudienceEvaluation(
        evaluatedAt,
        'INVALID_DEFINITION',
        validation.errors.map((error) => `${error.path}: ${error.message}`),
        null,
        null,
        undefined,
        validation.errors,
      ),
    };
  }

  const canonicalDefinition = canonicalizeAudienceDefinition(validation.definition);
  const checksum = audienceDefinitionChecksum(canonicalDefinition);
  const previewLimit = request.previewLimit ?? MAX_PREVIEW_MEMBERS;
  if (!Number.isSafeInteger(previewLimit) || previewLimit < 0 || previewLimit > MAX_PREVIEW_MEMBERS) {
    return {
      status: 'blocked',
      evaluation: blockedAudienceEvaluation(
        evaluatedAt,
        'BUDGET_EXCEEDED',
        [`previewLimit must be between 0 and ${MAX_PREVIEW_MEMBERS}`],
        checksum,
      ),
    };
  }

  const resolved = request.featureSnapshotId === undefined
    ? await deps.contextResolver.resolveCurrent()
    : await deps.contextResolver.resolveForFeatureSnapshot(request.featureSnapshotId);
  if (resolved.status !== 'available') {
    return {
      status: 'blocked',
      evaluation: blockedAudienceEvaluation(
        evaluatedAt,
        resolved.reason === 'FEATURE_SNAPSHOT_NOT_FOUND' ? 'INCOMPATIBLE_SNAPSHOT' : 'UNAVAILABLE_COMPONENT',
        [resolved.reason],
        checksum,
      ),
    };
  }

  const availability = resolved.availability;
  const required = referencedAudienceComponents(canonicalDefinition.root);
  const blocking = required.filter((component) => availability[component] !== 'AVAILABLE');
  if (blocking.length > 0) {
    return {
      status: 'blocked',
      evaluation: blockedAudienceEvaluation(
        evaluatedAt,
        'UNAVAILABLE_COMPONENT',
        blocking,
        checksum,
        resolved.context,
        availability,
      ),
    };
  }

  const incompatible = incompatibleAudienceVersionConstraints(canonicalDefinition.root, resolved.context);
  if (incompatible.length > 0) {
    return {
      status: 'blocked',
      evaluation: blockedAudienceEvaluation(
        evaluatedAt,
        'INCOMPATIBLE_SNAPSHOT',
        incompatible,
        checksum,
        resolved.context,
        availability,
      ),
    };
  }

  return {
    status: 'ready',
    evaluatedAt,
    canonicalDefinition,
    definitionChecksum: checksum,
    context: resolved.context,
    availability,
    previewLimit,
  };
}

export function referencedAudienceComponents(filter: AudienceFilterV1): Array<keyof AudienceAvailabilityV1> {
  const result = new Set<keyof AudienceAvailabilityV1>();

  function visit(node: AudienceFilterV1): void {
    if (node.kind === 'AND' || node.kind === 'OR') {
      node.children.forEach(visit);
    } else if (node.kind === 'NOT') {
      visit(node.child);
    } else if (node.kind === 'HAS_AFFINITY') {
      result.add('commercialAffinity');
    } else {
      result.add(
        node.field.startsWith('rfm.')
          ? 'rfm'
          : node.field.startsWith('cluster.')
            ? 'cluster'
            : node.field.startsWith('clv.')
              ? 'clv'
              : 'feature',
      );
    }
  }

  visit(filter);
  return [...result];
}

export function incompatibleAudienceVersionConstraints(filter: AudienceFilterV1, context: AudienceEvaluationContextV1): string[] {
  const issues: string[] = [];

  function visit(node: AudienceFilterV1): void {
    if (node.kind === 'AND' || node.kind === 'OR') {
      node.children.forEach(visit);
      return;
    }
    if (node.kind === 'NOT') {
      visit(node.child);
      return;
    }
    if (node.kind !== 'SCALAR') return;

    const expectedRfmVersion = context.lineage.rfm?.segmentVersion;
    const expected = node.field === 'rfm.segmentVersion'
      ? expectedRfmVersion
      : node.field === 'cluster.modelVersion'
        ? context.lineage.cluster?.modelVersion
        : null;

    // segmentCode is interpreted within the selected RFM segment version. The segment code
    // value itself must never be compared to that version string.
    if (node.field === 'rfm.segmentCode' && (expectedRfmVersion === null || expectedRfmVersion === undefined)) {
      issues.push('rfm.segmentCode requires a resolved segmentVersion');
      return;
    }
    if (expected === null || expected === undefined) return;
    if (node.operator === 'EQ' && node.value !== expected) {
      issues.push(`${node.field}=${String(node.value)} is incompatible with resolved ${expected}`);
    }
    if (node.operator === 'IN' && Array.isArray(node.value) && !node.value.includes(expected)) {
      issues.push(`${node.field} IN does not include resolved ${expected}`);
    }
  }

  visit(filter);
  return issues;
}

export function normalizeAudienceTruth(value: unknown): 'TRUE' | 'FALSE' | 'UNKNOWN' {
  return value === 'TRUE' || value === 1 || value === '1'
    ? 'TRUE'
    : value === 'FALSE' || value === 0 || value === '0'
      ? 'FALSE'
      : 'UNKNOWN';
}

export function blockedAudienceEvaluation(
  evaluatedAt: string,
  reason: Extract<AudienceEvaluationResultV1, { readonly status: 'blocked' }>['reason'],
  components: readonly string[],
  checksum: string | null = null,
  context: AudienceEvaluationContextV1 | null = null,
  availability: AudienceAvailabilityV1 = unavailableAudienceAvailability(),
  validationErrors?: readonly AudienceValidationErrorV1[],
): Extract<AudienceEvaluationResultV1, { readonly status: 'blocked' }> {
  return {
    status: 'blocked',
    resultVersion: AUDIENCE_EVALUATION_VERSION,
    definitionVersion: AUDIENCE_DEFINITION_VERSION,
    definitionChecksum: checksum,
    audienceDefinitionChecksum: checksum,
    evaluationId: null,
    evaluatedAt,
    referenceTime: context?.referenceTime ?? null,
    context,
    componentAvailability: availability,
    blockingComponents: components,
    reason,
    warnings: [],
    ...(validationErrors === undefined ? {} : { validationErrors }),
  };
}

function unavailableAudienceAvailability(): AudienceAvailabilityV1 {
  return {
    feature: 'UNAVAILABLE',
    rfm: 'UNAVAILABLE',
    cluster: 'UNAVAILABLE',
    clv: 'UNAVAILABLE',
    commercialAffinity: 'UNAVAILABLE',
  };
}
