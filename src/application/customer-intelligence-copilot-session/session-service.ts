import { createHash, randomUUID } from 'node:crypto';
import {
  CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
  CUSTOMER_INTELLIGENCE_COPILOT_PLAN_REPAIR_ATTEMPTS,
  CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_REPAIR_ATTEMPTS,
  CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_PROMPT_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_ORCHESTRATOR_PROMPT_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_ANSWER_PROMPT_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_SESSION_VERSION,
  asksForFreshBusinessFact,
  serializeAnalyticalQueryContractForCopilot,
  serializeAnalyticalSchemaForCopilot,
  validateCopilotAnalysisPlan,
  validateCopilotConversationDecision,
  type CopilotAnalysisPlan,
  type CopilotConversationDecisionAction,
  type CopilotConversationDecisionActionConstraints,
  type CopilotConversationDecision,
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
  CopilotSessionDetail,
  CopilotSessionTurn,
  CreateCopilotSessionRequest,
  CreateCopilotSessionResult,
  DeleteCopilotSessionResult,
  ExportCopilotSessionQueryRequest,
  ExportCopilotSessionQueryResult,
  GetCopilotSessionResult,
  ListCopilotSessionsResult,
  ProcessCopilotSessionTurnRequest,
  ProcessCopilotSessionTurnResult,
  RefreshCopilotSessionContextResult,
  ResetCopilotSessionResult,
} from './contracts.js';

