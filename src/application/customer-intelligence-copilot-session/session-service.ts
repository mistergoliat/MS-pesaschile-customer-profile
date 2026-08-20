import { randomUUID } from 'node:crypto';
import {
  CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
  CUSTOMER_INTELLIGENCE_COPILOT_PLAN_REPAIR_ATTEMPTS,
  CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_PROMPT_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_ANSWER_PROMPT_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_SESSION_VERSION,
  serializeAnalyticalSchemaForCopilot,
  validateCopilotAnalysisPlan,
  type CopilotAnalysisPlan,
  type CustomerIntelligenceCopilotResponse,
} from '../../domain/customer-intelligence-copilot/index.js';
import { validateAnalyticalQueryPlan, type AnalyticalQueryPlan, type AnalyticalQueryResult } from '../../domain/customer-intelligence-query/index.js';
import type { CustomerIntelligenceSnapshotContext } from '../../domain/customer-intelligence/index.js';
import type { Clock } from '../customer-profile/ports.js';
import type {
  ResolveCurrentCustomerIntelligenceContext,
  ResolveCustomerIntelligenceContextForFeatureSnapshot,
  ResolveCustomerIntelligenceContextResult,
} from '../customer-intelligence/resolve-customer-intelligence-context.js';
import type { ExecuteAnalyticalQueryForExport, ExecuteAnalyticalQueryWithResolvedContext } from '../customer-intelligence-query/index.js';
import { AnalyticsTimeoutError, AnalyticsUnavailableError, AnalyticsSchemaIncompatibleError } from '../customer-profile/errors.js';
import type { AnalyticalSchemaProvider, CustomerIntelligenceCopilotModel, CopilotModelMetadata } from '../customer-intelligence-copilot/index.js';
import {
  buildCopilotSessionContext,
  deriveAnalyticalReferences,
} from './session-context.js';
import { buildCopilotXlsxExport, createCopilotExportFilename } from './xlsx-export.js';
import type {
  CopilotSession,
  CopilotSessionLimits,
  CopilotSessionQueryResult,
  CopilotSessionStore,
  CopilotSessionSummary,
  CreateCopilotSessionRequest,
  CreateCopilotSessionResult,
  DeleteCopilotSessionResult,
  ExportCopilotSessionQueryRequest,
  ExportCopilotSessionQueryResult,
  ProcessCopilotSessionTurnRequest,
  ProcessCopilotSessionTurnResult,
  RefreshCopilotSessionContextResult,
  ResetCopilotSessionResult,
} from './contracts.js';

export type CustomerIntelligenceCopilotSessionService = {
  createSession(request?: CreateCopilotSessionRequest): Promise<CreateCopilotSessionResult>;
  processSessionTurn(request: ProcessCopilotSessionTurnRequest): Promise<ProcessCopilotSessionTurnResult>;
  refreshSessionContext(sessionId: string): Promise<RefreshCopilotSessionContextResult>;
  resetSession(sessionId: string): Promise<ResetCopilotSessionResult>;
  deleteSession(sessionId: string): Promise<DeleteCopilotSessionResult>;
  exportSessionQuery(request: ExportCopilotSessionQueryRequest): Promise<ExportCopilotSessionQueryResult>;
};

type ValidatedStep = {
  readonly id: string;
  readonly plan: AnalyticalQueryPlan;
};

type AnalyticsUnavailableResponse = {
  readonly status: 'analytics_unavailable';
  readonly message: string;
  readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION;
};

type AnalyticsFailureResponse =
  | AnalyticsUnavailableResponse
  | {
      readonly status: 'analytics_timeout';
      readonly message: string;
      readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION;
    };

