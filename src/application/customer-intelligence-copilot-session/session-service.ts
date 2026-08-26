import { createHash, randomUUID } from 'node:crypto';
import {
  CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
  CUSTOMER_INTELLIGENCE_COPILOT_PLAN_REPAIR_ATTEMPTS,
  CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_REPAIR_ATTEMPTS,
  CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
  CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_REPAIR_ATTEMPTS,
  CUSTOMER_INTELLIGENCE_COPILOT_UNIFIED_PLANNER_PROMPT_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_PROMPT_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_ORCHESTRATOR_PROMPT_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_ANSWER_PROMPT_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_TOOL_RUNTIME_INSTRUCTIONS,
  CUSTOMER_INTELLIGENCE_COPILOT_TOOL_RUNTIME_PROMPT_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_RUN_ANALYTICAL_QUERIES_TOOL,
  CUSTOMER_INTELLIGENCE_COPILOT_SESSION_VERSION,
  asksForFreshBusinessFact,
  serializeAnalyticalQueryContractForCopilot,
  serializeAnalyticalSchemaForCopilot,
  validateCopilotAnalysisPlan,
  validateCopilotConversationDecision,
  validateCopilotConversationPlan,
  type CopilotAnalysisPlan,
  type CopilotConversationDecisionAction,
  type CopilotConversationDecisionActionConstraints,
  type CopilotConversationDecision,
  type CopilotConversationPlan,
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
import type {
  AnalyticalSchemaProvider,
  CustomerIntelligenceCopilotModel,
  CopilotConversationalMessage,
  CopilotModelMetadata,
  CopilotToolCall,
  CopilotToolDefinition,
} from '../customer-intelligence-copilot/index.js';
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

type ValidatedConversationPlan =
  | {
      readonly status: 'decision';
      readonly decision: CopilotConversationDecision;
      readonly metadata: CopilotModelMetadata | null;
      readonly planning: { readonly status: 'query_plan'; readonly steps: readonly ValidatedStep[]; readonly plannerMetadata: CopilotModelMetadata | null } | null;
    }
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

type CopilotLatencyStage =
  | 'tool_selection'
  | 'tool_synthesis'
  | 'orchestrator'
  | 'orchestrator_repair'
  | 'planner'
  | 'planner_repair'
  | 'unified_planner'
  | 'unified_planner_repair'
  | 'analytics_execution'
  | 'answerer'
  | 'turn';

type CopilotExecutionMode = 'fast_path' | 'direct_response' | 'simple_analysis' | 'deep_analysis';

export type CopilotStageLatencyDiagnostic = {
  readonly event: 'customer_intelligence_copilot_stage_latency';
  readonly stage: CopilotLatencyStage;
  readonly provider: string | null;
  readonly model: string | null;
  readonly durationMs: number;
  readonly success: boolean;
  readonly failureStatus: string | null;
  readonly repairAttempted: boolean;
  readonly queryCount: number;
  readonly analyticsExecutionDurationMs: number;
  readonly totalTurnDurationMs: number;
  readonly executionMode: CopilotExecutionMode | null;
  readonly promptCharCount?: number;
  readonly responseCharCount?: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
  readonly promptCacheHitTokens?: number;
  readonly promptCacheMissTokens?: number;
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
  readonly toolRuntimeEnabled?: boolean;
  readonly unifiedPlannerEnabled?: boolean;
  readonly onOrchestratorDiagnostic?: (diagnostic: CopilotOrchestratorDiagnostic) => void;
  readonly onPlannerDiagnostic?: (diagnostic: CopilotPlannerDiagnostic) => void;
  readonly onStageLatencyDiagnostic?: (diagnostic: CopilotStageLatencyDiagnostic) => void;
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
      const turnStartedAt = Date.now();
      const found = await deps.store.get(request.sessionId, deps.clock.now());
      if (found.status !== 'found') return { status: found.status };
      const session = found.session;
      const question = trimBounded(request.question, deps.limits.maxQuestionChars);
      const sessionContext = buildCopilotSessionContext(session, deps.limits);
      const turnId = randomUUID();
      let analyticsExecutionDurationMs = 0;

      if (question.trim().length === 0) {
        const response = withSession({ sessionId: session.sessionId, turnId }, terminal('clarification_required', 'Necesito una pregunta analitica concreta para consultar Customer Intelligence.'));
        const updated = appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits);
        await deps.store.save(updated, deps.clock.now());
        return { status: 'ok', response, sessionContext };
      }

      if (deps.toolRuntimeEnabled ?? false) {
        if (!deps.model.generateConversationalTurn) {
          const response = withSession({ sessionId: session.sessionId, turnId }, terminal('unsupported_operation', 'El proveedor configurado no soporta native tool calling para Customer Intelligence.'));
          await deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
          emitTurnLatency(deps.onStageLatencyDiagnostic, {
            turnStartedAt,
            queryCount: 0,
            analyticsExecutionDurationMs,
            success: false,
            failureStatus: 'tool_calling_unsupported',
            executionMode: 'direct_response',
          });
          return { status: 'ok', response, sessionContext };
        }
        return processToolRuntimeTurn({
          session,
          turnId,
          question,
          sessionContext,
          schema: serializeAnalyticalSchemaForCopilot(deps.getAnalyticalSchema()),
          queryContract: serializeAnalyticalQueryContractForCopilot(),
          model: deps.model,
          executeAnalyticalQuery: deps.executeAnalyticalQuery,
          store: deps.store,
          clock: deps.clock,
          limits: deps.limits,
          onStageLatencyDiagnostic: deps.onStageLatencyDiagnostic,
          turnStartedAt,
        });
      }

      if ((deps.unifiedPlannerEnabled ?? false) && deps.model.generateConversationPlan && deps.model.repairConversationPlan) {
        const schema = serializeAnalyticalSchemaForCopilot(deps.getAnalyticalSchema());
        const queryContract = serializeAnalyticalQueryContractForCopilot();
        const unified = await decideAndPlanConversation({
          question,
          schema,
          queryContract,
          sessionContext,
          model: deps.model,
          onPlannerDiagnostic: deps.onPlannerDiagnostic,
          onStageLatencyDiagnostic: deps.onStageLatencyDiagnostic,
          turnStartedAt,
        });
        if (unified.status === 'terminal') {
          const response = withSession({ sessionId: session.sessionId, turnId }, unified.response);
          await deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
          emitTurnLatency(deps.onStageLatencyDiagnostic, {
            turnStartedAt,
            queryCount: 0,
            analyticsExecutionDurationMs,
            success: false,
            failureStatus: response.status,
          });
          return { status: 'ok', response, sessionContext };
        }

        if (unified.decision.action === 'respond_directly') {
          const response = withSession(
            { sessionId: session.sessionId, turnId },
            {
              status: 'responded_directly',
              answer: unified.decision.message,
              analysis: {
                contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
                decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
                decisionAction: 'respond_directly',
                orchestratorModel: modelName(unified.metadata),
              },
              provenance: session.pinnedContext,
            },
          );
          await deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
          emitTurnLatency(deps.onStageLatencyDiagnostic, { turnStartedAt, queryCount: 0, analyticsExecutionDurationMs, success: true, failureStatus: null, executionMode: 'fast_path' });
          return { status: 'ok', response, sessionContext };
        }

        if (unified.decision.action === 'clarification_required') {
          const response = withSession({ sessionId: session.sessionId, turnId }, terminal('clarification_required', unified.decision.message));
          await deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
          emitTurnLatency(deps.onStageLatencyDiagnostic, { turnStartedAt, queryCount: 0, analyticsExecutionDurationMs, success: true, failureStatus: null, executionMode: 'fast_path' });
          return { status: 'ok', response, sessionContext };
        }

        if (unified.decision.action === 'unsupported') {
          const response = withSession({ sessionId: session.sessionId, turnId }, terminal('unsupported_operation', unified.decision.message));
          await deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
          emitTurnLatency(deps.onStageLatencyDiagnostic, { turnStartedAt, queryCount: 0, analyticsExecutionDurationMs, success: true, failureStatus: null, executionMode: 'fast_path' });
          return { status: 'ok', response, sessionContext };
        }

        if (unified.decision.action === 'answer_from_context') {
          const answeredContext = await answerFromSessionContext({
            session,
            turnId,
            question,
            sourceQueryIds: unified.decision.sourceQueryIds,
            instruction: unified.decision.instruction,
            plannerMetadata: unified.metadata,
            sessionContext,
            model: deps.model,
            now: deps.clock.now(),
            limits: deps.limits,
            onStageLatencyDiagnostic: deps.onStageLatencyDiagnostic,
            turnStartedAt,
          });
          await deps.store.save(answeredContext.session, deps.clock.now());
          emitTurnLatency(deps.onStageLatencyDiagnostic, {
            turnStartedAt,
            queryCount: answeredContext.response.queryIds.length,
            analyticsExecutionDurationMs,
            success: answeredContext.response.status === 'answered_from_context',
            failureStatus: answeredContext.response.status === 'answered_from_context' ? null : answeredContext.response.status,
            executionMode: 'fast_path',
          });
          return { status: 'ok', response: answeredContext.response, sessionContext };
        }

        if (!unified.planning) {
          const response = withSession({ sessionId: session.sessionId, turnId }, orchestratorInvalid(['run_analytics unified plan did not include validated planning output']));
          await deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
          return { status: 'ok', response, sessionContext };
        }
        return executePlannedAnalyticsTurn({
          session,
          turnId,
          question,
          planning: unified.planning,
          sessionContext,
          executeAnalyticalQuery: deps.executeAnalyticalQuery,
          model: deps.model,
          store: deps.store,
          clock: deps.clock,
          limits: deps.limits,
          onStageLatencyDiagnostic: deps.onStageLatencyDiagnostic,
          turnStartedAt,
        });
      }

      const decisionResult = await decideConversation({
        question,
        sessionContext,
        model: deps.model,
        onDiagnostic: deps.onOrchestratorDiagnostic,
        onStageLatencyDiagnostic: deps.onStageLatencyDiagnostic,
        turnStartedAt,
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
          onStageLatencyDiagnostic: deps.onStageLatencyDiagnostic,
          turnStartedAt,
        });
        await deps.store.save(response.session, deps.clock.now());
        emitTurnLatency(deps.onStageLatencyDiagnostic, {
          turnStartedAt,
          queryCount: response.response.queryIds.length,
          analyticsExecutionDurationMs: 0,
          success: response.response.status === 'answered_from_context',
          failureStatus: response.response.status === 'answered_from_context' ? null : response.response.status,
        });
        return { status: 'ok', response: response.response, sessionContext };
      }

      const schema = serializeAnalyticalSchemaForCopilot(deps.getAnalyticalSchema());
      const queryContract = serializeAnalyticalQueryContractForCopilot();
      const analyticalQuestion = decisionResult.decision.analyticalQuestion;
      let planning: Awaited<ReturnType<typeof validateOrRepairPlan>>;
      try {
        const plannerOutput = await timeCopilotStage({
          stage: 'planner',
          onDiagnostic: deps.onStageLatencyDiagnostic,
          turnStartedAt,
          repairAttempted: false,
          queryCount: 0,
          analyticsExecutionDurationMs,
          queryCountFromOutput: (output) => queryCountFromRawPlan(output.plan),
          call: () =>
            deps.model.generateAnalysisPlan({
              question: analyticalQuestion,
              schema,
              queryContract,
              plannerPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_PROMPT_VERSION,
              maxQueries: CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
              sessionContext,
            }),
        });
        planning = await validateOrRepairPlan({
          rawPlan: plannerOutput.plan,
          plannerMetadata: plannerOutput.metadata,
          question: analyticalQuestion,
          schema,
          queryContract,
          sessionContext,
          model: deps.model,
          onDiagnostic: deps.onPlannerDiagnostic,
          onStageLatencyDiagnostic: deps.onStageLatencyDiagnostic,
          turnStartedAt,
          analyticsExecutionDurationMs,
        });
      } catch (error) {
        const response = withSession({ sessionId: session.sessionId, turnId }, answerGenerationFailed(error));
        await deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
        emitTurnLatency(deps.onStageLatencyDiagnostic, {
          turnStartedAt,
          queryCount: 0,
          analyticsExecutionDurationMs,
          success: false,
          failureStatus: diagnosticFailureStatus(error) ?? response.status,
        });
        return { status: 'ok', response, sessionContext };
      }

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
          onStageLatencyDiagnostic: deps.onStageLatencyDiagnostic,
          turnStartedAt,
        });
        await deps.store.save(answeredContext.session, deps.clock.now());
        emitTurnLatency(deps.onStageLatencyDiagnostic, {
          turnStartedAt,
          queryCount: answeredContext.response.queryIds.length,
          analyticsExecutionDurationMs: 0,
          success: answeredContext.response.status === 'answered_from_context',
          failureStatus: answeredContext.response.status === 'answered_from_context' ? null : answeredContext.response.status,
        });
        return { status: 'ok', response: answeredContext.response, sessionContext };
      }

      const executionMode = executionModeForSteps(planning.steps);
      let executions: readonly { readonly id: string; readonly plan: AnalyticalQueryPlan; readonly result: AnalyticalQueryResult }[] = [];
      const analyticsStartedAt = Date.now();
      try {
        const executionResult = await executeAnalyticalSteps({
          steps: planning.steps,
          executeAnalyticalQuery: deps.executeAnalyticalQuery,
          context: session.pinnedContext,
          resolvedIds: session.resolvedIds,
        });
        if (executionResult.status === 'invalid_plan') {
          analyticsExecutionDurationMs = 0;
          emitStageLatency(deps.onStageLatencyDiagnostic, {
            stage: 'analytics_execution',
            provider: null,
            model: null,
            durationMs: durationSince(analyticsStartedAt),
            success: false,
            failureStatus: 'planner_invalid',
            repairAttempted: false,
            queryCount: planning.steps.length,
            analyticsExecutionDurationMs,
            totalTurnDurationMs: durationSince(turnStartedAt),
            executionMode,
          });
          const response = withSession({ sessionId: session.sessionId, turnId }, plannerInvalid(executionResult.errors));
          await deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
          emitTurnLatency(deps.onStageLatencyDiagnostic, {
            turnStartedAt,
            queryCount: planning.steps.length,
            analyticsExecutionDurationMs,
            success: false,
            failureStatus: response.status,
            executionMode,
          });
          return { status: 'ok', response, sessionContext };
        }
        executions = executionResult.executions;
      } catch (error) {
        analyticsExecutionDurationMs = sumAnalyticsExecutionDurationMs(executions);
        emitStageLatency(deps.onStageLatencyDiagnostic, {
          stage: 'analytics_execution',
          provider: null,
          model: null,
          durationMs: durationSince(analyticsStartedAt),
          success: false,
          failureStatus: analyticsFailureStatus(error),
          repairAttempted: false,
          queryCount: planning.steps.length,
          analyticsExecutionDurationMs,
          totalTurnDurationMs: durationSince(turnStartedAt),
          executionMode,
        });
        const response = withSession({ sessionId: session.sessionId, turnId }, mapAnalyticsError(error));
        await deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
        emitTurnLatency(deps.onStageLatencyDiagnostic, {
          turnStartedAt,
          queryCount: planning.steps.length,
          analyticsExecutionDurationMs,
          success: false,
          failureStatus: response.status,
          executionMode,
        });
        return { status: 'ok', response, sessionContext };
      }
      analyticsExecutionDurationMs = sumAnalyticsExecutionDurationMs(executions);
      emitStageLatency(deps.onStageLatencyDiagnostic, {
        stage: 'analytics_execution',
        provider: null,
        model: null,
        durationMs: durationSince(analyticsStartedAt),
        success: true,
        failureStatus: null,
        repairAttempted: false,
        queryCount: planning.steps.length,
        analyticsExecutionDurationMs,
        totalTurnDurationMs: durationSince(turnStartedAt),
        executionMode,
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
      const deterministicAnswer = renderDeterministicSimpleAnswer(executions, session.pinnedContext);
      if (deterministicAnswer) {
        const response = withSession(
          { sessionId: session.sessionId, turnId, queryIds: queryResults.map((entry) => entry.queryId), sourceQueryIds: [] },
          answered(executions, deterministicAnswer, planning.plannerMetadata, null, session.pinnedContext),
        );
        const updated = appendResults(appendTurn(session, response, question, queryResults.map((entry) => entry.queryId), [], deps.clock.now(), deps.limits), queryResults, deps.limits);
        await deps.store.save(updated, deps.clock.now());
        emitTurnLatency(deps.onStageLatencyDiagnostic, {
          turnStartedAt,
          queryCount: executions.length,
          analyticsExecutionDurationMs,
          success: true,
          failureStatus: null,
          executionMode: 'fast_path',
        });
        return { status: 'ok', response, sessionContext };
      }

      try {
        const answerOutput = await timeCopilotStage({
          stage: 'answerer',
          onDiagnostic: deps.onStageLatencyDiagnostic,
          turnStartedAt,
          repairAttempted: false,
          queryCount: executions.length,
          analyticsExecutionDurationMs,
          executionMode,
          call: () =>
            deps.model.generateAnswer({
              question,
              answerPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANSWER_PROMPT_VERSION,
              context: session.pinnedContext,
              sessionContext,
              executions,
            }),
        });
        const response = withSession(
          { sessionId: session.sessionId, turnId, queryIds: queryResults.map((entry) => entry.queryId), sourceQueryIds: [] },
          answered(executions, answerOutput.answer, planning.plannerMetadata, answerOutput.metadata, session.pinnedContext),
        );
        const updated = appendResults(appendTurn(session, response, question, queryResults.map((entry) => entry.queryId), [], deps.clock.now(), deps.limits), queryResults, deps.limits);
        await deps.store.save(updated, deps.clock.now());
        emitTurnLatency(deps.onStageLatencyDiagnostic, {
          turnStartedAt,
          queryCount: executions.length,
          analyticsExecutionDurationMs,
          success: true,
          failureStatus: null,
          executionMode,
        });
        return { status: 'ok', response, sessionContext };
      } catch (error) {
        const response = withSession({ sessionId: session.sessionId, turnId }, answerGenerationFailed(error));
        await deps.store.save(appendTurn(session, response, question, [], [], deps.clock.now(), deps.limits), deps.clock.now());
        emitTurnLatency(deps.onStageLatencyDiagnostic, {
          turnStartedAt,
          queryCount: executions.length,
          analyticsExecutionDurationMs,
          success: false,
          failureStatus: diagnosticFailureStatus(error) ?? response.status,
          executionMode,
        });
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
  readonly onStageLatencyDiagnostic?: (diagnostic: CopilotStageLatencyDiagnostic) => void;
  readonly turnStartedAt: number;
  readonly analyticsExecutionDurationMs: number;
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
    const repairOutput = await timeCopilotStage({
      stage: 'planner_repair',
      onDiagnostic: args.onStageLatencyDiagnostic,
      turnStartedAt: args.turnStartedAt,
      repairAttempted: true,
      queryCount: 0,
      analyticsExecutionDurationMs: args.analyticsExecutionDurationMs,
      queryCountFromOutput: (output) => queryCountFromRawPlan(output.plan),
      call: () =>
        args.model.repairAnalysisPlan({
          question: args.question,
          schema: args.schema,
          queryContract: args.queryContract,
          plannerPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_PROMPT_VERSION,
          maxQueries: CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
          sessionContext: args.sessionContext,
          previousPlan: args.rawPlan,
          validationErrors: first.errors,
        }),
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
  readonly onStageLatencyDiagnostic?: (diagnostic: CopilotStageLatencyDiagnostic) => void;
  readonly turnStartedAt: number;
}): Promise<ValidatedConversationDecision> {
  const actionConstraints = buildConversationDecisionActionConstraints(args.question, args.sessionContext);
  try {
    const output = await timeCopilotStage({
      stage: 'orchestrator',
      onDiagnostic: args.onStageLatencyDiagnostic,
      turnStartedAt: args.turnStartedAt,
      repairAttempted: false,
      queryCount: 0,
      analyticsExecutionDurationMs: 0,
      call: () =>
        args.model.generateConversationDecision({
          question: args.question,
          orchestratorPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_ORCHESTRATOR_PROMPT_VERSION,
          sessionContext: args.sessionContext,
          actionConstraints,
        }),
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
      const repair = await timeCopilotStage({
        stage: 'orchestrator_repair',
        onDiagnostic: args.onStageLatencyDiagnostic,
        turnStartedAt: args.turnStartedAt,
        repairAttempted: true,
        queryCount: 0,
        analyticsExecutionDurationMs: 0,
        call: () =>
          args.model.repairConversationDecision({
            question: args.question,
            orchestratorPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_ORCHESTRATOR_PROMPT_VERSION,
            sessionContext: args.sessionContext,
            actionConstraints,
            previousDecision: output.decision,
            validationErrors: first.errors,
          }),
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
  readonly onStageLatencyDiagnostic?: (diagnostic: CopilotStageLatencyDiagnostic) => void;
  readonly turnStartedAt: number;
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
    const answerOutput = await timeCopilotStage({
      stage: 'answerer',
      onDiagnostic: args.onStageLatencyDiagnostic,
      turnStartedAt: args.turnStartedAt,
      repairAttempted: false,
      queryCount: sources.length,
      analyticsExecutionDurationMs: 0,
      call: () =>
        args.model.generateAnswer({
          question: `${args.question}\n\nContext instruction: ${args.instruction}`,
          answerPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANSWER_PROMPT_VERSION,
          context: args.session.pinnedContext,
          sessionContext: args.sessionContext,
          executions: sources.map((source) => ({ id: source.queryId, plan: source.plan, result: source.result })),
        }),
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

async function processToolRuntimeTurn(args: {
  readonly session: CopilotSession;
  readonly turnId: string;
  readonly question: string;
  readonly sessionContext: ReturnType<typeof buildCopilotSessionContext>;
  readonly schema: ReturnType<typeof serializeAnalyticalSchemaForCopilot>;
  readonly queryContract: ReturnType<typeof serializeAnalyticalQueryContractForCopilot>;
  readonly model: CustomerIntelligenceCopilotModel;
  readonly executeAnalyticalQuery: ExecuteAnalyticalQueryWithResolvedContext;
  readonly store: CopilotSessionStore;
  readonly clock: Clock;
  readonly limits: CopilotSessionLimits;
  readonly onStageLatencyDiagnostic?: (diagnostic: CopilotStageLatencyDiagnostic) => void;
  readonly turnStartedAt: number;
}): Promise<ProcessCopilotSessionTurnResult> {
  const messages = toolRuntimeMessages(args);
  const tools = analyticalToolDefinitions();
  let selection: Awaited<ReturnType<NonNullable<CustomerIntelligenceCopilotModel['generateConversationalTurn']>>>;
  try {
    selection = await timeCopilotStage({
      stage: 'tool_selection',
      onDiagnostic: args.onStageLatencyDiagnostic,
      turnStartedAt: args.turnStartedAt,
      repairAttempted: false,
      queryCount: 0,
      analyticsExecutionDurationMs: 0,
      queryCountFromOutput: (output) => queryCountFromToolCalls(output.toolCalls),
      executionMode: 'direct_response',
      call: () =>
        args.model.generateConversationalTurn!({
          messages,
          tools,
          toolChoice: 'auto',
          stage: 'tool_selection',
        }),
    });
  } catch (error) {
    const response = withSession({ sessionId: args.session.sessionId, turnId: args.turnId }, mapProviderError(error) ?? answerGenerationFailed(error));
    await args.store.save(appendTurn(args.session, response, args.question, [], [], args.clock.now(), args.limits), args.clock.now());
    emitTurnLatency(args.onStageLatencyDiagnostic, { turnStartedAt: args.turnStartedAt, queryCount: 0, analyticsExecutionDurationMs: 0, success: false, failureStatus: diagnosticFailureStatus(error) ?? response.status, executionMode: 'direct_response' });
    return { status: 'ok', response, sessionContext: args.sessionContext };
  }

  if (selection.toolCalls.length === 0) {
    const response = withSession({ sessionId: args.session.sessionId, turnId: args.turnId }, directToolRuntimeResponse(selection.content ?? '', selection.metadata, args.session.pinnedContext));
    await args.store.save(appendTurn(args.session, response, args.question, [], [], args.clock.now(), args.limits), args.clock.now());
    emitTurnLatency(args.onStageLatencyDiagnostic, { turnStartedAt: args.turnStartedAt, queryCount: 0, analyticsExecutionDurationMs: 0, success: true, failureStatus: null, executionMode: 'direct_response' });
    return { status: 'ok', response, sessionContext: args.sessionContext };
  }

  const validatedToolCall = validateRunAnalyticalQueriesToolCall(selection.toolCalls);
  if (!validatedToolCall.ok) {
    const response = withSession({ sessionId: args.session.sessionId, turnId: args.turnId }, plannerInvalid(validatedToolCall.errors));
    await args.store.save(appendTurn(args.session, response, args.question, [], [], args.clock.now(), args.limits), args.clock.now());
    emitTurnLatency(args.onStageLatencyDiagnostic, { turnStartedAt: args.turnStartedAt, queryCount: 0, analyticsExecutionDurationMs: 0, success: false, failureStatus: validatedToolCall.failureStatus, executionMode: 'simple_analysis' });
    return { status: 'ok', response, sessionContext: args.sessionContext };
  }

  const executionMode = executionModeForSteps(validatedToolCall.steps);
  const analyticsStartedAt = Date.now();
  let analyticsExecutionDurationMs = 0;
  let executions: readonly { readonly id: string; readonly plan: AnalyticalQueryPlan; readonly result: AnalyticalQueryResult }[] = [];
  try {
    const executionResult = await executeAnalyticalSteps({
      steps: validatedToolCall.steps,
      executeAnalyticalQuery: args.executeAnalyticalQuery,
      context: args.session.pinnedContext,
      resolvedIds: args.session.resolvedIds,
    });
    if (executionResult.status === 'invalid_plan') {
      const response = withSession({ sessionId: args.session.sessionId, turnId: args.turnId }, plannerInvalid(executionResult.errors));
      emitStageLatency(args.onStageLatencyDiagnostic, {
        stage: 'analytics_execution',
        provider: null,
        model: null,
        durationMs: durationSince(analyticsStartedAt),
        success: false,
        failureStatus: 'tool_call_query_validation_failed',
        repairAttempted: false,
        queryCount: validatedToolCall.steps.length,
        analyticsExecutionDurationMs,
        totalTurnDurationMs: durationSince(args.turnStartedAt),
        executionMode,
      });
      await args.store.save(appendTurn(args.session, response, args.question, [], [], args.clock.now(), args.limits), args.clock.now());
      emitTurnLatency(args.onStageLatencyDiagnostic, { turnStartedAt: args.turnStartedAt, queryCount: validatedToolCall.steps.length, analyticsExecutionDurationMs, success: false, failureStatus: 'tool_call_query_validation_failed', executionMode });
      return { status: 'ok', response, sessionContext: args.sessionContext };
    }
    executions = executionResult.executions;
  } catch (error) {
    analyticsExecutionDurationMs = sumAnalyticsExecutionDurationMs(executions);
    const failureStatus = analyticsFailureStatus(error) === 'analytics_timeout' ? 'tool_execution_timeout' : 'tool_execution_unavailable';
    emitStageLatency(args.onStageLatencyDiagnostic, {
      stage: 'analytics_execution',
      provider: null,
      model: null,
      durationMs: durationSince(analyticsStartedAt),
      success: false,
      failureStatus,
      repairAttempted: false,
      queryCount: validatedToolCall.steps.length,
      analyticsExecutionDurationMs,
      totalTurnDurationMs: durationSince(args.turnStartedAt),
      executionMode,
    });
    const response = withSession({ sessionId: args.session.sessionId, turnId: args.turnId }, mapAnalyticsError(error));
    await args.store.save(appendTurn(args.session, response, args.question, [], [], args.clock.now(), args.limits), args.clock.now());
    emitTurnLatency(args.onStageLatencyDiagnostic, { turnStartedAt: args.turnStartedAt, queryCount: validatedToolCall.steps.length, analyticsExecutionDurationMs, success: false, failureStatus, executionMode });
    return { status: 'ok', response, sessionContext: args.sessionContext };
  }

  analyticsExecutionDurationMs = sumAnalyticsExecutionDurationMs(executions);
  emitStageLatency(args.onStageLatencyDiagnostic, {
    stage: 'analytics_execution',
    provider: null,
    model: null,
    durationMs: durationSince(analyticsStartedAt),
    success: true,
    failureStatus: null,
    repairAttempted: false,
    queryCount: validatedToolCall.steps.length,
    analyticsExecutionDurationMs,
    totalTurnDurationMs: durationSince(args.turnStartedAt),
    executionMode,
  });

  const queryResults = executions.map((execution) => ({
    queryId: uniqueQueryId(args.session, execution.id),
    turnId: args.turnId,
    plan: execution.plan,
    result: retainedResult(execution.result, args.limits),
  }));
  const deterministicAnswer = renderDeterministicSimpleAnswer(executions, args.session.pinnedContext);
  if (deterministicAnswer) {
    const response = withSession(
      { sessionId: args.session.sessionId, turnId: args.turnId, queryIds: queryResults.map((entry) => entry.queryId), sourceQueryIds: [] },
      answered(executions, deterministicAnswer, selection.metadata, null, args.session.pinnedContext),
    );
    const updated = appendResults(appendTurn(args.session, response, args.question, queryResults.map((entry) => entry.queryId), [], args.clock.now(), args.limits), queryResults, args.limits);
    await args.store.save(updated, args.clock.now());
    emitTurnLatency(args.onStageLatencyDiagnostic, { turnStartedAt: args.turnStartedAt, queryCount: executions.length, analyticsExecutionDurationMs, success: true, failureStatus: null, executionMode: 'simple_analysis' });
    return { status: 'ok', response, sessionContext: args.sessionContext };
  }

  try {
    const synthesis = await timeCopilotStage({
      stage: 'tool_synthesis',
      onDiagnostic: args.onStageLatencyDiagnostic,
      turnStartedAt: args.turnStartedAt,
      repairAttempted: false,
      queryCount: executions.length,
      analyticsExecutionDurationMs,
      executionMode: 'deep_analysis',
      call: () =>
        args.model.generateConversationalTurn!({
          messages: [
            ...messages,
            { role: 'assistant', content: selection.content, toolCalls: selection.toolCalls },
            { role: 'tool', toolCallId: validatedToolCall.toolCall.id, content: JSON.stringify(toolResultPayload(executions, args.session.pinnedContext)) },
          ],
          tools,
          toolChoice: 'none',
          stage: 'tool_synthesis',
        }),
    });
    if (synthesis.toolCalls.length > 0 || !synthesis.content) {
      const response = withSession({ sessionId: args.session.sessionId, turnId: args.turnId }, answerGenerationFailed(new Error('Tool synthesis returned an unexpected tool call or empty answer')));
      await args.store.save(appendTurn(args.session, response, args.question, [], [], args.clock.now(), args.limits), args.clock.now());
      emitTurnLatency(args.onStageLatencyDiagnostic, { turnStartedAt: args.turnStartedAt, queryCount: executions.length, analyticsExecutionDurationMs, success: false, failureStatus: 'tool_call_invalid_arguments', executionMode: 'deep_analysis' });
      return { status: 'ok', response, sessionContext: args.sessionContext };
    }
    const response = withSession(
      { sessionId: args.session.sessionId, turnId: args.turnId, queryIds: queryResults.map((entry) => entry.queryId), sourceQueryIds: [] },
      answered(executions, synthesis.content, selection.metadata, synthesis.metadata, args.session.pinnedContext),
    );
    const updated = appendResults(appendTurn(args.session, response, args.question, queryResults.map((entry) => entry.queryId), [], args.clock.now(), args.limits), queryResults, args.limits);
    await args.store.save(updated, args.clock.now());
    emitTurnLatency(args.onStageLatencyDiagnostic, { turnStartedAt: args.turnStartedAt, queryCount: executions.length, analyticsExecutionDurationMs, success: true, failureStatus: null, executionMode: 'deep_analysis' });
    return { status: 'ok', response, sessionContext: args.sessionContext };
  } catch (error) {
    const response = withSession({ sessionId: args.session.sessionId, turnId: args.turnId }, mapProviderError(error) ?? answerGenerationFailed(error));
    await args.store.save(appendTurn(args.session, response, args.question, [], [], args.clock.now(), args.limits), args.clock.now());
    emitTurnLatency(args.onStageLatencyDiagnostic, { turnStartedAt: args.turnStartedAt, queryCount: executions.length, analyticsExecutionDurationMs, success: false, failureStatus: diagnosticFailureStatus(error) ?? response.status, executionMode: 'deep_analysis' });
    return { status: 'ok', response, sessionContext: args.sessionContext };
  }
}

function toolRuntimeMessages(args: {
  readonly question: string;
  readonly schema: ReturnType<typeof serializeAnalyticalSchemaForCopilot>;
  readonly queryContract: ReturnType<typeof serializeAnalyticalQueryContractForCopilot>;
  readonly sessionContext: ReturnType<typeof buildCopilotSessionContext>;
}): readonly CopilotConversationalMessage[] {
  return [
    { role: 'system', content: CUSTOMER_INTELLIGENCE_COPILOT_TOOL_RUNTIME_INSTRUCTIONS.join('\n') },
    {
      role: 'user',
      content: JSON.stringify({
        toolRuntimePromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_TOOL_RUNTIME_PROMPT_VERSION,
        schema: args.schema,
        queryContract: args.queryContract,
        pinnedSnapshotContext: args.sessionContext.pinnedContext,
        conversationSummary: args.sessionContext.conversationSummary ?? null,
        semanticFocus: args.sessionContext.semanticFocus,
        unresolvedClarification: args.sessionContext.semanticFocus.unresolvedClarification,
        analyticalReferences: args.sessionContext.analyticalReferences,
        recentFindings: recentFindingsFromContext(args.sessionContext),
        recentResults: args.sessionContext.recentResults,
        recentTurns: args.sessionContext.recentTurns,
        currentQuestion: args.question,
      }),
    },
  ];
}

function analyticalToolDefinitions(): readonly CopilotToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: CUSTOMER_INTELLIGENCE_COPILOT_RUN_ANALYTICAL_QUERIES_TOOL,
        description: 'Run 1 to 3 validated Customer Intelligence AnalyticalQueryPlan objects against the pinned snapshot context.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['queries'],
          properties: {
            queries: {
              type: 'array',
              minItems: 1,
              maxItems: CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'plan'],
                properties: {
                  id: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
                  plan: {
                    type: 'object',
                    description: 'A customer-intelligence-query-plan-v1 AnalyticalQueryPlan. SQL, table names, expressions, and arbitrary code are forbidden.',
                  },
                },
              },
            },
          },
        },
      },
    },
  ];
}

function recentFindingsFromContext(sessionContext: ReturnType<typeof buildCopilotSessionContext>): readonly NonNullable<ReturnType<typeof buildCopilotSessionContext>['semanticFocus']['activeFinding']>[] {
  return sessionContext.semanticFocus.activeFinding ? [sessionContext.semanticFocus.activeFinding] : [];
}

function directToolRuntimeResponse(
  content: string,
  metadata: CopilotModelMetadata | null,
  provenance: CustomerIntelligenceSnapshotContext,
): CustomerIntelligenceCopilotResponse {
  const message = content.trim();
  if (isUnsupportedContent(message)) return terminal('unsupported_data', message);
  if (isClarificationContent(message)) return terminal('clarification_required', message);
  return {
    status: 'responded_directly',
    answer: message,
    analysis: {
      contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
      decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
      decisionAction: 'respond_directly',
      orchestratorModel: modelName(metadata),
    },
    provenance,
  };
}

function isClarificationContent(content: string): boolean {
  return /\?/.test(content) || /^(necesito|podrias|puedes|aclara|aclarar|define|indica|dime)\b/i.test(normalizeText(content)) || /\bcriterio concreto\b/i.test(normalizeText(content));
}

function isUnsupportedContent(content: string): boolean {
  return /(no puedo|no hay|no existe|no cuento|no esta soportad|no esta disponible|fuera del runtime|rentabilidad|margen|costo|profit)/i.test(normalizeText(content));
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function validateRunAnalyticalQueriesToolCall(toolCalls: readonly CopilotToolCall[]):
  | { readonly ok: true; readonly toolCall: CopilotToolCall; readonly steps: readonly ValidatedStep[] }
  | { readonly ok: false; readonly failureStatus: 'tool_call_invalid_arguments' | 'tool_call_unknown_tool' | 'tool_call_query_validation_failed'; readonly errors: readonly string[] } {
  if (toolCalls.length !== 1) {
    return { ok: false, failureStatus: 'tool_call_invalid_arguments', errors: [`expected exactly one analytical tool call, got ${toolCalls.length}`] };
  }
  const [toolCall] = toolCalls;
  if (!toolCall) return { ok: false, failureStatus: 'tool_call_invalid_arguments', errors: ['missing analytical tool call'] };
  if (toolCall.name !== CUSTOMER_INTELLIGENCE_COPILOT_RUN_ANALYTICAL_QUERIES_TOOL) {
    return { ok: false, failureStatus: 'tool_call_unknown_tool', errors: [`unknown tool call: ${toolCall.name}`] };
  }
  if (toolCall.argumentsParseError) {
    return { ok: false, failureStatus: 'tool_call_invalid_arguments', errors: [`tool arguments must be valid JSON: ${toolCall.argumentsParseError}`] };
  }
  if (toolCall.arguments === null || typeof toolCall.arguments !== 'object' || Array.isArray(toolCall.arguments)) {
    return { ok: false, failureStatus: 'tool_call_invalid_arguments', errors: ['tool arguments must be a JSON object'] };
  }

  const errors: string[] = [];
  const rawQueries = (toolCall.arguments as { readonly queries?: unknown }).queries;
  if (!Array.isArray(rawQueries)) {
    return { ok: false, failureStatus: 'tool_call_invalid_arguments', errors: ['run_analytical_queries requires queries array'] };
  }
  if (rawQueries.length === 0) errors.push('run_analytical_queries requires at least one query');
  if (rawQueries.length > CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES) errors.push(`too many queries: ${rawQueries.length} (max ${CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES})`);

  const ids = new Set<string>();
  const steps: ValidatedStep[] = [];
  for (const [index, rawQuery] of rawQueries.entries()) {
    if (rawQuery === null || typeof rawQuery !== 'object' || Array.isArray(rawQuery)) {
      errors.push(`queries[${index}] must be a JSON object`);
      continue;
    }
    const query = rawQuery as { readonly id?: unknown; readonly plan?: unknown };
    if (typeof query.id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(query.id)) {
      errors.push(`queries[${index}].id must match ^[A-Za-z_][A-Za-z0-9_]*$`);
      continue;
    }
    if (ids.has(query.id)) {
      errors.push(`duplicate query id: ${query.id}`);
      continue;
    }
    ids.add(query.id);
    const validation = validateAnalyticalQueryPlan(query.plan);
    if (!validation.ok) errors.push(...validation.errors.map((error) => `${query.id}: ${error}`));
    else steps.push({ id: query.id, plan: validation.plan.canonical });
  }

  if (errors.length > 0) {
    const failureStatus = errors.some((error) => /unknown field|unsupported aggregation|invalid orderBy|must specify either "select"|requires a structured AnalyticalQueryPlan|alias matching/.test(error))
      ? 'tool_call_query_validation_failed'
      : 'tool_call_invalid_arguments';
    return { ok: false, failureStatus, errors };
  }
  return { ok: true, toolCall, steps };
}

function queryCountFromToolCalls(toolCalls: readonly CopilotToolCall[]): number {
  const first = toolCalls[0];
  if (!first || first.arguments === null || typeof first.arguments !== 'object' || Array.isArray(first.arguments)) return 0;
  const queries = (first.arguments as { readonly queries?: unknown }).queries;
  return Array.isArray(queries) ? queries.length : 0;
}

function toolResultPayload(
  executions: readonly { readonly id: string; readonly plan: AnalyticalQueryPlan; readonly result: AnalyticalQueryResult }[],
  provenance: CustomerIntelligenceSnapshotContext,
): Record<string, unknown> {
  return {
    tool: CUSTOMER_INTELLIGENCE_COPILOT_RUN_ANALYTICAL_QUERIES_TOOL,
    provenance,
    queries: executions.map((execution) => ({
      id: execution.id,
      plan: execution.plan,
      queryPlanHash: execution.result.queryPlanHash,
      columns: execution.result.columns,
      rows: execution.result.rows,
      rowCount: execution.result.rowCount,
      execution: execution.result.execution,
    })),
  };
}

async function decideAndPlanConversation(args: {
  readonly question: string;
  readonly schema: ReturnType<typeof serializeAnalyticalSchemaForCopilot>;
  readonly queryContract: ReturnType<typeof serializeAnalyticalQueryContractForCopilot>;
  readonly sessionContext: ReturnType<typeof buildCopilotSessionContext>;
  readonly model: CustomerIntelligenceCopilotModel;
  readonly onPlannerDiagnostic?: (diagnostic: CopilotPlannerDiagnostic) => void;
  readonly onStageLatencyDiagnostic?: (diagnostic: CopilotStageLatencyDiagnostic) => void;
  readonly turnStartedAt: number;
}): Promise<ValidatedConversationPlan> {
  const actionConstraints = buildConversationDecisionActionConstraints(args.question, args.sessionContext);
  if (!args.model.generateConversationPlan || !args.model.repairConversationPlan) {
    return { status: 'terminal', response: orchestratorInvalid(['unified planner model methods are not configured']) };
  }
  try {
    const output = await timeCopilotStage({
      stage: 'unified_planner',
      onDiagnostic: args.onStageLatencyDiagnostic,
      turnStartedAt: args.turnStartedAt,
      repairAttempted: false,
      queryCount: 0,
      analyticsExecutionDurationMs: 0,
      queryCountFromOutput: (modelOutput) => queryCountFromRawConversationPlan(modelOutput.conversationPlan),
      call: () =>
        args.model.generateConversationPlan!({
          question: args.question,
          schema: args.schema,
          queryContract: args.queryContract,
          unifiedPlannerPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_UNIFIED_PLANNER_PROMPT_VERSION,
          maxQueries: CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
          sessionContext: args.sessionContext,
          actionConstraints,
        }),
    });
    const first = validateConversationPlanAndQueries(output.conversationPlan, args.question, args.sessionContext);
    if (first.ok) {
      emitUnifiedPlannerDiagnostic(args.onPlannerDiagnostic, output.conversationPlan, first, false, false);
      return {
        status: 'decision',
        decision: first.decision,
        planning: first.planning ? { ...first.planning, plannerMetadata: output.metadata } : null,
        metadata: output.metadata,
      };
    }

    for (let attempt = 0; attempt < CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_REPAIR_ATTEMPTS; attempt += 1) {
      const repair = await timeCopilotStage({
        stage: 'unified_planner_repair',
        onDiagnostic: args.onStageLatencyDiagnostic,
        turnStartedAt: args.turnStartedAt,
        repairAttempted: true,
        queryCount: 0,
        analyticsExecutionDurationMs: 0,
        queryCountFromOutput: (modelOutput) => queryCountFromRawConversationPlan(modelOutput.conversationPlan),
        call: () =>
          args.model.repairConversationPlan!({
            question: args.question,
            schema: args.schema,
            queryContract: args.queryContract,
            unifiedPlannerPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_UNIFIED_PLANNER_PROMPT_VERSION,
            maxQueries: CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
            sessionContext: args.sessionContext,
            actionConstraints,
            previousConversationPlan: output.conversationPlan,
            validationErrors: first.errors,
          }),
      });
      const repaired = validateConversationPlanAndQueries(repair.conversationPlan, args.question, args.sessionContext);
      if (repaired.ok) {
        emitUnifiedPlannerDiagnostic(args.onPlannerDiagnostic, output.conversationPlan, repaired, true, true, first.errors);
        return {
          status: 'decision',
          decision: repaired.decision,
          planning: repaired.planning ? { ...repaired.planning, plannerMetadata: repair.metadata } : null,
          metadata: repair.metadata,
        };
      }
      const validationErrors = [...first.errors, ...repaired.errors];
      emitPlannerDiagnostic(args.onPlannerDiagnostic, {
        initialPlan: output.conversationPlan,
        selectedPlan: null,
        validationErrors,
        repairAttempted: true,
        repairSucceeded: false,
        queryStepIds: [],
      });
      return { status: 'terminal', response: orchestratorInvalid(validationErrors) };
    }

    emitPlannerDiagnostic(args.onPlannerDiagnostic, {
      initialPlan: output.conversationPlan,
      selectedPlan: null,
      validationErrors: first.errors,
      repairAttempted: false,
      repairSucceeded: false,
      queryStepIds: [],
    });
    return { status: 'terminal', response: orchestratorInvalid(first.errors) };
  } catch (error) {
    return { status: 'terminal', response: mapProviderError(error) ?? answerGenerationFailed(error) };
  }
}

function validateConversationPlanAndQueries(
  rawPlan: unknown,
  question: string,
  sessionContext: ReturnType<typeof buildCopilotSessionContext>,
):
  | { readonly ok: true; readonly plan: CopilotConversationPlan; readonly decision: CopilotConversationDecision; readonly planning: ValidatedConversationPlanStatus | null }
  | { readonly ok: false; readonly errors: readonly string[] } {
  const envelope = validateCopilotConversationPlan(rawPlan, { question, sessionContext });
  if (!envelope.ok) return envelope;
  if (envelope.plan.action !== 'run_analytics') return { ok: true, plan: envelope.plan, decision: envelope.decision, planning: null };
  const planning = validatePlanEnvelopeAndQueries(envelope.plan.analysisPlan);
  if (!planning.ok) return { ok: false, errors: planning.errors };
  if (planning.plan.status !== 'query_plan') return { ok: false, errors: ['run_analytics analysisPlan must have status query_plan'] };
  return {
    ok: true,
    plan: envelope.plan,
    decision: envelope.decision,
    planning: { status: 'query_plan', steps: planning.steps, plannerMetadata: null },
  };
}

type ValidatedConversationPlanStatus = { readonly status: 'query_plan'; readonly steps: readonly ValidatedStep[]; readonly plannerMetadata: CopilotModelMetadata | null };

function emitUnifiedPlannerDiagnostic(
  onDiagnostic: ((diagnostic: CopilotPlannerDiagnostic) => void) | undefined,
  initialPlan: unknown,
  validation: { readonly plan: CopilotConversationPlan; readonly planning: ValidatedConversationPlanStatus | null },
  repairAttempted: boolean,
  repairSucceeded: boolean,
  validationErrors: readonly string[] = [],
): void {
  if (validation.plan.action !== 'run_analytics') return;
  emitPlannerDiagnostic(onDiagnostic, {
    initialPlan,
    selectedPlan: validation.plan.analysisPlan,
    validationErrors,
    repairAttempted,
    repairSucceeded,
    queryStepIds: validation.planning?.steps.map((step) => step.id) ?? [],
  });
}

async function executePlannedAnalyticsTurn(args: {
  readonly session: CopilotSession;
  readonly turnId: string;
  readonly question: string;
  readonly planning: ValidatedConversationPlanStatus;
  readonly sessionContext: ReturnType<typeof buildCopilotSessionContext>;
  readonly executeAnalyticalQuery: ExecuteAnalyticalQueryWithResolvedContext;
  readonly model: CustomerIntelligenceCopilotModel;
  readonly store: CopilotSessionStore;
  readonly clock: Clock;
  readonly limits: CopilotSessionLimits;
  readonly onStageLatencyDiagnostic?: (diagnostic: CopilotStageLatencyDiagnostic) => void;
  readonly turnStartedAt: number;
}): Promise<ProcessCopilotSessionTurnResult> {
  let analyticsExecutionDurationMs = 0;
  const executionMode = executionModeForSteps(args.planning.steps);
  let executions: readonly { readonly id: string; readonly plan: AnalyticalQueryPlan; readonly result: AnalyticalQueryResult }[] = [];
  const analyticsStartedAt = Date.now();
  try {
    const executionResult = await executeAnalyticalSteps({
      steps: args.planning.steps,
      executeAnalyticalQuery: args.executeAnalyticalQuery,
      context: args.session.pinnedContext,
      resolvedIds: args.session.resolvedIds,
    });
    if (executionResult.status === 'invalid_plan') {
      emitStageLatency(args.onStageLatencyDiagnostic, {
        stage: 'analytics_execution',
        provider: null,
        model: null,
        durationMs: durationSince(analyticsStartedAt),
        success: false,
        failureStatus: 'planner_invalid',
        repairAttempted: false,
        queryCount: args.planning.steps.length,
        analyticsExecutionDurationMs,
        totalTurnDurationMs: durationSince(args.turnStartedAt),
        executionMode,
      });
      const response = withSession({ sessionId: args.session.sessionId, turnId: args.turnId }, plannerInvalid(executionResult.errors));
      await args.store.save(appendTurn(args.session, response, args.question, [], [], args.clock.now(), args.limits), args.clock.now());
      emitTurnLatency(args.onStageLatencyDiagnostic, { turnStartedAt: args.turnStartedAt, queryCount: args.planning.steps.length, analyticsExecutionDurationMs, success: false, failureStatus: response.status, executionMode });
      return { status: 'ok', response, sessionContext: args.sessionContext };
    }
    executions = executionResult.executions;
  } catch (error) {
    analyticsExecutionDurationMs = sumAnalyticsExecutionDurationMs(executions);
    emitStageLatency(args.onStageLatencyDiagnostic, {
      stage: 'analytics_execution',
      provider: null,
      model: null,
      durationMs: durationSince(analyticsStartedAt),
      success: false,
      failureStatus: analyticsFailureStatus(error),
      repairAttempted: false,
      queryCount: args.planning.steps.length,
      analyticsExecutionDurationMs,
      totalTurnDurationMs: durationSince(args.turnStartedAt),
      executionMode,
    });
    const response = withSession({ sessionId: args.session.sessionId, turnId: args.turnId }, mapAnalyticsError(error));
    await args.store.save(appendTurn(args.session, response, args.question, [], [], args.clock.now(), args.limits), args.clock.now());
    emitTurnLatency(args.onStageLatencyDiagnostic, { turnStartedAt: args.turnStartedAt, queryCount: args.planning.steps.length, analyticsExecutionDurationMs, success: false, failureStatus: response.status, executionMode });
    return { status: 'ok', response, sessionContext: args.sessionContext };
  }
  analyticsExecutionDurationMs = sumAnalyticsExecutionDurationMs(executions);
  emitStageLatency(args.onStageLatencyDiagnostic, {
    stage: 'analytics_execution',
    provider: null,
    model: null,
    durationMs: durationSince(analyticsStartedAt),
    success: true,
    failureStatus: null,
    repairAttempted: false,
    queryCount: args.planning.steps.length,
    analyticsExecutionDurationMs,
    totalTurnDurationMs: durationSince(args.turnStartedAt),
    executionMode,
  });

  const queryResults = executions.map((execution) => ({
    queryId: uniqueQueryId(args.session, execution.id),
    turnId: args.turnId,
    plan: execution.plan,
    result: retainedResult(execution.result, args.limits),
  }));
  const deterministicAnswer = renderDeterministicSimpleAnswer(executions, args.session.pinnedContext);
  if (deterministicAnswer) {
    const response = withSession(
      { sessionId: args.session.sessionId, turnId: args.turnId, queryIds: queryResults.map((entry) => entry.queryId), sourceQueryIds: [] },
      answered(executions, deterministicAnswer, args.planning.plannerMetadata, null, args.session.pinnedContext),
    );
    const updated = appendResults(appendTurn(args.session, response, args.question, queryResults.map((entry) => entry.queryId), [], args.clock.now(), args.limits), queryResults, args.limits);
    await args.store.save(updated, args.clock.now());
    emitTurnLatency(args.onStageLatencyDiagnostic, { turnStartedAt: args.turnStartedAt, queryCount: executions.length, analyticsExecutionDurationMs, success: true, failureStatus: null, executionMode: 'fast_path' });
    return { status: 'ok', response, sessionContext: args.sessionContext };
  }

  try {
    const answerOutput = await timeCopilotStage({
      stage: 'answerer',
      onDiagnostic: args.onStageLatencyDiagnostic,
      turnStartedAt: args.turnStartedAt,
      repairAttempted: false,
      queryCount: executions.length,
      analyticsExecutionDurationMs,
      executionMode,
      call: () =>
        args.model.generateAnswer({
          question: args.question,
          answerPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANSWER_PROMPT_VERSION,
          context: args.session.pinnedContext,
          sessionContext: args.sessionContext,
          executions,
        }),
    });
    const response = withSession(
      { sessionId: args.session.sessionId, turnId: args.turnId, queryIds: queryResults.map((entry) => entry.queryId), sourceQueryIds: [] },
      answered(executions, answerOutput.answer, args.planning.plannerMetadata, answerOutput.metadata, args.session.pinnedContext),
    );
    const updated = appendResults(appendTurn(args.session, response, args.question, queryResults.map((entry) => entry.queryId), [], args.clock.now(), args.limits), queryResults, args.limits);
    await args.store.save(updated, args.clock.now());
    emitTurnLatency(args.onStageLatencyDiagnostic, { turnStartedAt: args.turnStartedAt, queryCount: executions.length, analyticsExecutionDurationMs, success: true, failureStatus: null, executionMode });
    return { status: 'ok', response, sessionContext: args.sessionContext };
  } catch (error) {
    const response = withSession({ sessionId: args.session.sessionId, turnId: args.turnId }, answerGenerationFailed(error));
    await args.store.save(appendTurn(args.session, response, args.question, [], [], args.clock.now(), args.limits), args.clock.now());
    emitTurnLatency(args.onStageLatencyDiagnostic, { turnStartedAt: args.turnStartedAt, queryCount: executions.length, analyticsExecutionDurationMs, success: false, failureStatus: diagnosticFailureStatus(error) ?? response.status, executionMode });
    return { status: 'ok', response, sessionContext: args.sessionContext };
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

async function executeAnalyticalSteps(args: {
  readonly steps: readonly ValidatedStep[];
  readonly executeAnalyticalQuery: ExecuteAnalyticalQueryWithResolvedContext;
  readonly context: CustomerIntelligenceSnapshotContext;
  readonly resolvedIds: CopilotSession['resolvedIds'];
}): Promise<
  | { readonly status: 'ok'; readonly executions: readonly { readonly id: string; readonly plan: AnalyticalQueryPlan; readonly result: AnalyticalQueryResult }[] }
  | { readonly status: 'invalid_plan'; readonly errors: readonly string[] }
> {
  const attempts = await mapConcurrent(args.steps, CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES, async (step) => ({
    step,
    execution: await args.executeAnalyticalQuery({
      plan: step.plan,
      context: args.context,
      resolvedIds: args.resolvedIds,
    }),
  }));
  const invalid = attempts.find((attempt) => attempt.execution.status === 'invalid_plan');
  if (invalid && invalid.execution.status === 'invalid_plan') return { status: 'invalid_plan', errors: invalid.execution.errors };
  return {
    status: 'ok',
    executions: attempts.map((attempt) => {
      if (attempt.execution.status === 'invalid_plan') throw new Error('unexpected invalid analytical execution');
      return { id: attempt.step.id, plan: attempt.step.plan, result: attempt.execution.result };
    }),
  };
}

async function mapConcurrent<T, R>(items: readonly T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index]!, index);
      }
    }),
  );
  return results;
}

function executionModeForSteps(steps: readonly ValidatedStep[]): CopilotExecutionMode {
  return steps.length === 1 && canRenderDeterministicSimpleAnswer(steps[0]?.plan) ? 'simple_analysis' : 'deep_analysis';
}

function canRenderDeterministicSimpleAnswer(plan: AnalyticalQueryPlan | undefined): boolean {
  if (!plan || plan.select || !plan.metrics || plan.metrics.length !== 1) return false;
  const metric = plan.metrics[0];
  if (!metric) return false;
  const dimensionCount = plan.dimensions?.length ?? 0;
  if (dimensionCount === 0) return metric.aggregation === 'count';
  if (dimensionCount !== 1) return false;
  if (metric.aggregation === 'count') return true;
  const order = plan.orderBy?.[0];
  return plan.limit === 1 && order?.field === metric.alias && order.direction === 'desc';
}

function renderDeterministicSimpleAnswer(
  executions: readonly { readonly plan: AnalyticalQueryPlan; readonly result: AnalyticalQueryResult }[],
  provenance: CustomerIntelligenceSnapshotContext,
): string | null {
  if (executions.length !== 1) return null;
  const execution = executions[0];
  if (!execution || execution.result.execution.truncated || !canRenderDeterministicSimpleAnswer(execution.plan)) return null;
  const metric = execution.plan.metrics?.[0];
  if (!metric) return null;
  if ((execution.plan.dimensions?.length ?? 0) === 0 && metric.aggregation === 'count') {
    const value = scalarValue(execution.result.rows[0], metric.alias);
    if (typeof value !== 'number') return null;
    return `Hay ${formatNumber(value)} clientes en la poblacion actual de Customer Intelligence. La referencia es el snapshot ${provenance.featureSnapshot.snapshotId}.`;
  }
  const dimension = execution.plan.dimensions?.[0];
  if (!dimension || execution.result.rows.length === 0) return null;
  const row = execution.result.rows[0];
  const dimensionValue = scalarValue(row, resultColumnName(dimension));
  const metricValue = scalarValue(row, metric.alias);
  if (dimensionValue === null || metricValue === null || typeof metricValue === 'boolean') return null;
  const entity = entityLabel(dimension, dimensionValue);
  const metricLabel = metricDisplayName(metric);
  const value = typeof metricValue === 'number' ? formatNumber(metricValue) : String(metricValue);
  if (metric.aggregation === 'count') {
    return `${entity} concentra el mayor conteo observado: ${value} clientes. La referencia es el snapshot ${provenance.featureSnapshot.snapshotId}.`;
  }
  return `${entity} lidera en ${metricLabel}: ${value}. La referencia es el snapshot ${provenance.featureSnapshot.snapshotId}.`;
}

function scalarValue(row: AnalyticalQueryResult['rows'][number] | undefined, key: string): string | number | boolean | null {
  return row?.[key] ?? null;
}

function resultColumnName(logicalName: string): string {
  const parts = logicalName.split('.');
  return parts[parts.length - 1] ?? logicalName;
}

function entityLabel(dimension: string, value: string | number | boolean): string {
  if (dimension === 'cluster.clusterId') return `El cluster ${String(value)}`;
  if (dimension === 'cluster.label') return `El cluster ${String(value)}`;
  if (dimension === 'rfm.segmentCode') return `El segmento RFM ${String(value)}`;
  return `${resultColumnName(dimension)} ${String(value)}`;
}

function metricDisplayName(metric: NonNullable<AnalyticalQueryPlan['metrics']>[number]): string {
  if (metric.aggregation === 'avg' && metric.field === 'commercial.averageOrderValueTaxIncl') return 'ticket promedio';
  if (metric.aggregation === 'sum' && metric.field === 'commercial.totalSpentTaxIncl') return 'gasto total';
  if (metric.aggregation === 'count') return 'conteo de clientes';
  return metric.alias;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(value);
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

async function timeCopilotStage<T extends { readonly metadata: CopilotModelMetadata | null }>(args: {
  readonly stage: Exclude<CopilotLatencyStage, 'analytics_execution' | 'turn'>;
  readonly onDiagnostic?: (diagnostic: CopilotStageLatencyDiagnostic) => void;
  readonly turnStartedAt: number;
  readonly repairAttempted: boolean;
  readonly queryCount: number;
  readonly analyticsExecutionDurationMs: number;
  readonly queryCountFromOutput?: (output: T) => number;
  readonly executionMode?: CopilotExecutionMode;
  readonly call: () => Promise<T>;
}): Promise<T> {
  const startedAt = Date.now();
  try {
    const output = await args.call();
    emitStageLatency(args.onDiagnostic, {
      stage: args.stage,
      provider: output.metadata?.provider ?? null,
      model: output.metadata?.model ?? null,
      durationMs: durationSince(startedAt),
      success: true,
      failureStatus: null,
      repairAttempted: args.repairAttempted,
      queryCount: args.queryCountFromOutput?.(output) ?? args.queryCount,
      analyticsExecutionDurationMs: args.analyticsExecutionDurationMs,
      totalTurnDurationMs: durationSince(args.turnStartedAt),
      executionMode: args.executionMode ?? null,
      ...metadataSize(output.metadata),
    });
    return output;
  } catch (error) {
    const metadata = providerErrorMetadata(error);
    emitStageLatency(args.onDiagnostic, {
      stage: args.stage,
      provider: metadata.provider,
      model: metadata.model,
      durationMs: durationSince(startedAt),
      success: false,
      failureStatus: diagnosticFailureStatus(error),
      repairAttempted: args.repairAttempted,
      queryCount: args.queryCount,
      analyticsExecutionDurationMs: args.analyticsExecutionDurationMs,
      totalTurnDurationMs: durationSince(args.turnStartedAt),
      executionMode: args.executionMode ?? null,
    });
    throw error;
  }
}

function emitTurnLatency(
  onDiagnostic: ((diagnostic: CopilotStageLatencyDiagnostic) => void) | undefined,
  args: {
    readonly turnStartedAt: number;
    readonly queryCount: number;
    readonly analyticsExecutionDurationMs: number;
    readonly success: boolean;
    readonly failureStatus: string | null;
    readonly executionMode?: CopilotExecutionMode;
  },
): void {
  emitStageLatency(onDiagnostic, {
    stage: 'turn',
    provider: null,
    model: null,
    durationMs: durationSince(args.turnStartedAt),
    success: args.success,
    failureStatus: args.failureStatus,
    repairAttempted: false,
    queryCount: args.queryCount,
    analyticsExecutionDurationMs: args.analyticsExecutionDurationMs,
    totalTurnDurationMs: durationSince(args.turnStartedAt),
    executionMode: args.executionMode ?? null,
  });
}

function emitStageLatency(
  onDiagnostic: ((diagnostic: CopilotStageLatencyDiagnostic) => void) | undefined,
  diagnostic: Omit<CopilotStageLatencyDiagnostic, 'event'>,
): void {
  onDiagnostic?.({
    event: 'customer_intelligence_copilot_stage_latency',
    ...diagnostic,
    durationMs: Math.max(0, Math.round(diagnostic.durationMs)),
    totalTurnDurationMs: Math.max(0, Math.round(diagnostic.totalTurnDurationMs)),
    analyticsExecutionDurationMs: Math.max(0, Math.round(diagnostic.analyticsExecutionDurationMs)),
  });
}

function durationSince(startedAt: number): number {
  return Date.now() - startedAt;
}

function sumAnalyticsExecutionDurationMs(executions: readonly { readonly result: AnalyticalQueryResult }[]): number {
  return executions.reduce((sum, execution) => sum + execution.result.execution.durationMs, 0);
}

function queryCountFromRawPlan(rawPlan: unknown): number {
  if (rawPlan === null || typeof rawPlan !== 'object' || Array.isArray(rawPlan)) return 0;
  const obj = rawPlan as { readonly status?: unknown; readonly queries?: unknown };
  return obj.status === 'query_plan' && Array.isArray(obj.queries) ? obj.queries.length : 0;
}

function queryCountFromRawConversationPlan(rawPlan: unknown): number {
  if (rawPlan === null || typeof rawPlan !== 'object' || Array.isArray(rawPlan)) return 0;
  const analysisPlan = (rawPlan as { readonly analysisPlan?: unknown }).analysisPlan;
  return queryCountFromRawPlan(analysisPlan);
}

function retainedResult(result: AnalyticalQueryResult, limits: CopilotSessionLimits): AnalyticalQueryResult {
  return {
    ...result,
    rows: result.rows.slice(0, limits.maxResultRowsRetained),
    rowCount: Math.min(result.rowCount, limits.maxResultRowsRetained),
    execution: { ...result.execution, truncated: result.execution.truncated || result.rows.length > limits.maxResultRowsRetained },
  };
}

function metadataSize(metadata: CopilotModelMetadata | null): Partial<Pick<
  CopilotStageLatencyDiagnostic,
  'promptCharCount' | 'responseCharCount' | 'promptTokens' | 'completionTokens' | 'totalTokens'
  | 'promptCacheHitTokens' | 'promptCacheMissTokens'
>> {
  if (!metadata) return {};
  return {
    ...optionalNumber('promptCharCount', metadata.promptCharCount),
    ...optionalNumber('responseCharCount', metadata.responseCharCount),
    ...optionalNumber('promptTokens', metadata.promptTokens),
    ...optionalNumber('completionTokens', metadata.completionTokens),
    ...optionalNumber('totalTokens', metadata.totalTokens),
    ...optionalNumber('promptCacheHitTokens', metadata.promptCacheHitTokens),
    ...optionalNumber('promptCacheMissTokens', metadata.promptCacheMissTokens),
  };
}

function optionalNumber<Key extends 'promptCharCount' | 'responseCharCount' | 'promptTokens' | 'completionTokens' | 'totalTokens' | 'promptCacheHitTokens' | 'promptCacheMissTokens'>(
  key: Key,
  value: number | undefined,
): Record<Key, number> | Record<string, never> {
  return typeof value === 'number' && Number.isFinite(value) ? { [key]: value } as Record<Key, number> : {};
}

function diagnosticFailureStatus(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const category = (error as { readonly category?: unknown }).category;
  if (typeof category !== 'string') return null;
  if (category.startsWith('provider_')) {
    const stage = providerErrorStage(error);
    if (stage) return `${providerFailureStageName(stage)}_${category}`;
  }
  return category;
}

function providerErrorStage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const metadata = (error as { readonly metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const stage = (metadata as { readonly stage?: unknown }).stage;
  return typeof stage === 'string' ? stage : null;
}

function providerFailureStageName(stage: string): string {
  if (stage === 'tool_selection') return 'tool_selection';
  if (stage === 'tool_synthesis') return 'tool_synthesis';
  if (stage.startsWith('unified_planner')) return 'unified_planner';
  if (stage.startsWith('orchestrator')) return 'orchestrator';
  if (stage.startsWith('planner')) return 'planner';
  if (stage === 'answerer') return 'answerer';
  return stage;
}

function providerErrorMetadata(error: unknown): { readonly provider: string | null; readonly model: string | null } {
  if (!error || typeof error !== 'object') return { provider: null, model: null };
  const metadata = (error as { readonly metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return { provider: null, model: null };
  const provider = (metadata as { readonly provider?: unknown }).provider;
  const model = (metadata as { readonly model?: unknown }).model;
  return {
    provider: typeof provider === 'string' ? provider : null,
    model: typeof model === 'string' ? model : null,
  };
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

function analyticsFailureStatus(error: unknown): string {
  if (error instanceof AnalyticsTimeoutError) return 'analytics_timeout';
  if (error instanceof AnalyticsUnavailableError || error instanceof AnalyticsSchemaIncompatibleError) return 'analytics_unavailable';
  return 'analytics_failed';
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