export type CustomerIntelligenceCopilotSessionService = {
  createSession(request?: CreateCopilotSessionRequest): Promise<CreateCopilotSessionResult>;
  listSessions(limit?: number): Promise<ListCopilotSessionsResult>;
  getSession(sessionId: string): Promise<GetCopilotSessionResult>;
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

type ValidatedConversationDecision =
  | { readonly status: 'decision'; readonly decision: CopilotConversationDecision; readonly metadata: CopilotModelMetadata | null }
  | { readonly status: 'terminal'; readonly response: CustomerIntelligenceCopilotResponse };

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

export type CopilotOrchestratorDiagnostic = {
  readonly event: 'customer_intelligence_copilot_orchestrator_decision';
  readonly initialAction: string | null;
  readonly selectedAction: string | null;
  readonly validationErrors: readonly string[];
  readonly repairAttempted: boolean;
  readonly repairSucceeded: boolean;
  readonly sessionReferenceCount: number;
  readonly sessionResultCount: number;
  readonly availableSourceQueryIdCount: number;
  readonly followUpContextUsed: boolean;
  readonly activeSemanticEntityType: string | null;
  readonly activeSemanticEntityId: string | number | null;
  readonly unresolvedClarificationPresent: boolean;
  readonly rewrittenAnalyticalQuestionHash: string | null;
  readonly rewrittenAnalyticalQuestionSummary: string | null;
};

export type CopilotPlannerDiagnostic = {
  readonly event: 'customer_intelligence_copilot_planner_validation';
  readonly initialStatus: string | null;
  readonly selectedStatus: string | null;
  readonly validationErrors: readonly string[];
  readonly validationErrorCategories: readonly string[];
  readonly repairAttempted: boolean;
  readonly repairSucceeded: boolean;
  readonly queryStepIds: readonly string[];
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
  readonly onOrchestratorDiagnostic?: (diagnostic: CopilotOrchestratorDiagnostic) => void;
  readonly onPlannerDiagnostic?: (diagnostic: CopilotPlannerDiagnostic) => void;
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
        status: 'active',
        title: null,
        summary: null,
        summaryVersion: null,
        pinnedContext: pinned.context,
        resolvedIds: pinned.resolvedIds,
        turns: [],
        analyticalState: { references: [], results: [] },
      };
      await deps.store.create(session, now);
      return { status: 'created', session: summarize(session) };
    },

    async listSessions(limit = deps.limits.maxActiveSessions) {
      const sessions = await deps.store.list(deps.clock.now(), limit);
      return { status: 'ok', sessions: sessions.map(summarize) };
    },

    async getSession(sessionId) {
      const found = await deps.store.get(sessionId, deps.clock.now());
      if (found.status !== 'found') return { status: found.status };
      return { status: 'ok', session: detail(found.session) };
    },

    async processSessionTurn(request) {
      const found = await deps.store.get(request.sessionId, deps.clock.now());
      if (found.status !== 'found') return { status: found.status };
      const session = found.session;
      const question = trimBounded(request.question, deps.limits.maxQuestionChars);
      const sessionContext = buildCopilotSessionContext(session, deps.limits);
      const turnId = randomUUID();

      if (question.trim().length === 0) {
        const response = withSession({ sessionId: session.sessionId, turnId }, terminal('clarification_required', 'Necesito una pregunta analitica concreta para consultar Customer Intelligence.'));
        const updated = appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits);
        await deps.store.save(updated, deps.clock.now());
        return { status: 'ok', response, sessionContext };
      }

      const decisionResult = await decideConversation({
        question,
        sessionContext,
        model: deps.model,
        onDiagnostic: deps.onOrchestratorDiagnostic,
      });
      if (decisionResult.status === 'terminal') {
        const response = withSession({ sessionId: session.sessionId, turnId }, decisionResult.response);
        await deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
        return { status: 'ok', response, sessionContext };
      }

      if (decisionResult.decision.action === 'respond_directly') {
        const response = withSession(
          { sessionId: session.sessionId, turnId },
          {
            status: 'responded_directly',
            answer: decisionResult.decision.message,
            analysis: {
              contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
              decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
              decisionAction: 'respond_directly',
              orchestratorModel: modelName(decisionResult.metadata),
            },
            provenance: session.pinnedContext,
          },
        );
        await deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
        return { status: 'ok', response, sessionContext };
      }

      if (decisionResult.decision.action === 'clarification_required') {
        const response = withSession({ sessionId: session.sessionId, turnId }, terminal('clarification_required', decisionResult.decision.message));
        await deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
        return { status: 'ok', response, sessionContext };
      }

      if (decisionResult.decision.action === 'unsupported') {
        const response = withSession({ sessionId: session.sessionId, turnId }, terminal('unsupported_operation', decisionResult.decision.message));
        await deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
        return { status: 'ok', response, sessionContext };
      }

      if (decisionResult.decision.action === 'answer_from_context') {
        const response = await answerFromSessionContext({
          session,
          turnId,
          question,
          sourceQueryIds: decisionResult.decision.sourceQueryIds,
          instruction: decisionResult.decision.instruction,
          plannerMetadata: decisionResult.metadata,
          sessionContext,
          model: deps.model,
          now: deps.clock.now(),
          limits: deps.limits,
        });
        await deps.store.save(response.session, deps.clock.now());
        return { status: 'ok', response: response.response, sessionContext };
      }

      const schema = serializeAnalyticalSchemaForCopilot(deps.getAnalyticalSchema());
      const queryContract = serializeAnalyticalQueryContractForCopilot();
      const analyticalQuestion = decisionResult.decision.analyticalQuestion;
      const plannerOutput = await deps.model.generateAnalysisPlan({
        question: analyticalQuestion,
        schema,
        queryContract,
        plannerPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_PROMPT_VERSION,
        maxQueries: CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
        sessionContext,
      });
      const planning = await validateOrRepairPlan({
        rawPlan: plannerOutput.plan,
        plannerMetadata: plannerOutput.metadata,
        question: analyticalQuestion,
        schema,
        queryContract,
        sessionContext,
        model: deps.model,
        onDiagnostic: deps.onPlannerDiagnostic,
      });

      if (planning.status === 'terminal') {
        const response = withSession({ sessionId: session.sessionId, turnId }, planning.response);
        await deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
        return { status: 'ok', response, sessionContext };
      }

      if (planning.status === 'answer_from_context') {
        const answeredContext = await answerFromSessionContext({
          session,
          turnId,
          question,
          sourceQueryIds: planning.sourceQueryIds,
          instruction: question,
          plannerMetadata: planning.plannerMetadata,
          sessionContext,
          model: deps.model,
          now: deps.clock.now(),
          limits: deps.limits,
        });
        await deps.store.save(answeredContext.session, deps.clock.now());
        return { status: 'ok', response: answeredContext.response, sessionContext };
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
            await deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
            return { status: 'ok', response, sessionContext };
          }
          executions.push({ id: step.id, plan: step.plan, result: execution.result });
        }
      } catch (error) {
        const response = withSession({ sessionId: session.sessionId, turnId }, mapAnalyticsError(error));
        await deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
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
        await deps.store.save(updated, deps.clock.now());
        return { status: 'ok', response, sessionContext };
      } catch (error) {
        const response = withSession({ sessionId: session.sessionId, turnId }, answerGenerationFailed(error));
        await deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
        return { status: 'ok', response, sessionContext };
      }
    },

    async refreshSessionContext(sessionId) {
      const found = await deps.store.get(sessionId, deps.clock.now());
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
        turns: appendSystemEvent(found.session.turns, now, 'refresh', deps.limits),
        analyticalState: { references: [], results: [] },
      };
      await deps.store.save(refreshed, now);
      return { status: 'refreshed', session: summarize(refreshed) };
    },

    async resetSession(sessionId) {
      const now = deps.clock.now();
      const found = await deps.store.get(sessionId, now);
      if (found.status !== 'found') return { status: found.status };
      const reset: CopilotSession = {
        ...found.session,
        lastActivityAt: now.toISOString(),
        expiresAt: addMinutes(now, deps.limits.ttlMinutes).toISOString(),
        turns: [],
        analyticalState: { references: [], results: [] },
      };
      await deps.store.save(reset, now);
      return { status: 'reset', session: summarize(reset) };
    },

    async deleteSession(sessionId) {
      return deps.store.delete(sessionId, deps.clock.now());
    },

    async exportSessionQuery(request) {
      const startedAt = deps.clock.now().getTime();
      const found = await deps.store.get(request.sessionId, deps.clock.now());
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
  readonly queryContract: ReturnType<typeof serializeAnalyticalQueryContractForCopilot>;
  readonly sessionContext: ReturnType<typeof buildCopilotSessionContext>;
  readonly model: CustomerIntelligenceCopilotModel;
  readonly onDiagnostic?: (diagnostic: CopilotPlannerDiagnostic) => void;
}): Promise<
  | { readonly status: 'query_plan'; readonly steps: readonly ValidatedStep[]; readonly plannerMetadata: CopilotModelMetadata | null }
  | { readonly status: 'answer_from_context'; readonly sourceQueryIds: readonly string[]; readonly plannerMetadata: CopilotModelMetadata | null }
  | { readonly status: 'terminal'; readonly response: CustomerIntelligenceCopilotResponse }