export function createCustomerIntelligenceCopilotSessionService(deps: {
  readonly getAnalyticalSchema: AnalyticalSchemaProvider;
  readonly resolveCurrent: ResolveCurrentCustomerIntelligenceContext;
  readonly resolveForFeatureSnapshot: ResolveCustomerIntelligenceContextForFeatureSnapshot;
  readonly executeAnalyticalQuery: ExecuteAnalyticalQueryWithResolvedContext;
  readonly executeAnalyticalQueryForExport: ExecuteAnalyticalQueryForExport;
  readonly model: CustomerIntelligenceCopilotModel;
  readonly store: CopilotSessionStore;
  readonly clock: Clock;
  readonly limits: CopilotSessionLimits;
}): CustomerIntelligenceCopilotSessionService {
  async function resolvePinnedContext(featureSnapshotId?: string | null): Promise<Extract<ResolveCustomerIntelligenceContextResult, { status: 'available' }> | AnalyticsUnavailableResponse> {
    const contextResult = featureSnapshotId ? await deps.resolveForFeatureSnapshot(featureSnapshotId) : await deps.resolveCurrent();
    if (contextResult.status !== 'available') {
      return mapContextFailure(contextResult.status === 'degraded' ? contextResult.reason : contextResult.status);
    }
    return contextResult;
  }

  return {
    async createSession(request = {}) {
      const now = deps.clock.now();
      const pinned = await resolvePinnedContext(request.featureSnapshotId ?? null);
      if ('status' in pinned && pinned.status !== 'available') {
        return { status: 'analytics_unavailable', message: pinned.message };
      }
      const session: CopilotSession = {
        sessionId: randomUUID(),
        sessionVersion: CUSTOMER_INTELLIGENCE_COPILOT_SESSION_VERSION,
        createdAt: now.toISOString(),
        lastActivityAt: now.toISOString(),
        expiresAt: addMinutes(now, deps.limits.ttlMinutes).toISOString(),
        pinnedContext: pinned.context,
        resolvedIds: pinned.resolvedIds,
        turns: [],
        analyticalState: { references: [], results: [] },
      };
      deps.store.create(session, now);
      return { status: 'created', session: summarize(session) };
    },

    async processSessionTurn(request) {
      const found = deps.store.get(request.sessionId, deps.clock.now());
      if (found.status !== 'found') return { status: found.status };
      const session = found.session;
      const question = trimBounded(request.question, deps.limits.maxQuestionChars);
      const sessionContext = buildCopilotSessionContext(session, deps.limits);
      const turnId = randomUUID();

      if (question.trim().length === 0) {
        const response = withSession({ sessionId: session.sessionId, turnId }, terminal('clarification_required', 'Necesito una pregunta analitica concreta para consultar Customer Intelligence.'));
        const updated = appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits);
        deps.store.save(updated, deps.clock.now());
        return { status: 'ok', response, sessionContext };
      }

      const schema = serializeAnalyticalSchemaForCopilot(deps.getAnalyticalSchema());
      const plannerOutput = await deps.model.generateAnalysisPlan({
        question,
        schema,
        plannerPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_PROMPT_VERSION,
        maxQueries: CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
        sessionContext,
      });
      const planning = await validateOrRepairPlan({
        rawPlan: plannerOutput.plan,
        plannerMetadata: plannerOutput.metadata,
        question,
        schema,
        sessionContext,
        model: deps.model,
      });

      if (planning.status === 'terminal') {
        const response = withSession({ sessionId: session.sessionId, turnId }, planning.response);
        deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
        return { status: 'ok', response, sessionContext };
      }

      if (planning.status === 'answer_from_context') {
        const sources = planning.sourceQueryIds.map((queryId) => session.analyticalState.results.find((entry) => entry.queryId === queryId)).filter((entry): entry is CopilotSessionQueryResult => entry !== undefined);
        if (sources.length !== planning.sourceQueryIds.length) {
          const response = withSession({ sessionId: session.sessionId, turnId }, plannerInvalid(['answer_from_context referenced an unknown session query']));
          deps.store.save(appendTurn(session, response, question, [], planning.sourceQueryIds, deps.clock.now(), deps.limits), deps.clock.now());
          return { status: 'ok', response, sessionContext };
        }
        try {
          const answerOutput = await deps.model.generateAnswer({
            question,
            answerPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANSWER_PROMPT_VERSION,
            context: session.pinnedContext,
            sessionContext,
            executions: sources.map((source) => ({ id: source.queryId, plan: source.plan, result: source.result })),
          });
          const response = withSession(
            { sessionId: session.sessionId, turnId, queryIds: [], sourceQueryIds: planning.sourceQueryIds },
            {
              status: 'answered_from_context',
              answer: answerOutput.answer,
              analysis: {
                contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
                analysisPlanVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
                sourceQueryIds: planning.sourceQueryIds,
                resultRowCount: sources.reduce((sum, source) => sum + source.result.rowCount, 0),
                plannerModel: modelName(planning.plannerMetadata),
                answerModel: modelName(answerOutput.metadata),
              },
              provenance: session.pinnedContext,
            },
          );
          deps.store.save(appendTurn(session, response, question, [], planning.sourceQueryIds, deps.clock.now(), deps.limits), deps.clock.now());
          return { status: 'ok', response, sessionContext };
        } catch (error) {
          const response = withSession({ sessionId: session.sessionId, turnId, queryIds: [], sourceQueryIds: planning.sourceQueryIds }, answerGenerationFailed(error));
          deps.store.save(appendTurn(session, response, question, [], planning.sourceQueryIds, deps.clock.now(), deps.limits), deps.clock.now());
          return { status: 'ok', response, sessionContext };
        }
      }

      const executions: { id: string; plan: AnalyticalQueryPlan; result: AnalyticalQueryResult }[] = [];
      try {
        for (const step of planning.steps) {
          const execution = await deps.executeAnalyticalQuery({
            plan: step.plan,
            context: session.pinnedContext,
            resolvedIds: session.resolvedIds,
          });
          if (execution.status === 'invalid_plan') {
            const response = withSession({ sessionId: session.sessionId, turnId }, plannerInvalid(execution.errors));
            deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
            return { status: 'ok', response, sessionContext };
          }
          executions.push({ id: step.id, plan: step.plan, result: execution.result });
        }
      } catch (error) {
        const response = withSession({ sessionId: session.sessionId, turnId }, mapAnalyticsError(error));
        deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
        return { status: 'ok', response, sessionContext };
      }

      try {
        const answerOutput = await deps.model.generateAnswer({
          question,
          answerPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANSWER_PROMPT_VERSION,
          context: session.pinnedContext,
          sessionContext,
          executions,
        });
        const queryResults = executions.map((execution) => ({
          queryId: uniqueQueryId(session, execution.id),
          turnId,
          plan: execution.plan,
          result: {
            ...execution.result,
            rows: execution.result.rows.slice(0, deps.limits.maxResultRowsRetained),
            rowCount: Math.min(execution.result.rowCount, deps.limits.maxResultRowsRetained),
            execution: { ...execution.result.execution, truncated: execution.result.execution.truncated || execution.result.rows.length > deps.limits.maxResultRowsRetained },
          },
        }));
        const response = withSession(
          { sessionId: session.sessionId, turnId, queryIds: queryResults.map((entry) => entry.queryId), sourceQueryIds: [] },
          answered(executions, answerOutput.answer, planning.plannerMetadata, answerOutput.metadata, session.pinnedContext),
        );
        const updated = appendResults(appendTurn(session, response, question, queryResults.map((entry) => entry.queryId), [], deps.clock.now(), deps.limits), queryResults, deps.limits);
        deps.store.save(updated, deps.clock.now());
        return { status: 'ok', response, sessionContext };
      } catch (error) {
        const response = withSession({ sessionId: session.sessionId, turnId }, answerGenerationFailed(error));
        deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
        return { status: 'ok', response, sessionContext };
      }
    },

    async refreshSessionContext(sessionId) {
      const found = deps.store.get(sessionId, deps.clock.now());
      if (found.status !== 'found') return { status: found.status };
      const pinned = await resolvePinnedContext(null);
      if ('status' in pinned && pinned.status !== 'available') {
        return { status: 'analytics_unavailable', message: pinned.message };
      }
      const now = deps.clock.now();
      const refreshed: CopilotSession = {
        ...found.session,
        lastActivityAt: now.toISOString(),
        expiresAt: addMinutes(now, deps.limits.ttlMinutes).toISOString(),
        pinnedContext: pinned.context,
        resolvedIds: pinned.resolvedIds,
        turns: [],
        analyticalState: { references: [], results: [] },
      };
      deps.store.save(refreshed, now);
      return { status: 'refreshed', session: summarize(refreshed) };
    },

    async resetSession(sessionId) {
      const now = deps.clock.now();
      const found = deps.store.get(sessionId, now);
      if (found.status !== 'found') return { status: found.status };
      const reset: CopilotSession = {
        ...found.session,
        lastActivityAt: now.toISOString(),
        expiresAt: addMinutes(now, deps.limits.ttlMinutes).toISOString(),
        turns: [],
        analyticalState: { references: [], results: [] },
      };
      deps.store.save(reset, now);
      return { status: 'reset', session: summarize(reset) };
    },

    async deleteSession(sessionId) {
      return deps.store.delete(sessionId, deps.clock.now());
    },

    async exportSessionQuery(request) {
      const startedAt = deps.clock.now().getTime();
      const found = deps.store.get(request.sessionId, deps.clock.now());
      if (found.status !== 'found') return { status: found.status };
      const source = found.session.analyticalState.results.find((entry) => entry.queryId === request.queryId);
      if (!source) return { status: 'query_not_found', message: 'queryId does not belong to this session' };
      try {
        const execution = await deps.executeAnalyticalQueryForExport({
          plan: source.plan,
          context: found.session.pinnedContext,
          resolvedIds: found.session.resolvedIds,
          maxRows: deps.limits.exportMaxRows,
        });
        if (execution.status === 'invalid_plan') return { status: 'invalid_query', message: execution.errors.join('; ') };
        const exportedAt = deps.clock.now().toISOString();
        const buffer = await buildCopilotXlsxExport({ session: found.session, source, result: execution.result, exportedAt });
        return {
          status: 'ok',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: createCopilotExportFilename(exportedAt),
          buffer,
          metadata: {
            sessionId: found.session.sessionId,
            queryId: source.queryId,
            queryPlanHash: source.result.queryPlanHash,
            rowCount: execution.result.rowCount,
            durationMs: deps.clock.now().getTime() - startedAt,
            exportComplete: !execution.result.execution.truncated,
          },
        };
      } catch (error) {
        const mapped = mapAnalyticsError(error);
        if (mapped.status === 'analytics_timeout') return { status: 'analytics_timeout', message: mapped.message };
        return { status: 'analytics_unavailable', message: mapped.message };
      }
    },
  };
}

