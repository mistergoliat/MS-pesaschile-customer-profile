import { audienceDefinitionChecksum, canonicalizeAudienceDefinition, evaluateAudienceFilter, validateAudienceDefinition, type AudienceAvailabilityV1, type AudienceEvaluationContextV1, type AudienceEvaluationResultV1, type AudienceRowV1 } from '../../domain/customer-intelligence-audience/index.js';
import { MAX_PREVIEW_MEMBERS } from '../../domain/customer-intelligence-audience/index.js';
import { compileAudienceSql } from './compile-audience-sql.js';
import type { AudienceContextResolver, AudienceSqlExecutor, EvaluateAudience, EvaluateAudienceRequest } from './ports.js';
import type { AudienceEvaluationResultV1 as Result } from '../../domain/customer-intelligence-audience/index.js';
import { blockedAudienceEvaluation, incompatibleAudienceVersionConstraints, normalizeAudienceTruth, prepareAudienceEvaluation, referencedAudienceComponents } from './evaluation-preparation.js';

export function createEvaluateAudience(deps: { readonly contextResolver: AudienceContextResolver; readonly sqlExecutor: AudienceSqlExecutor; readonly clock?: () => string }): EvaluateAudience {
  return async (request: EvaluateAudienceRequest): Promise<Result> => {
    const prepared = await prepareAudienceEvaluation(deps, request);
    if (prepared.status !== 'ready') return prepared.evaluation;
    const { evaluatedAt, canonicalDefinition, definitionChecksum: checksum, context, availability, previewLimit } = prepared;
    const started = Date.now();
    try {
      const rows = await deps.sqlExecutor.execute(compileAudienceSql(context, canonicalDefinition.root));
      const counts = { TRUE: 0, FALSE: 0, UNKNOWN: 0 };
      const trueIds: number[] = [];
      for (const row of rows) { const truth = normalizeAudienceTruth(row.truth); counts[truth] += 1; if (truth === 'TRUE') trueIds.push(row.customerId); }
      trueIds.sort((a, b) => a - b);
      const previewMembers = trueIds.slice(0, previewLimit).map((customerId) => ({ customerId }));
      const totalDurationMs = Date.now() - started;
      return {
        status: 'completed', resultVersion: 'customer-intelligence-audience-evaluation-v1', definitionVersion: canonicalDefinition.definitionVersion,
        definitionChecksum: checksum, audienceDefinitionChecksum: checksum, evaluationId: request.evaluationId ?? null, evaluatedAt,
        referenceTime: context.referenceTime, populationUniverseCount: rows.length, trueCount: counts.TRUE, falseCount: counts.FALSE, unknownCount: counts.UNKNOWN,
        matchedCount: counts.TRUE, returnedCount: previewMembers.length, previewMembers, members: previewMembers, truncated: previewMembers.length < counts.TRUE,
        context, componentAvailability: availability, durationMs: totalDurationMs, performance: { queryDurationMs: totalDurationMs, totalDurationMs },
        provenance: { definitionChecksum: checksum, context: context.lineage }, warnings: [], canonicalDefinition,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Audience SQL execution failed';
      return blockedAudienceEvaluation(evaluatedAt, /timeout/i.test(message) ? 'QUERY_TIMEOUT' : 'EXECUTION_FAILED', [message], checksum, context, availability);
    }
  };
}

export function evaluateAudienceRows(definition: unknown, rows: readonly AudienceRowV1[], options: { readonly previewLimit?: number; readonly context: AudienceEvaluationContextV1; readonly availability?: AudienceAvailabilityV1; readonly evaluatedAt?: string } ): AudienceEvaluationResultV1 {
  const validation = validateAudienceDefinition(definition);
  const evaluatedAt = options.evaluatedAt ?? new Date().toISOString();
  if (!validation.ok) return blockedAudienceEvaluation(evaluatedAt, 'INVALID_DEFINITION', validation.errors.map((e) => e.message));
  const canonicalDefinition = canonicalizeAudienceDefinition(validation.definition);
  const checksum = audienceDefinitionChecksum(canonicalDefinition);
  const availability = options.availability ?? { feature: 'AVAILABLE', rfm: 'AVAILABLE', cluster: 'AVAILABLE', clv: 'AVAILABLE', commercialAffinity: 'AVAILABLE' };
  const required = referencedAudienceComponents(canonicalDefinition.root);
  const blocking = required.filter((component) => availability[component] !== 'AVAILABLE');
  if (blocking.length) return blockedAudienceEvaluation(evaluatedAt, 'UNAVAILABLE_COMPONENT', blocking, checksum, options.context, availability);
  const incompatible = incompatibleAudienceVersionConstraints(canonicalDefinition.root, options.context);
  if (incompatible.length) return blockedAudienceEvaluation(evaluatedAt, 'INCOMPATIBLE_SNAPSHOT', incompatible, checksum, options.context, availability);
  const truths = rows.map((row) => ({ customerId: row.customerId, truth: evaluateAudienceFilter(canonicalDefinition.root, row) })).sort((a, b) => a.customerId - b.customerId);
  const counts = { TRUE: truths.filter((r) => r.truth === 'TRUE').length, FALSE: truths.filter((r) => r.truth === 'FALSE').length, UNKNOWN: truths.filter((r) => r.truth === 'UNKNOWN').length };
  const limit = Math.min(options.previewLimit ?? MAX_PREVIEW_MEMBERS, MAX_PREVIEW_MEMBERS);
  const previewMembers = truths.filter((r) => r.truth === 'TRUE').slice(0, limit).map((r) => ({ customerId: r.customerId }));
  return { status: 'completed', resultVersion: 'customer-intelligence-audience-evaluation-v1', definitionVersion: canonicalDefinition.definitionVersion, definitionChecksum: checksum, audienceDefinitionChecksum: checksum, evaluationId: null, evaluatedAt, referenceTime: options.context.referenceTime, populationUniverseCount: rows.length, trueCount: counts.TRUE, falseCount: counts.FALSE, unknownCount: counts.UNKNOWN, matchedCount: counts.TRUE, returnedCount: previewMembers.length, previewMembers, members: previewMembers, truncated: previewMembers.length < counts.TRUE, context: options.context, componentAvailability: availability, durationMs: 0, performance: { queryDurationMs: 0, totalDurationMs: 0 }, provenance: { definitionChecksum: checksum, context: options.context.lineage }, warnings: [], canonicalDefinition };
}