> {
  const first = validatePlanEnvelopeAndQueries(args.rawPlan);
  if (first.ok) {
    emitPlannerDiagnostic(args.onDiagnostic, {
      initialPlan: args.rawPlan,
      selectedPlan: first.plan,
      validationErrors: [],
      repairAttempted: false,
      repairSucceeded: false,
      queryStepIds: first.steps.map((step) => step.id),
    });
    if (first.plan.status === 'query_plan') return { status: 'query_plan', steps: first.steps, plannerMetadata: args.plannerMetadata };
    if (first.plan.status === 'answer_from_context') return { status: 'answer_from_context', sourceQueryIds: first.plan.sourceQueryIds, plannerMetadata: args.plannerMetadata };
    return { status: 'terminal', response: terminal(first.plan.status, first.plan.message) };
  }

  for (let attempt = 0; attempt < CUSTOMER_INTELLIGENCE_COPILOT_PLAN_REPAIR_ATTEMPTS; attempt += 1) {
    const repairOutput = await args.model.repairAnalysisPlan({
      question: args.question,
      schema: args.schema,
      queryContract: args.queryContract,
      plannerPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_PROMPT_VERSION,
      maxQueries: CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
      sessionContext: args.sessionContext,
      previousPlan: args.rawPlan,
      validationErrors: first.errors,
    });
    const validation = validatePlanEnvelopeAndQueries(repairOutput.plan);
    if (validation.ok) {
      emitPlannerDiagnostic(args.onDiagnostic, {
        initialPlan: args.rawPlan,
        selectedPlan: validation.plan,
        validationErrors: first.errors,
        repairAttempted: true,
        repairSucceeded: true,
        queryStepIds: validation.steps.map((step) => step.id),
      });
      if (validation.plan.status === 'query_plan') return { status: 'query_plan', steps: validation.steps, plannerMetadata: repairOutput.metadata };
      if (validation.plan.status === 'answer_from_context') return { status: 'answer_from_context', sourceQueryIds: validation.plan.sourceQueryIds, plannerMetadata: repairOutput.metadata };
      return { status: 'terminal', response: terminal(validation.plan.status, validation.plan.message) };
    }
    const validationErrors = [...first.errors, ...validation.errors];
    emitPlannerDiagnostic(args.onDiagnostic, {
      initialPlan: args.rawPlan,
      selectedPlan: null,
      validationErrors,
      repairAttempted: true,
      repairSucceeded: false,
      queryStepIds: [],
    });
    return { status: 'terminal', response: plannerInvalid(validationErrors) };
  }
  emitPlannerDiagnostic(args.onDiagnostic, {
    initialPlan: args.rawPlan,
    selectedPlan: null,
    validationErrors: first.errors,
    repairAttempted: false,
    repairSucceeded: false,
    queryStepIds: [],
  });
  return { status: 'terminal', response: plannerInvalid(first.errors) };
}