async function validateOrRepairPlan(args: {
  readonly rawPlan: unknown;
  readonly plannerMetadata: CopilotModelMetadata | null;
  readonly question: string;
  readonly schema: ReturnType<typeof serializeAnalyticalSchemaForCopilot>;
  readonly sessionContext: ReturnType<typeof buildCopilotSessionContext>;
  readonly model: CustomerIntelligenceCopilotModel;
}): Promise<
  | { readonly status: 'query_plan'; readonly steps: readonly ValidatedStep[]; readonly plannerMetadata: CopilotModelMetadata | null }
  | { readonly status: 'answer_from_context'; readonly sourceQueryIds: readonly string[]; readonly plannerMetadata: CopilotModelMetadata | null }
  | { readonly status: 'terminal'; readonly response: CustomerIntelligenceCopilotResponse }
> {
  const first = validatePlanEnvelopeAndQueries(args.rawPlan);
  if (first.ok) {
    if (first.plan.status === 'query_plan') return { status: 'query_plan', steps: first.steps, plannerMetadata: args.plannerMetadata };
    if (first.plan.status === 'answer_from_context') return { status: 'answer_from_context', sourceQueryIds: first.plan.sourceQueryIds, plannerMetadata: args.plannerMetadata };
    return { status: 'terminal', response: terminal(first.plan.status, first.plan.message) };
  }

  for (let attempt = 0; attempt < CUSTOMER_INTELLIGENCE_COPILOT_PLAN_REPAIR_ATTEMPTS; attempt += 1) {
    const repairOutput = await args.model.repairAnalysisPlan({
      question: args.question,
      schema: args.schema,
      plannerPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_PROMPT_VERSION,
      maxQueries: CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
      sessionContext: args.sessionContext,
      previousPlan: args.rawPlan,
      validationErrors: first.errors,
    });
    const validation = validatePlanEnvelopeAndQueries(repairOutput.plan);
    if (validation.ok) {
      if (validation.plan.status === 'query_plan') return { status: 'query_plan', steps: validation.steps, plannerMetadata: repairOutput.metadata };
      if (validation.plan.status === 'answer_from_context') return { status: 'answer_from_context', sourceQueryIds: validation.plan.sourceQueryIds, plannerMetadata: repairOutput.metadata };
      return { status: 'terminal', response: terminal(validation.plan.status, validation.plan.message) };
    }
    return { status: 'terminal', response: plannerInvalid([...first.errors, ...validation.errors]) };
  }
  return { status: 'terminal', response: plannerInvalid(first.errors) };
}

