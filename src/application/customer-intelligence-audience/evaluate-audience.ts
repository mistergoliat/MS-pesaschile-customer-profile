import { audienceDefinitionChecksum, canonicalizeAudienceDefinition, evaluateAudienceFilter, validateAudienceDefinition, type AudienceAvailabilityV1, type AudienceEvaluationContextV1, type AudienceEvaluationResultV1, type AudienceFilterV1, type AudienceRowV1, type AudienceValidationErrorV1 } from '../../domain/customer-intelligence-audience/index.js';
import { MAX_PREVIEW_MEMBERS } from '../../domain/customer-intelligence-audience/index.js';
import { compileAudienceSql } from './compile-audience-sql.js';
import type { AudienceContextResolver, AudienceSqlExecutor, EvaluateAudience, EvaluateAudienceRequest } from './ports.js';
import type { AudienceEvaluationResultV1 as Result } from '../../domain/customer-intelligence-audience/index.js';

export function createEvaluateAudience(deps: { readonly contextResolver: AudienceContextResolver; readonly sqlExecutor: AudienceSqlExecutor; readonly clock?: () => string }): EvaluateAudience {
  return async (request: EvaluateAudienceRequest): Promise<Result> => {
    const evaluatedAt = request.evaluatedAt ?? deps.clock?.() ?? new Date().toISOString();
    const validation = validateAudienceDefinition(request.definition);
    if (!validation.ok) return blocked(evaluatedAt, 'INVALID_DEFINITION', validation.errors.map((e) => `${e.path}: ${e.message}`), null, null, undefined, validation.errors);
    const canonicalDefinition = canonicalizeAudienceDefinition(validation.definition);
    const checksum = audienceDefinitionChecksum(canonicalDefinition);
    const previewLimit = request.previewLimit ?? MAX_PREVIEW_MEMBERS;
    if (!Number.isSafeInteger(previewLimit) || previewLimit < 0 || previewLimit > MAX_PREVIEW_MEMBERS) return blocked(evaluatedAt, 'BUDGET_EXCEEDED', [`previewLimit must be between 0 and ${MAX_PREVIEW_MEMBERS}`], checksum);
    const resolved = request.featureSnapshotId === undefined ? await deps.contextResolver.resolveCurrent() : await deps.contextResolver.resolveForFeatureSnapshot(request.featureSnapshotId);
    if (resolved.status !== 'available') return blocked(evaluatedAt, resolved.reason === 'FEATURE_SNAPSHOT_NOT_FOUND' ? 'INCOMPATIBLE_SNAPSHOT' : 'UNAVAILABLE_COMPONENT', [resolved.reason], checksum);
    const availability = resolved.availability;
    const required = referencedComponents(canonicalDefinition.root);
    const blocking = required.filter((component) => availability[component] !== 'AVAILABLE');
    if (blocking.length > 0) return blocked(evaluatedAt, 'UNAVAILABLE_COMPONENT', blocking, checksum, resolved.context, availability);
    const incompatible = incompatibleVersionConstraints(canonicalDefinition.root, resolved.context);
    if (incompatible.length > 0) return blocked(evaluatedAt, 'INCOMPATIBLE_SNAPSHOT', incompatible, checksum, resolved.context, availability);
    const started = Date.now();
    try {
      const rows = await deps.sqlExecutor.execute(compileAudienceSql(resolved.context, canonicalDefinition.root));
      const counts = { TRUE: 0, FALSE: 0, UNKNOWN: 0 };
      const trueIds: number[] = [];
      for (const row of rows) { const truth = normalizeTruth(row.truth); counts[truth] += 1; if (truth === 'TRUE') trueIds.push(row.customerId); }
      trueIds.sort((a, b) => a - b);
      const previewMembers = trueIds.slice(0, previewLimit).map((customerId) => ({ customerId }));
      const totalDurationMs = Date.now() - started;
      return {
        status: 'completed', resultVersion: 'customer-intelligence-audience-evaluation-v1', definitionVersion: canonicalDefinition.definitionVersion,
        definitionChecksum: checksum, audienceDefinitionChecksum: checksum, evaluationId: request.evaluationId ?? null, evaluatedAt,
        referenceTime: resolved.context.referenceTime, populationUniverseCount: rows.length, trueCount: counts.TRUE, falseCount: counts.FALSE, unknownCount: counts.UNKNOWN,
        matchedCount: counts.TRUE, returnedCount: previewMembers.length, previewMembers, members: previewMembers, truncated: previewMembers.length < counts.TRUE,
        context: resolved.context, componentAvailability: availability, durationMs: totalDurationMs, performance: { queryDurationMs: totalDurationMs, totalDurationMs },
        provenance: { definitionChecksum: checksum, context: resolved.context.lineage }, warnings: [], canonicalDefinition,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Audience SQL execution failed';
      return blocked(evaluatedAt, /timeout/i.test(message) ? 'QUERY_TIMEOUT' : 'EXECUTION_FAILED', [message], checksum, resolved.context, availability);
    }
  };
}

export function evaluateAudienceRows(definition: unknown, rows: readonly AudienceRowV1[], options: { readonly previewLimit?: number; readonly context: AudienceEvaluationContextV1; readonly availability?: AudienceAvailabilityV1; readonly evaluatedAt?: string } ): AudienceEvaluationResultV1 {
  const validation = validateAudienceDefinition(definition);
  const evaluatedAt = options.evaluatedAt ?? new Date().toISOString();
  if (!validation.ok) return blocked(evaluatedAt, 'INVALID_DEFINITION', validation.errors.map((e) => e.message));
  const canonicalDefinition = canonicalizeAudienceDefinition(validation.definition);
  const checksum = audienceDefinitionChecksum(canonicalDefinition);
  const availability = options.availability ?? { feature: 'AVAILABLE', rfm: 'AVAILABLE', cluster: 'AVAILABLE', clv: 'AVAILABLE', commercialAffinity: 'AVAILABLE' };
  const required = referencedComponents(canonicalDefinition.root);
  const blocking = required.filter((component) => availability[component] !== 'AVAILABLE');
  if (blocking.length) return blocked(evaluatedAt, 'UNAVAILABLE_COMPONENT', blocking, checksum, options.context, availability);
  const incompatible = incompatibleVersionConstraints(canonicalDefinition.root, options.context);
  if (incompatible.length) return blocked(evaluatedAt, 'INCOMPATIBLE_SNAPSHOT', incompatible, checksum, options.context, availability);
  const truths = rows.map((row) => ({ customerId: row.customerId, truth: evaluateAudienceFilter(canonicalDefinition.root, row) })).sort((a, b) => a.customerId - b.customerId);
  const counts = { TRUE: truths.filter((r) => r.truth === 'TRUE').length, FALSE: truths.filter((r) => r.truth === 'FALSE').length, UNKNOWN: truths.filter((r) => r.truth === 'UNKNOWN').length };
  const limit = Math.min(options.previewLimit ?? MAX_PREVIEW_MEMBERS, MAX_PREVIEW_MEMBERS);
  const previewMembers = truths.filter((r) => r.truth === 'TRUE').slice(0, limit).map((r) => ({ customerId: r.customerId }));
  return { status: 'completed', resultVersion: 'customer-intelligence-audience-evaluation-v1', definitionVersion: canonicalDefinition.definitionVersion, definitionChecksum: checksum, audienceDefinitionChecksum: checksum, evaluationId: null, evaluatedAt, referenceTime: options.context.referenceTime, populationUniverseCount: rows.length, trueCount: counts.TRUE, falseCount: counts.FALSE, unknownCount: counts.UNKNOWN, matchedCount: counts.TRUE, returnedCount: previewMembers.length, previewMembers, members: previewMembers, truncated: previewMembers.length < counts.TRUE, context: options.context, componentAvailability: availability, durationMs: 0, performance: { queryDurationMs: 0, totalDurationMs: 0 }, provenance: { definitionChecksum: checksum, context: options.context.lineage }, warnings: [], canonicalDefinition };
}

function referencedComponents(filter: AudienceFilterV1): Array<keyof AudienceAvailabilityV1> {
  const result = new Set<keyof AudienceAvailabilityV1>();
  function visit(node: typeof filter): void { if (node.kind === 'AND' || node.kind === 'OR') node.children.forEach(visit); else if (node.kind === 'NOT') visit(node.child); else if (node.kind === 'HAS_AFFINITY') result.add('commercialAffinity'); else result.add(node.field.startsWith('rfm.') ? 'rfm' : node.field.startsWith('cluster.') ? 'cluster' : node.field.startsWith('clv.') ? 'clv' : 'feature'); }
  visit(filter); return [...result];
}
function incompatibleVersionConstraints(filter: AudienceFilterV1, context: AudienceEvaluationContextV1): string[] {
  const issues: string[] = [];
  function visit(node: typeof filter): void {
    if (node.kind === 'AND' || node.kind === 'OR') { node.children.forEach(visit); return; }
    if (node.kind === 'NOT') { visit(node.child); return; }
    if (node.kind !== 'SCALAR') return;
    const expectedVersion = context.lineage.rfm?.segmentVersion;
    const expected = node.field === 'rfm.segmentVersion' ? expectedVersion : node.field === 'cluster.modelVersion' ? context.lineage.cluster?.modelVersion : null;
    // segmentCode is interpreted within the selected RFM segment version. It must have a
    // resolved version available, but the code value itself must never be compared to that
    // version string. An explicit segmentVersion condition below is checked independently.
    if (node.field === 'rfm.segmentCode' && (expectedVersion === null || expectedVersion === undefined)) { issues.push('rfm.segmentCode requires a resolved segmentVersion'); return; }
    if (expected === null || expected === undefined) return;
    if (node.operator === 'EQ' && node.value !== expected) issues.push(`${node.field}=${String(node.value)} is incompatible with resolved ${expected}`);
    if (node.operator === 'IN' && Array.isArray(node.value) && !node.value.includes(expected)) issues.push(`${node.field} IN does not include resolved ${expected}`);
  }
  visit(filter); return issues;
}
function normalizeTruth(value: unknown): 'TRUE' | 'FALSE' | 'UNKNOWN' { return value === 'TRUE' || value === 1 || value === '1' ? 'TRUE' : value === 'FALSE' || value === 0 || value === '0' ? 'FALSE' : 'UNKNOWN'; }
function blocked(evaluatedAt: string, reason: Extract<AudienceEvaluationResultV1, { status: 'blocked' }>['reason'], components: readonly string[], checksum: string | null = null, context: AudienceEvaluationContextV1 | null = null, availability: AudienceAvailabilityV1 = { feature: 'UNAVAILABLE', rfm: 'UNAVAILABLE', cluster: 'UNAVAILABLE', clv: 'UNAVAILABLE', commercialAffinity: 'UNAVAILABLE' }, validationErrors?: readonly AudienceValidationErrorV1[]): Extract<AudienceEvaluationResultV1, { status: 'blocked' }> { return { status: 'blocked', resultVersion: 'customer-intelligence-audience-evaluation-v1', definitionVersion: 'customer-intelligence-audience-definition-v1', definitionChecksum: checksum, audienceDefinitionChecksum: checksum, evaluationId: null, evaluatedAt, referenceTime: context?.referenceTime ?? null, context, componentAvailability: availability, blockingComponents: components, reason, warnings: [], ...(validationErrors === undefined ? {} : { validationErrors }) }; }