async function decideConversation(args: {
  readonly question: string;
  readonly sessionContext: ReturnType<typeof buildCopilotSessionContext>;
  readonly model: CustomerIntelligenceCopilotModel;
  readonly onDiagnostic?: (diagnostic: CopilotOrchestratorDiagnostic) => void;
}): Promise<ValidatedConversationDecision> {
  const actionConstraints = buildConversationDecisionActionConstraints(args.question, args.sessionContext);
  try {
    const output = await args.model.generateConversationDecision({
      question: args.question,
      orchestratorPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_ORCHESTRATOR_PROMPT_VERSION,
      sessionContext: args.sessionContext,
      actionConstraints,
    });
    const first = validateCopilotConversationDecision(output.decision, { question: args.question, sessionContext: args.sessionContext });
    if (first.ok) {
      emitOrchestratorDiagnostic(args.onDiagnostic, {
        actionConstraints,
        sessionContext: args.sessionContext,
        initialAction: actionFromUnknown(output.decision),
        question: args.question,
        selectedDecision: first.decision,
        selectedAction: first.decision.action,
        validationErrors: [],
        repairAttempted: false,
        repairSucceeded: false,
      });
      return { status: 'decision', decision: first.decision, metadata: output.metadata };
    }

    for (let attempt = 0; attempt < CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_REPAIR_ATTEMPTS; attempt += 1) {
      const repair = await args.model.repairConversationDecision({
        question: args.question,
        orchestratorPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_ORCHESTRATOR_PROMPT_VERSION,
        sessionContext: args.sessionContext,
        actionConstraints,
        previousDecision: output.decision,
        validationErrors: first.errors,
      });
      const repaired = validateCopilotConversationDecision(repair.decision, { question: args.question, sessionContext: args.sessionContext });
      if (repaired.ok) {
        emitOrchestratorDiagnostic(args.onDiagnostic, {
          actionConstraints,
          sessionContext: args.sessionContext,
          initialAction: actionFromUnknown(output.decision),
          question: args.question,
          selectedDecision: repaired.decision,
          selectedAction: repaired.decision.action,
          validationErrors: first.errors,
          repairAttempted: true,
          repairSucceeded: true,
        });
        return { status: 'decision', decision: repaired.decision, metadata: repair.metadata };
      }
      const validationErrors = [...first.errors, ...repaired.errors];
      emitOrchestratorDiagnostic(args.onDiagnostic, {
        actionConstraints,
        sessionContext: args.sessionContext,
        initialAction: actionFromUnknown(output.decision),
        question: args.question,
        selectedDecision: null,
        selectedAction: null,
        validationErrors,
        repairAttempted: true,
        repairSucceeded: false,
      });
      return { status: 'terminal', response: orchestratorInvalid(validationErrors) };
    }
    emitOrchestratorDiagnostic(args.onDiagnostic, {
      actionConstraints,
      sessionContext: args.sessionContext,
      initialAction: actionFromUnknown(output.decision),
      question: args.question,
      selectedDecision: null,
      selectedAction: null,
      validationErrors: first.errors,
      repairAttempted: false,
      repairSucceeded: false,
    });
    return { status: 'terminal', response: orchestratorInvalid(first.errors) };
  } catch (error) {
    return { status: 'terminal', response: mapProviderError(error) ?? answerGenerationFailed(error) };
  }
}