function validatePlanEnvelopeAndQueries(rawPlan: unknown):
  | { readonly ok: true; readonly plan: CopilotAnalysisPlan; readonly steps: readonly ValidatedStep[] }
  | { readonly ok: false; readonly errors: readonly string[] } {
  const envelope = validateCopilotAnalysisPlan(rawPlan);
  if (!envelope.ok) return envelope;
  if (envelope.plan.status !== 'query_plan') return { ok: true, plan: envelope.plan, steps: [] };
  const errors: string[] = [];
  const steps: ValidatedStep[] = [];
  for (const query of envelope.plan.queries) {
    const validation = validateAnalyticalQueryPlan(query.plan);
    if (!validation.ok) errors.push(...validation.errors.map((error) => `${query.id}: ${error}`));
    else steps.push({ id: query.id, plan: validation.plan.canonical });
  }
  return errors.length === 0 ? { ok: true, plan: envelope.plan, steps } : { ok: false, errors };
}

function answered(
  executions: readonly { readonly result: AnalyticalQueryResult }[],
  answer: string,
  plannerMetadata: CopilotModelMetadata | null,
  answerMetadata: CopilotModelMetadata | null,
  provenance: CustomerIntelligenceSnapshotContext,
): CustomerIntelligenceCopilotResponse {
  return {
    status: 'answered',
    answer,
    analysis: {
      contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
      analysisPlanVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
      queryCount: executions.length,
      queryPlanHashes: executions.map((execution) => execution.result.queryPlanHash),
      resultRowCount: executions.reduce((sum, execution) => sum + execution.result.rowCount, 0),
      executionDurationMs: executions.reduce((sum, execution) => sum + execution.result.execution.durationMs, 0),
      plannerModel: modelName(plannerMetadata),
      answerModel: modelName(answerMetadata),
    },
    provenance,
  };
}