function buildConversationDecisionActionConstraints(
  question: string,
  sessionContext: ReturnType<typeof buildCopilotSessionContext>,
): CopilotConversationDecisionActionConstraints {
  const availableSourceQueryIds = availableSourceQueryIdsFor(sessionContext);
  const answerFromContextAllowed = availableSourceQueryIds.length > 0;
  const freshBusinessFactQuestion = asksForFreshBusinessFact(question);
  const allowedActions: CopilotConversationDecisionAction[] = [
    ...(freshBusinessFactQuestion ? [] : (['respond_directly'] as const)),
    'clarification_required',
    ...(answerFromContextAllowed ? (['answer_from_context'] as const) : []),
    'run_analytics',
    'unsupported',
  ];

  return {
    decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
    allowedActions,
    availableSourceQueryIds,
    sessionReferenceCount: sessionContext.analyticalReferences.length,
    sessionResultCount: sessionContext.recentResults.length,
    answerFromContextAllowed,
    freshBusinessFactQuestion,
    rules: [
      'If a fresh Customer Intelligence fact, count, aggregate, ranking, segmentation value, or population value is requested and no session source already answers it, choose run_analytics.',
      'answer_from_context is allowed only with sourceQueryIds from availableSourceQueryIds.',
      'Never invent sourceQueryIds.',
      'If answerFromContextAllowed is false, do not choose answer_from_context.',
      'respond_directly is not allowed when freshBusinessFactQuestion is true.',
      'Regenerate a complete decision envelope during repair.',
    ],
    allowedActionEnvelopes: allowedDecisionEnvelopes(allowedActions, availableSourceQueryIds),
  };
}

function availableSourceQueryIdsFor(sessionContext: ReturnType<typeof buildCopilotSessionContext>): readonly string[] {
  return [
    ...new Set([
      ...sessionContext.analyticalReferences.map((reference) => reference.sourceQueryId),
      ...sessionContext.recentResults.map((result) => result.queryId),
    ]),
  ];
}

function allowedDecisionEnvelopes(
  allowedActions: readonly CopilotConversationDecisionAction[],
  availableSourceQueryIds: readonly string[],
): readonly Record<string, unknown>[] {
  const envelopes: Record<string, unknown>[] = [];
  if (allowedActions.includes('respond_directly')) {
    envelopes.push({
      decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
      action: 'respond_directly',
      message: 'RFM clasifica clientes por recencia, frecuencia y valor monetario.',
    });
  }
  if (allowedActions.includes('clarification_required')) {
    envelopes.push({
      decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
      action: 'clarification_required',
      message: 'Necesito un criterio concreto para comparar los grupos.',
    });
  }
  if (allowedActions.includes('answer_from_context')) {
    envelopes.push({
      decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
      action: 'answer_from_context',
      sourceQueryIds: [availableSourceQueryIds[0]],
      instruction: 'Usa el resultado previo citado para responder la pregunta.',
    });
  }
  if (allowedActions.includes('run_analytics')) {
    envelopes.push({
      decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
      action: 'run_analytics',
      analyticalQuestion: 'Cuantos clientes hay en la poblacion actual de Customer Intelligence?',
    });
  }
  if (allowedActions.includes('unsupported')) {
    envelopes.push({
      decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
      action: 'unsupported',
      message: 'La solicitud esta fuera del runtime acotado de Customer Intelligence.',
    });
  }
  return envelopes;
}

function emitOrchestratorDiagnostic(
  onDiagnostic: ((diagnostic: CopilotOrchestratorDiagnostic) => void) | undefined,
  args: {
    readonly actionConstraints: CopilotConversationDecisionActionConstraints;
    readonly sessionContext: ReturnType<typeof buildCopilotSessionContext>;
    readonly initialAction: string | null;
    readonly question: string;
    readonly selectedDecision: CopilotConversationDecision | null;
    readonly selectedAction: string | null;
    readonly validationErrors: readonly string[];
    readonly repairAttempted: boolean;
    readonly repairSucceeded: boolean;
  },
): void {
  onDiagnostic?.({
    event: 'customer_intelligence_copilot_orchestrator_decision',
    initialAction: args.initialAction,
    selectedAction: args.selectedAction,
    validationErrors: args.validationErrors,
    repairAttempted: args.repairAttempted,
    repairSucceeded: args.repairSucceeded,
    sessionReferenceCount: args.actionConstraints.sessionReferenceCount,
    sessionResultCount: args.actionConstraints.sessionResultCount,
    availableSourceQueryIdCount: args.actionConstraints.availableSourceQueryIds.length,
    followUpContextUsed: isLikelyFollowUp(args.question) && (args.sessionContext.semanticFocus.activeEntity !== null || args.sessionContext.semanticFocus.unresolvedClarification !== null),
    activeSemanticEntityType: args.sessionContext.semanticFocus.activeEntity?.type ?? null,
    activeSemanticEntityId: args.sessionContext.semanticFocus.activeEntity?.id ?? null,
    unresolvedClarificationPresent: args.sessionContext.semanticFocus.unresolvedClarification !== null,
    rewrittenAnalyticalQuestionHash: args.selectedDecision?.action === 'run_analytics' ? safeHash(args.selectedDecision.analyticalQuestion) : null,
    rewrittenAnalyticalQuestionSummary: args.selectedDecision?.action === 'run_analytics' ? trimBounded(args.selectedDecision.analyticalQuestion, 160) : null,
  });
}

function actionFromUnknown(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const action = (value as Record<string, unknown>).action;
  return typeof action === 'string' ? action : null;
}

function isLikelyFollowUp(question: string): boolean {
  const normalized = question
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  return (
    normalized.length <= 80 &&
    /^(por que|y\b|y el\b|y la\b|versus|eso|cual de esos|que pasa con ese|que pasa con esa|cuanto era|cual era|por gasto|por ticket|por frecuencia|por recencia)/.test(normalized)
  );
}

function safeHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function answerFromSessionContext(args: {
  readonly session: CopilotSession;
  readonly turnId: string;
  readonly question: string;
  readonly sourceQueryIds: readonly string[];
  readonly instruction: string;
  readonly plannerMetadata: CopilotModelMetadata | null;
  readonly sessionContext: ReturnType<typeof buildCopilotSessionContext>;
  readonly model: CustomerIntelligenceCopilotModel;
  readonly now: Date;
  readonly limits: CopilotSessionLimits;
}): Promise<{ readonly session: CopilotSession; readonly response: { readonly sessionId: string; readonly turnId: string; readonly queryIds: readonly string[]; readonly sourceQueryIds: readonly string[] } & CustomerIntelligenceCopilotResponse }> {
  const sources = args.sourceQueryIds.map((queryId) => args.session.analyticalState.results.find((entry) => entry.queryId === queryId)).filter((entry): entry is CopilotSessionQueryResult => entry !== undefined);
  if (sources.length !== args.sourceQueryIds.length) {
    const response = withSession({ sessionId: args.session.sessionId, turnId: args.turnId, queryIds: [], sourceQueryIds: args.sourceQueryIds }, orchestratorInvalid(['answer_from_context referenced an unknown session query']));
    return {
      response,
      session: appendTurn(args.session, response, args.question, [], args.sourceQueryIds, args.now, args.limits),
    };
  }
  try {
    const answerOutput = await args.model.generateAnswer({
      question: `${args.question}\n\nContext instruction: ${args.instruction}`,
      answerPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANSWER_PROMPT_VERSION,
      context: args.session.pinnedContext,
      sessionContext: args.sessionContext,
      executions: sources.map((source) => ({ id: source.queryId, plan: source.plan, result: source.result })),
    });
    const response = withSession(
      { sessionId: args.session.sessionId, turnId: args.turnId, queryIds: [], sourceQueryIds: args.sourceQueryIds },
      {
        status: 'answered_from_context',
        answer: answerOutput.answer,
        analysis: {
          contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
          analysisPlanVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
          sourceQueryIds: args.sourceQueryIds,
          resultRowCount: sources.reduce((sum, source) => sum + source.result.rowCount, 0),
          plannerModel: modelName(args.plannerMetadata),
          answerModel: modelName(answerOutput.metadata),
        },
        provenance: args.session.pinnedContext,
      },
    );
    return {
      response,
      session: appendTurn(args.session, response, args.question, [], args.sourceQueryIds, args.now, args.limits),
    };
  } catch (error) {
    const mapped = mapProviderError(error) ?? answerGenerationFailed(error);
    const response = withSession({ sessionId: args.session.sessionId, turnId: args.turnId, queryIds: [], sourceQueryIds: args.sourceQueryIds }, mapped);
    return {
      response,
      session: appendTurn(args.session, response, args.question, [], args.sourceQueryIds, args.now, args.limits),
    };
  }
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

function emitPlannerDiagnostic(
  onDiagnostic: ((diagnostic: CopilotPlannerDiagnostic) => void) | undefined,
  args: {
    readonly initialPlan: unknown;
    readonly selectedPlan: CopilotAnalysisPlan | null;
    readonly validationErrors: readonly string[];
    readonly repairAttempted: boolean;
    readonly repairSucceeded: boolean;
    readonly queryStepIds: readonly string[];
  },
): void {
  onDiagnostic?.({
    event: 'customer_intelligence_copilot_planner_validation',
    initialStatus: statusFromUnknown(args.initialPlan),
    selectedStatus: args.selectedPlan?.status ?? null,
    validationErrors: args.validationErrors,
    validationErrorCategories: [...new Set(args.validationErrors.map(plannerValidationErrorCategory))],
    repairAttempted: args.repairAttempted,
    repairSucceeded: args.repairSucceeded,
    queryStepIds: args.queryStepIds,
  });
}

function statusFromUnknown(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = (value as Record<string, unknown>).status;
  return typeof status === 'string' ? status : null;
}

function plannerValidationErrorCategory(error: string): string {
  if (/plan must specify either "select".*or "metrics"/.test(error)) return 'missing_query_mode';
  if (/alias matching/.test(error)) return 'invalid_metric_alias';
  if (/cannot mix row-mode "select" with aggregate-mode "metrics"/.test(error)) return 'mixed_query_modes';
  if (/requires a string field/.test(error)) return 'missing_metric_field';
  if (/unsupported aggregation/.test(error)) return 'unsupported_aggregation';
  if (/unknown field/.test(error)) return 'unknown_field';
  if (/invalid orderBy field/.test(error)) return 'invalid_order_by';
  if (/requires a structured AnalyticalQueryPlan/.test(error)) return 'malformed_query_plan';
  if (/query_plan requires at least one query/.test(error)) return 'missing_queries';
  if (/unsupported planVersion/.test(error)) return 'unsupported_version';
  return 'other_validation_error';
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
  const assistantAnswer =
    'answer' in response
      ? trimBounded(response.answer, limits.maxAnswerChars)
      : 'message' in response
        ? trimBounded(response.message, limits.maxAnswerChars)
        : null;
  const turn = {
    turnId: response.turnId,
    createdAt: now.toISOString(),
    userQuestion: trimBounded(question, limits.maxQuestionChars),
    assistantStatus: response.status,
    assistantAnswer,
    queryIds,
    sourceQueryIds,
  };
  const turns = [...session.turns, turn];
  return {
    ...session,
    lastActivityAt: now.toISOString(),
    expiresAt: addMinutes(now, limits.ttlMinutes).toISOString(),
    summary: summarizeConversation(turns, limits),
    summaryVersion: turns.length >= limits.summaryAfterTurns ? 'customer-intelligence-conversation-summary-v1' : session.summaryVersion ?? null,
    turns: turns.slice(-limits.maxTurns),
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

function orchestratorInvalid(errors: readonly string[]): CustomerIntelligenceCopilotResponse {
  return { status: 'orchestrator_invalid', errors, contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION };
}

function plannerInvalid(errors: readonly string[]): CustomerIntelligenceCopilotResponse {
  return { status: 'planner_invalid', errors, contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION };
}

function answerGenerationFailed(error: unknown): CustomerIntelligenceCopilotResponse {
  const provider = mapProviderError(error);
  if (provider) return provider;
  return {
    status: 'answer_generation_failed',
    message: error instanceof Error ? error.message : 'Answer generation failed',
    contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
  };
}

function mapProviderError(error: unknown): CustomerIntelligenceCopilotResponse | null {
  if (!error || typeof error !== 'object') return null;
  const category = (error as { readonly category?: unknown }).category;
  if (
    category === 'provider_authentication_error' ||
    category === 'provider_billing_error' ||
    category === 'provider_rate_limited' ||
    category === 'provider_timeout' ||
    category === 'provider_network_error' ||
    category === 'provider_invalid_response'
  ) {
    return {
      status: category,
      message: error instanceof Error ? error.message : category,
      contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
    };
  }
  return null;
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
    status: session.status ?? 'active',
    title: session.title ?? null,
    summary: session.summary ?? null,
    pinnedContext: session.pinnedContext,
    turnCount: session.turns.length,
    resultCount: session.analyticalState.results.length,
  };
}

function detail(session: CopilotSession): CopilotSessionDetail {
  return {
    ...summarize(session),
    turns: session.turns,
    analyticalReferences: session.analyticalState.references,
  };
}

function appendSystemEvent(turns: readonly CopilotSessionTurn[], now: Date, event: 'refresh', limits: CopilotSessionLimits): readonly CopilotSessionTurn[] {
  return [
    ...turns,
    {
      turnId: `system_${event}_${now.getTime()}`,
      createdAt: now.toISOString(),
      userQuestion: '',
      assistantStatus: `system_${event}`,
      assistantAnswer: event === 'refresh' ? 'Snapshot context refreshed explicitly.' : null,
      queryIds: [],
      sourceQueryIds: [],
    },
  ].slice(-limits.maxTurns);
}

function summarizeConversation(turns: readonly CopilotSessionTurn[], limits: CopilotSessionLimits): string | null {
  if (turns.length < limits.summaryAfterTurns) return null;
  return turns
    .slice(-limits.summaryAfterTurns)
    .map((turn) => {
      const answer = turn.assistantAnswer ? ` -> ${turn.assistantAnswer}` : ` -> ${turn.assistantStatus}`;
      return `${turn.userQuestion}${answer}`.trim();
    })
    .filter((line) => line.length > 0)
    .join('\n')
    .slice(0, 4000);
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