function appendTurn(
  session: CopilotSession,
  response: { readonly sessionId: string; readonly turnId: string } & CustomerIntelligenceCopilotResponse,
  question: string,
  queryIds: readonly string[],
  sourceQueryIds: readonly string[],
  now: Date,
  limits: CopilotSessionLimits,
): CopilotSession {
  const assistantAnswer = 'answer' in response ? trimBounded(response.answer, limits.maxAnswerChars) : null;
  const turn = {
    turnId: response.turnId,
    createdAt: now.toISOString(),
    userQuestion: trimBounded(question, limits.maxQuestionChars),
    assistantStatus: response.status,
    assistantAnswer,
    queryIds,
    sourceQueryIds,
  };
  return {
    ...session,
    lastActivityAt: now.toISOString(),
    expiresAt: addMinutes(now, limits.ttlMinutes).toISOString(),
    turns: [...session.turns, turn].slice(-limits.maxTurns),
  };
}

function appendResults(session: CopilotSession, entries: readonly CopilotSessionQueryResult[], limits: CopilotSessionLimits): CopilotSession {
  const results = [...session.analyticalState.results, ...entries].slice(-limits.maxStoredResults);
  return {
    ...session,
    analyticalState: {
      results,
      references: deriveAnalyticalReferences(results),
    },
  };
}

function uniqueQueryId(session: CopilotSession, queryId: string): string {
  const existing = new Set(session.analyticalState.results.map((entry) => entry.queryId));
  if (!existing.has(queryId)) return queryId;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${queryId}_${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${queryId}_${randomUUID().slice(0, 8)}`;
}

function terminal(status: 'clarification_required' | 'unsupported_data' | 'unsupported_operation', message: string): CustomerIntelligenceCopilotResponse {
  return { status, message, contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION };
}

function plannerInvalid(errors: readonly string[]): CustomerIntelligenceCopilotResponse {
  return { status: 'planner_invalid', errors, contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION };
}

function answerGenerationFailed(error: unknown): CustomerIntelligenceCopilotResponse {
  return {
    status: 'answer_generation_failed',
    message: error instanceof Error ? error.message : 'Answer generation failed',
    contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
  };
}

function mapContextFailure(reason: string): AnalyticsUnavailableResponse {
  return { status: 'analytics_unavailable', message: reason, contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION };
}

function mapAnalyticsError(error: unknown): AnalyticsFailureResponse {
  if (error instanceof AnalyticsTimeoutError) return { status: 'analytics_timeout', message: error.message, contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION };
  if (error instanceof AnalyticsUnavailableError || error instanceof AnalyticsSchemaIncompatibleError) return { status: 'analytics_unavailable', message: error.message, contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION };
  throw error;
}

function withSession<T extends CustomerIntelligenceCopilotResponse>(
  ids: { readonly sessionId: string; readonly turnId: string; readonly queryIds?: readonly string[]; readonly sourceQueryIds?: readonly string[] },
  response: T,
): { readonly sessionId: string; readonly turnId: string; readonly queryIds: readonly string[]; readonly sourceQueryIds: readonly string[] } & T {
  return { sessionId: ids.sessionId, turnId: ids.turnId, queryIds: ids.queryIds ?? [], sourceQueryIds: ids.sourceQueryIds ?? [], ...response };
}

function summarize(session: CopilotSession): CopilotSessionSummary {
  return {
    sessionId: session.sessionId,
    sessionVersion: session.sessionVersion,
    createdAt: session.createdAt,
    lastActivityAt: session.lastActivityAt,
    expiresAt: session.expiresAt,
    pinnedContext: session.pinnedContext,
    turnCount: session.turns.length,
    resultCount: session.analyticalState.results.length,
  };
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function trimBounded(value: string, maxChars: number): string {
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}

function modelName(metadata: CopilotModelMetadata | null): string | null {
  return metadata ? `${metadata.provider}:${metadata.model}` : null;
}
