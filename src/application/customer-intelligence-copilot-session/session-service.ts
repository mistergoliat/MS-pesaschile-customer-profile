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
  CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SYNTHESIS_INSTRUCTIONS,
  CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SYNTHESIS_PROMPT_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_RUN_ANALYTICAL_QUERIES_TOOL,
  CUSTOMER_INTELLIGENCE_COPILOT_SESSION_VERSION,
  asksForAnalyticalRecommendation,
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
  resolveBusinessMetric,
  resolveBusinessMetricByName,
  resolveSemanticMetricName,
  businessEntityLabel,
  formatBusinessValue,
  formatRatio,
  requiresCustomerIntelligenceAnalytics,
  type AnalyticalEvidenceBundle,
  type CopilotPopulationContext,
  type CopilotSemanticAnchor,
  type CustomerIntelligenceCopilotResponse,
} from '../../domain/customer-intelligence-copilot/index.js';
import {
  expandCompactAnalyticalQuery,
  isCompactAnalyticalQueryShape,
  validateAnalyticalQueryPlan,
  type AnalyticalFilterNode,
  type AnalyticalQueryPlan,
  type AnalyticalQueryResult,
} from '../../domain/customer-intelligence-query/index.js';
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
  deriveSemanticFocus,
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
  readonly compactToolContract: boolean;
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
  readonly finalResponseState: 'failure';
  readonly message: string;
  readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION;
};

type AnalyticsFailureResponse =
  | AnalyticsUnavailableResponse
  | {
      readonly status: 'analytics_timeout';
      readonly finalResponseState: 'failure';
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
// task MARKETING-R1-T05.8.6 Section 1/2: live evidence showed synthesis repeatedly saturating the
// old 500-token ceiling and the evidence bundle repeatedly saturating 12 facts while still far
// below the old 4000-char cap - both artificial ceilings, not genuine reasoning limits.
const DEFAULT_SYNTHESIS_MAX_TOKENS = 1500;
const ANALYTICAL_EVIDENCE_BUNDLE_MAX_CHARS = 8000;
const ANALYTICAL_EVIDENCE_MAX_FACTS = 32;
const ANALYTICAL_EVIDENCE_MAX_COMPARISONS = 8;
const ANALYTICAL_EVIDENCE_MAX_DISTRIBUTION_ROWS = 32;
type DeterministicRendererReason =
  | 'eligible'
  | 'eligible_top_k_truncation'
  | 'multiple_queries'
  | 'multiple_metrics'
  | 'unsupported_dimension'
  | 'missing_order'
  | 'order_metric_mismatch'
  | 'limit_not_supported'
  | 'tie_detected'
  | 'truncated_result'
  | 'unexpected_result_shape'
  | 'explanatory_question_requires_synthesis';

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
  readonly contextProjectionChars?: number;
  readonly resultSummaryChars?: number;
  readonly compactToolContract?: boolean;
  readonly toolSchemaChars?: number;
  readonly toolSelectionPromptChars?: number;
  readonly toolSelectionPromptTokens?: number;
  readonly toolArgumentChars?: number;
  readonly toolArgumentTokens?: number;
  readonly deterministicRendererEligible?: boolean;
  readonly deterministicRendererReason?: DeterministicRendererReason;
  readonly semanticAnchorEntityType?: string | null;
  readonly semanticAnchorEntityId?: string | number | null;
  readonly semanticAnchorMetric?: string | null;
  readonly semanticAnchorFindingType?: string | null;
  readonly evidenceBundleChars?: number;
  readonly evidenceFactCount?: number;
  readonly evidenceComparisonCount?: number;
  readonly evidenceDistributionCount?: number;
  readonly evidenceMaxFacts?: number;
  readonly evidenceMaxChars?: number;
  readonly synthesisMaxTokens?: number;
  readonly synthesisPromptChars?: number;
  readonly synthesisPromptTokens?: number;
  readonly synthesisCompletionTokens?: number;
  readonly synthesisFallbackUsed?: boolean;
  readonly providerFinishReason?: string | null;
  readonly synthesisFinishReason?: string | null;
  readonly activeSemanticEntityType?: string | null;
  readonly activeSemanticEntityId?: string | number | null;
  readonly activeMetric?: string | null;
  readonly activeFindingType?: string | null;
  readonly activeFindingSourceQueryId?: string | null;
  readonly unresolvedClarificationPresent?: boolean;
  readonly toolCallCount?: number;
  readonly toolQueryIds?: readonly string[];
  readonly toolQueryCount?: number;
  readonly toolQueries?: readonly {
    readonly id: string;
    readonly dimensions: readonly string[];
    readonly metrics: readonly string[];
    readonly filterFieldNames: readonly string[];
    readonly hasEntityFilter: boolean;
    readonly limit: number | null;
    readonly orderByFields: readonly string[];
  }[];
  readonly synthesisInputResultCount?: number;
  readonly semanticFailureReason?: string | null;
  readonly primaryFindingEntityType?: string | null;
  readonly primaryFindingEntityId?: string | number | null;
  readonly primaryFindingMetric?: string | null;
  readonly primaryFindingType?: string | null;
  readonly primaryFindingSourceQueryId?: string | null;
  readonly distributionRowCount?: number;
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
  readonly synthesisMaxTokens?: number;
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
          synthesisMaxTokens: deps.synthesisMaxTokens,
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
              finalResponseState: 'success',
              answer: unified.decision.message,
              analysis: {
                contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
                decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
                decisionAction: 'respond_directly',
                orchestratorModel: modelName(unified.metadata),
                finalResponseState: 'success',
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
            finalResponseState: 'success',
            answer: decisionResult.decision.message,
            analysis: {
              contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
              decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
              decisionAction: 'respond_directly',
              orchestratorModel: modelName(decisionResult.metadata),
              finalResponseState: 'success',
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
      const deterministicAnswer = shouldUseDeterministicAnswer(executions) ? renderDeterministicSimpleAnswer(executions, session.pinnedContext) : null;
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
  const freshBusinessFactQuestion = requiresCustomerIntelligenceAnalytics(question);
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
  const populationContexts = derivePopulationContexts(sources.map((source) => ({ id: source.queryId, plan: source.plan, result: source.result })));
  const populationDiagnostics = buildPopulationDiagnostics(populationContexts);
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
        finalResponseState: 'success',
        answer: answerOutput.answer,
        analysis: {
          contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
          analysisPlanVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
          finalResponseState: 'success',
          sourceQueryIds: args.sourceQueryIds,
          resultRowCount: sources.reduce((sum, source) => sum + source.result.rowCount, 0),
          plannerModel: modelName(args.plannerMetadata),
          answerModel: modelName(answerOutput.metadata),
          ...populationDiagnostics,
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
  readonly synthesisMaxTokens?: number;
  readonly onStageLatencyDiagnostic?: (diagnostic: CopilotStageLatencyDiagnostic) => void;
  readonly turnStartedAt: number;
}): Promise<ProcessCopilotSessionTurnResult> {
  const semanticAnchor = semanticAnchorFromSessionContext(args.sessionContext);
  const messages = toolRuntimeMessages(args);
  const tools = analyticalToolDefinitions();
  const selectionProjectionChars = messageProjectionChars(messages);
  const toolSchemaChars = JSON.stringify(tools).length;
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
      diagnosticContext: {
        ...toolRuntimeSemanticDiagnostic(args.sessionContext),
        ...semanticAnchorDiagnostic(semanticAnchor),
        contextProjectionChars: selectionProjectionChars,
        compactToolContract: true,
        toolSchemaChars,
        toolSelectionPromptChars: selectionProjectionChars + toolSchemaChars,
      },
      outputDiagnosticContext: (output) => ({
        toolArgumentChars: toolArgumentChars(output.toolCalls),
        providerFinishReason: output.metadata?.finishReason ?? null,
        ...(typeof output.metadata?.promptTokens === 'number' ? { toolSelectionPromptTokens: output.metadata.promptTokens } : {}),
      }),
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
  const toolDiagnostic = validatedToolCall.ok ? toolCallDiagnostic(validatedToolCall.steps) : {};
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
        ...toolDiagnostic,
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
      ...toolDiagnostic,
    });
    const response = withSession({ sessionId: args.session.sessionId, turnId: args.turnId }, mapAnalyticsError(error));
    await args.store.save(appendTurn(args.session, response, args.question, [], [], args.clock.now(), args.limits), args.clock.now());
    emitTurnLatency(args.onStageLatencyDiagnostic, { turnStartedAt: args.turnStartedAt, queryCount: validatedToolCall.steps.length, analyticsExecutionDurationMs, success: false, failureStatus, executionMode });
    return { status: 'ok', response, sessionContext: args.sessionContext };
  }

  analyticsExecutionDurationMs = sumAnalyticsExecutionDurationMs(executions);
  const deterministicEligibility = deterministicRendererEligibility(executions, semanticAnchor);
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
    ...toolDiagnostic,
    ...semanticAnchorDiagnostic(semanticAnchor),
    deterministicRendererEligible: deterministicEligibility.eligible,
    deterministicRendererReason: deterministicEligibility.reason,
  });

  const queryResults = executions.map((execution) => ({
    queryId: uniqueQueryId(args.session, execution.id),
    turnId: args.turnId,
    plan: execution.plan,
    result: retainedResult(execution.result, args.limits),
  }));
  const deterministicAnswer = deterministicEligibility.eligible ? renderDeterministicSimpleAnswer(executions, args.session.pinnedContext) : null;
  if (deterministicAnswer) {
    const response = withSession(
      { sessionId: args.session.sessionId, turnId: args.turnId, queryIds: queryResults.map((entry) => entry.queryId), sourceQueryIds: [] },
      answered(executions, deterministicAnswer, selection.metadata, null, args.session.pinnedContext),
    );
    const updated = appendResults(appendTurn(args.session, response, args.question, queryResults.map((entry) => entry.queryId), [], args.clock.now(), args.limits), queryResults, args.limits);
    await args.store.save(updated, args.clock.now());
    emitTurnLatency(args.onStageLatencyDiagnostic, {
      turnStartedAt: args.turnStartedAt,
      queryCount: executions.length,
      analyticsExecutionDurationMs,
      success: true,
      failureStatus: null,
      executionMode: 'simple_analysis',
      diagnosticContext: {
        ...semanticAnchorDiagnostic(semanticAnchor),
        deterministicRendererEligible: true,
        deterministicRendererReason: deterministicEligibility.reason,
        ...primaryFindingDiagnostic(updated),
      },
    });
    return { status: 'ok', response, sessionContext: args.sessionContext };
  }

  const evidenceBundle = buildAnalyticalEvidenceBundle({ semanticAnchor, executions, provenance: args.session.pinnedContext });
  const evidenceBundleChars = JSON.stringify(evidenceBundle).length;
  try {
    const synthesisMessages = toolSynthesisMessages({
      question: args.question,
      sessionContext: args.sessionContext,
      semanticAnchor,
      evidenceBundle,
    });
    const synthesisPromptChars = messageProjectionChars(synthesisMessages);
    const synthesisMaxTokens = args.synthesisMaxTokens ?? DEFAULT_SYNTHESIS_MAX_TOKENS;
    const synthesis = await timeCopilotStage({
      stage: 'tool_synthesis',
      onDiagnostic: args.onStageLatencyDiagnostic,
      turnStartedAt: args.turnStartedAt,
      repairAttempted: false,
      queryCount: executions.length,
      analyticsExecutionDurationMs,
      executionMode: 'deep_analysis',
      diagnosticContext: {
        ...toolRuntimeSemanticDiagnostic(args.sessionContext),
        ...toolDiagnostic,
        ...semanticAnchorDiagnostic(semanticAnchor),
        evidenceBundleChars,
        evidenceFactCount: evidenceBundle.facts.length,
        evidenceComparisonCount: evidenceBundle.comparisons.length,
        evidenceDistributionCount: evidenceBundle.distributions.length,
        evidenceMaxFacts: ANALYTICAL_EVIDENCE_MAX_FACTS,
        evidenceMaxChars: ANALYTICAL_EVIDENCE_BUNDLE_MAX_CHARS,
        synthesisMaxTokens,
        resultSummaryChars: evidenceBundleChars,
        synthesisPromptChars,
        synthesisInputResultCount: executions.length,
      },
      outputDiagnosticContext: (output) => ({
        ...(typeof output.metadata?.promptTokens === 'number' ? { synthesisPromptTokens: output.metadata.promptTokens } : {}),
        ...(typeof output.metadata?.completionTokens === 'number' ? { synthesisCompletionTokens: output.metadata.completionTokens } : {}),
        synthesisFinishReason: output.metadata?.finishReason ?? null,
      }),
      call: () =>
        args.model.generateConversationalTurn!({
          messages: synthesisMessages,
          tools: [],
          toolChoice: 'none',
          stage: 'tool_synthesis',
          maxTokens: synthesisMaxTokens,
        }),
    });
    if (synthesis.toolCalls.length > 0 || !synthesis.content) {
      const response = fallbackToolSynthesisResponse({
        session: args.session,
        turnId: args.turnId,
        question: args.question,
        executions,
        queryResults,
        evidenceBundle,
        selectionMetadata: selection.metadata,
        provenance: args.session.pinnedContext,
      });
      const updated = appendResults(appendTurn(args.session, response, args.question, queryResults.map((entry) => entry.queryId), [], args.clock.now(), args.limits), queryResults, args.limits);
      await args.store.save(updated, args.clock.now());
      emitTurnLatency(args.onStageLatencyDiagnostic, {
        turnStartedAt: args.turnStartedAt,
        queryCount: executions.length,
        analyticsExecutionDurationMs,
        success: true,
        failureStatus: 'answered_degraded_synthesis',
        executionMode: 'deep_analysis',
        diagnosticContext: {
          ...semanticAnchorDiagnostic(semanticAnchor),
          synthesisFallbackUsed: true,
          evidenceBundleChars,
          evidenceFactCount: evidenceBundle.facts.length,
          evidenceComparisonCount: evidenceBundle.comparisons.length,
          evidenceDistributionCount: evidenceBundle.distributions.length,
          ...primaryFindingDiagnostic(updated),
        },
      });
      return { status: 'ok', response, sessionContext: args.sessionContext };
    }
    const response = withSession(
      { sessionId: args.session.sessionId, turnId: args.turnId, queryIds: queryResults.map((entry) => entry.queryId), sourceQueryIds: [] },
      answered(executions, synthesis.content, selection.metadata, synthesis.metadata, args.session.pinnedContext),
    );
    const updated = appendResults(appendTurn(args.session, response, args.question, queryResults.map((entry) => entry.queryId), [], args.clock.now(), args.limits), queryResults, args.limits);
    await args.store.save(updated, args.clock.now());
    emitTurnLatency(args.onStageLatencyDiagnostic, {
      turnStartedAt: args.turnStartedAt,
      queryCount: executions.length,
      analyticsExecutionDurationMs,
      success: true,
      failureStatus: null,
      executionMode: 'deep_analysis',
      diagnosticContext: {
        ...semanticAnchorDiagnostic(semanticAnchor),
        synthesisFallbackUsed: false,
        evidenceBundleChars,
        evidenceFactCount: evidenceBundle.facts.length,
        evidenceComparisonCount: evidenceBundle.comparisons.length,
        evidenceDistributionCount: evidenceBundle.distributions.length,
        ...primaryFindingDiagnostic(updated),
      },
    });
    return { status: 'ok', response, sessionContext: args.sessionContext };
  } catch (error) {
    if (canUseDeterministicSynthesisFallback(error, evidenceBundle)) {
      const response = fallbackToolSynthesisResponse({
        session: args.session,
        turnId: args.turnId,
        question: args.question,
        executions,
        queryResults,
        evidenceBundle,
        selectionMetadata: selection.metadata,
        provenance: args.session.pinnedContext,
      });
      const updated = appendResults(appendTurn(args.session, response, args.question, queryResults.map((entry) => entry.queryId), [], args.clock.now(), args.limits), queryResults, args.limits);
      await args.store.save(updated, args.clock.now());
      emitTurnLatency(args.onStageLatencyDiagnostic, {
        turnStartedAt: args.turnStartedAt,
        queryCount: executions.length,
        analyticsExecutionDurationMs,
        success: true,
        failureStatus: 'answered_degraded_synthesis',
        executionMode: 'deep_analysis',
        diagnosticContext: {
          ...semanticAnchorDiagnostic(semanticAnchor),
          synthesisFallbackUsed: true,
          evidenceBundleChars,
          evidenceFactCount: evidenceBundle.facts.length,
          evidenceComparisonCount: evidenceBundle.comparisons.length,
          evidenceDistributionCount: evidenceBundle.distributions.length,
          ...primaryFindingDiagnostic(updated),
        },
      });
      return { status: 'ok', response, sessionContext: args.sessionContext };
    }
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
      role: 'system',
      content: JSON.stringify({
        toolRuntimePromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_TOOL_RUNTIME_PROMPT_VERSION,
        schema: args.schema,
        queryContract: args.queryContract,
        maxQueries: CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
      }),
    },
    {
      role: 'user',
      content: JSON.stringify({
        pinnedSnapshotContext: compactPinnedSnapshotContext(args.sessionContext.pinnedContext),
        conversationSummary: args.sessionContext.conversationSummary ?? null,
        semanticFocus: args.sessionContext.semanticFocus,
        unresolvedClarification: args.sessionContext.semanticFocus.unresolvedClarification,
        analyticalReferences: args.sessionContext.analyticalReferences.slice(0, CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES),
        recentFindings: recentFindingsFromContext(args.sessionContext),
        recentResults: compactRecentResults(args.sessionContext),
        recentTurns: args.sessionContext.recentTurns.slice(-3),
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
        description: 'Run compact Customer Intelligence queries.',
        parameters: {
          type: 'object',
          required: ['queries'],
          properties: {
            queries: {
              type: 'array',
              minItems: 1,
              maxItems: CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
              items: {
                type: 'object',
                required: ['id'],
                properties: {
                  id: { type: 'string' },
                  select: { type: 'array' },
                  dimensions: { type: 'array' },
                  metrics: { type: 'array' },
                  filters: { type: ['array', 'object'] },
                  orderBy: { type: 'array' },
                  limit: { type: 'integer' },
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

function compactPinnedSnapshotContext(context: CustomerIntelligenceSnapshotContext): Record<string, unknown> {
  return {
    featureSnapshot: context.featureSnapshot,
    rfmSnapshot: context.rfmSnapshot,
    clusterSnapshot: context.clusterSnapshot,
    population: context.population,
    contractVersion: context.contractVersion,
  };
}

function compactRecentResults(sessionContext: ReturnType<typeof buildCopilotSessionContext>): readonly Record<string, unknown>[] {
  return sessionContext.recentResults.slice(-2).map((result) => ({
    queryId: result.queryId,
    queryPlanHash: result.queryPlanHash,
    columns: result.columns.map((column) => column.name),
    rowCount: result.rowCount,
    truncated: result.truncated,
  }));
}

function toolSynthesisMessages(args: {
  readonly question: string;
  readonly sessionContext: ReturnType<typeof buildCopilotSessionContext>;
  readonly semanticAnchor: CopilotSemanticAnchor | null;
  readonly evidenceBundle: AnalyticalEvidenceBundle;
}): readonly CopilotConversationalMessage[] {
  return [
    { role: 'system', content: CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SYNTHESIS_INSTRUCTIONS.join('\n') },
    {
      role: 'user',
      content: JSON.stringify({
        synthesisPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SYNTHESIS_PROMPT_VERSION,
        question: args.question,
        semanticAnchor: args.semanticAnchor,
        semanticFocus: compactSemanticFocus(args.sessionContext),
        evidence: args.evidenceBundle,
        epistemicBoundaries: [
          'Observed differences are not causal proof.',
          'Do not infer profitability without margin, cost, or profit fields.',
          'Mention insufficient evidence or partial coverage only when material.',
        ],
      }),
    },
  ];
}

function compactSemanticFocus(sessionContext: ReturnType<typeof buildCopilotSessionContext>): Record<string, unknown> {
  return {
    entityType: sessionContext.semanticFocus.activeEntity?.type ?? sessionContext.semanticFocus.activeFinding?.entityType ?? null,
    entityId: sessionContext.semanticFocus.activeEntity?.id ?? sessionContext.semanticFocus.activeFinding?.entityId ?? null,
    metric: sessionContext.semanticFocus.activeMetric?.name ?? sessionContext.semanticFocus.activeFinding?.metric ?? null,
    activeFindingType: sessionContext.semanticFocus.activeFinding?.findingType ?? null,
    activeFindingSourceQueryId: sessionContext.semanticFocus.activeFinding?.sourceQueryId ?? null,
  };
}

function semanticAnchorFromSessionContext(sessionContext: ReturnType<typeof buildCopilotSessionContext>): CopilotSemanticAnchor | null {
  const finding = sessionContext.semanticFocus.activeFinding;
  if (finding) {
    return {
      entityType: finding.entityType,
      entityId: finding.entityId,
      metric: finding.metric,
      findingType: finding.findingType,
      sourceQueryId: finding.sourceQueryId,
    };
  }
  const entity = sessionContext.semanticFocus.activeEntity;
  const metric = sessionContext.semanticFocus.activeMetric;
  if (!entity && !metric) return null;
  return {
    entityType: entity?.type ?? null,
    entityId: entity?.id ?? null,
    metric: metric?.name ?? null,
    findingType: null,
    sourceQueryId: entity?.sourceQueryId ?? metric?.sourceQueryId ?? null,
  };
}

function semanticAnchorDiagnostic(anchor: CopilotSemanticAnchor | null) {
  return {
    semanticAnchorEntityType: anchor?.entityType ?? null,
    semanticAnchorEntityId: anchor?.entityId ?? null,
    semanticAnchorMetric: anchor?.metric ?? null,
    semanticAnchorFindingType: anchor?.findingType ?? null,
  };
}

function buildAnalyticalEvidenceBundle(args: {
  readonly semanticAnchor: CopilotSemanticAnchor | null;
  readonly executions: readonly { readonly id: string; readonly plan: AnalyticalQueryPlan; readonly result: AnalyticalQueryResult }[];
  readonly provenance: CustomerIntelligenceSnapshotContext;
}): AnalyticalEvidenceBundle {
  const facts: AnalyticalEvidenceBundle['facts'][number][] = [];
  const comparisons: AnalyticalEvidenceBundle['comparisons'][number][] = [];
  const distributions: AnalyticalEvidenceBundle['distributions'][number][] = [];
  const limitations: string[] = [];
  const entityTypesPresent = new Set<'cluster' | 'rfm_segment'>();

  for (const execution of args.executions) {
    if (execution.result.execution.truncated) limitations.push(`${execution.id}: result truncated`);
    const entity = entityDescriptorForPlan(execution.plan);
    const populationBasis = analysisPopulationBasisForPlan(execution.plan);
    for (const metric of execution.plan.metrics ?? []) {
      if (entity?.type === 'cluster' && populationBasis === 'rfm' && isPopulationCountMetric(metric.aggregation)) continue;
      const metricName = resolveSemanticMetricName(metric);
      if (!entity) {
        const value = scalarValue(execution.result.rows[0], metric.alias);
        if (isEvidenceValue(value)) {
          // A bare "IS NULL" filter on the entity dimension (e.g. an unclustered-customer count)
          // reads far better as "clientes sin cluster asignado" than as a generic audience fact.
          const nullEntityType = nullEntityDimensionFromFilters(execution.plan);
          facts.push({ queryId: execution.id, metric: metricName, entityType: nullEntityType ?? 'audience', entityId: null, value, comparison: 'observed' });
        }
        continue;
      }
      entityTypesPresent.add(entity.type);

      const rankedRows = rankedRowsForMetric(execution, metric.alias);
      const anchorIndex = args.semanticAnchor && args.semanticAnchor.entityType === entity.type
        ? rankedRows.findIndex((row) => sameEntityId(scalarValue(row, entity.resultField), args.semanticAnchor?.entityId ?? null))
        : -1;

      if (anchorIndex >= 0) {
        const selected = rankedRows[anchorIndex]!;
        const entityId = scalarValue(selected, entity.resultField);
        const value = scalarValue(selected, metric.alias);
        if (!isEvidenceValue(value)) continue;
        facts.push({
          queryId: execution.id,
          metric: metricName,
          entityType: entity.type,
          entityId: entityId === null || typeof entityId === 'boolean' ? null : entityId,
          value,
          rank: anchorIndex + 1,
          comparison: anchorIndex === 0 ? comparisonForMetricOrder(execution.plan, metric.alias) : 'observed',
        });
        // A peer range plus an explicit contrast against the peer farthest from the anchor's
        // value (task MARKETING-R1-T05.8.6 Section 6: "explicit target vs peer") - a single,
        // bounded comparison per metric, never O(n^2) pairwise combinations.
        const numericValues = rankedRows.map((row) => numericComparableValue(scalarValue(row, metric.alias))).filter((v): v is number => v !== null);
        const contrastIndex = farthestPeerIndex(rankedRows, anchorIndex, metric.alias);
        if (contrastIndex !== null) {
          const comparisonEntry = buildEvidenceComparison({
            queryId: execution.id,
            metric: metricName,
            basis: 'anchor_vs_peer_range',
            leftRow: selected,
            rightRow: rankedRows[contrastIndex]!,
            entity,
            metricAlias: metric.alias,
            peerMin: numericValues.length > 0 ? Math.min(...numericValues) : null,
            peerMax: numericValues.length > 0 ? Math.max(...numericValues) : null,
          });
          if (comparisonEntry) comparisons.push(comparisonEntry);
        }
        continue;
      }

      if (rankedRows.length === 0) continue;
      if (rankedRows.length === 1) {
        const selected = rankedRows[0]!;
        const entityId = scalarValue(selected, entity.resultField);
        const value = scalarValue(selected, metric.alias);
        if (!isEvidenceValue(value)) continue;
        facts.push({
          queryId: execution.id,
          metric: metricName,
          entityType: entity.type,
          entityId: entityId === null || typeof entityId === 'boolean' ? null : entityId,
          value,
          rank: 1,
          comparison: comparisonForMetricOrder(execution.plan, metric.alias),
        });
        continue;
      }

      // No anchored entity and more than one row: this query represents every observed group,
      // not a single winner (task MARKETING-R1-T05.8.5 Section 2) - preserve it as its own
      // bounded distribution instead of N loose facts, so it renders as one coherent breakdown.
      const distributionRows: { entityId: string | number | null; value: string | number | boolean }[] = [];
      for (const row of rankedRows.slice(0, ANALYTICAL_EVIDENCE_MAX_DISTRIBUTION_ROWS)) {
        const rowValue = scalarValue(row, metric.alias);
        if (!isEvidenceValue(rowValue) || rowValue === null) continue;
        const rowEntityId = scalarValue(row, entity.resultField);
        distributionRows.push({ entityId: rowEntityId === null || typeof rowEntityId === 'boolean' ? null : rowEntityId, value: rowValue });
      }
      if (distributionRows.length > 0) distributions.push({ queryId: execution.id, metric: metricName, entityType: entity.type, rows: distributionRows });

      // Section 6: "for broad multi-cluster analysis, comparisons may use rank, min/max, peer
      // range, explicit target vs peer" - a pairwise comparison when the query is literally a
      // two-entity request (e.g. "compare cluster 3 vs cluster 1"), or the two extremes only
      // when the query is ranked, never a full pairwise matrix.
      if (rankedRows.length === 2) {
        const comparisonEntry = buildEvidenceComparison({
          queryId: execution.id,
          metric: metricName,
          basis: 'pairwise',
          leftRow: rankedRows[0]!,
          rightRow: rankedRows[1]!,
          entity,
          metricAlias: metric.alias,
          peerMin: null,
          peerMax: null,
        });
        if (comparisonEntry) comparisons.push(comparisonEntry);
      } else if (execution.plan.orderBy?.some((order) => order.field === metric.alias)) {
        const comparisonEntry = buildEvidenceComparison({
          queryId: execution.id,
          metric: metricName,
          basis: 'top_vs_bottom',
          leftRow: rankedRows[0]!,
          rightRow: rankedRows[rankedRows.length - 1]!,
          entity,
          metricAlias: metric.alias,
          peerMin: null,
          peerMax: null,
        });
        if (comparisonEntry) comparisons.push(comparisonEntry);
      }
    }
  }

  const populationContexts = derivePopulationContexts(args.executions);
  const hasMaterialPopulationContext = populationContexts.some((context) => isMaterialPopulationContext(context));

  // Material limitations only (task MARKETING-R1-T05.8.6 Section 11): a plain-language sentence,
  // only when the analysis actually shows that entity type, never raw coverage percentages
  // injected into every answer regardless of relevance. Exact coverage numbers stay available on
  // provenance/metadata for anything that needs them.
  if (!hasMaterialPopulationContext && entityTypesPresent.has('cluster') && args.provenance.population.clusterCoveragePct < 100) {
    limitations.push('Este analisis corresponde a los clientes que tienen un cluster asignado.');
  }
  if (!hasMaterialPopulationContext && entityTypesPresent.has('rfm_segment') && args.provenance.population.rfmCoveragePct < 100) {
    limitations.push('Este analisis corresponde a los clientes con informacion RFM disponible.');
  }

  return compactEvidenceBundle({
    anchor: args.semanticAnchor ? { entityType: args.semanticAnchor.entityType, entityId: args.semanticAnchor.entityId, metric: args.semanticAnchor.metric } : null,
    facts: facts.slice(0, ANALYTICAL_EVIDENCE_MAX_FACTS),
    comparisons: comparisons.slice(0, ANALYTICAL_EVIDENCE_MAX_COMPARISONS),
    distributions,
    populationContexts,
    limitations: [...new Set(limitations)].slice(0, 4),
  });
}

function farthestPeerIndex(rows: readonly AnalyticalQueryResult['rows'][number][], anchorIndex: number, metricAlias: string): number | null {
  const anchorValue = numericComparableValue(scalarValue(rows[anchorIndex], metricAlias));
  if (anchorValue === null) return null;
  let farthestIndex: number | null = null;
  let farthestDistance = -1;
  rows.forEach((row, index) => {
    if (index === anchorIndex) return;
    const value = numericComparableValue(scalarValue(row, metricAlias));
    if (value === null) return;
    const distance = Math.abs(value - anchorValue);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = index;
    }
  });
  return farthestIndex;
}

// Deterministic, Decimal-safe-enough arithmetic (task Section 6): every input already came from a
// validated AnalyticalQueryResult, so this only rounds for display - no model-generated numbers.
function buildEvidenceComparison(args: {
  readonly queryId: string;
  readonly metric: string;
  readonly basis: AnalyticalEvidenceBundle['comparisons'][number]['basis'];
  readonly leftRow: AnalyticalQueryResult['rows'][number];
  readonly rightRow: AnalyticalQueryResult['rows'][number];
  readonly entity: { readonly type: 'cluster' | 'rfm_segment'; readonly resultField: string };
  readonly metricAlias: string;
  readonly peerMin: number | null;
  readonly peerMax: number | null;
}): AnalyticalEvidenceBundle['comparisons'][number] | null {
  const leftValue = numericComparableValue(scalarValue(args.leftRow, args.metricAlias));
  const rightValue = numericComparableValue(scalarValue(args.rightRow, args.metricAlias));
  if (leftValue === null || rightValue === null) return null;
  const leftEntityId = scalarValue(args.leftRow, args.entity.resultField);
  const rightEntityId = scalarValue(args.rightRow, args.entity.resultField);
  const relativeDifference = rightValue !== 0 ? (leftValue - rightValue) / rightValue : null;
  return {
    queryId: args.queryId,
    metric: args.metric,
    basis: args.basis,
    left: { entityType: args.entity.type, entityId: leftEntityId === null || typeof leftEntityId === 'boolean' ? null : leftEntityId, value: leftValue },
    right: { entityType: args.entity.type, entityId: rightEntityId === null || typeof rightEntityId === 'boolean' ? null : rightEntityId, value: rightValue },
    absoluteDifference: formatEvidenceNumber(leftValue - rightValue),
    relativeDifference: relativeDifference !== null ? relativeDifference.toFixed(4) : null,
    peerMin: args.peerMin !== null ? formatEvidenceNumber(args.peerMin) : null,
    peerMax: args.peerMax !== null ? formatEvidenceNumber(args.peerMax) : null,
  };
}

function compactEvidenceBundle(bundle: AnalyticalEvidenceBundle): AnalyticalEvidenceBundle {
  let compacted = bundle;
  while (
    JSON.stringify(compacted).length > ANALYTICAL_EVIDENCE_BUNDLE_MAX_CHARS &&
    (compacted.comparisons.length > 0 || compacted.facts.length > 1 || compacted.distributions.length > 0 || compacted.populationContexts.length > 0 || compacted.limitations.length > 0)
  ) {
    if (compacted.comparisons.length > 0) {
      compacted = { ...compacted, comparisons: compacted.comparisons.slice(0, -1) };
    } else if (compacted.distributions.some((distribution) => distribution.rows.length > 1)) {
      compacted = { ...compacted, distributions: trimLargestDistribution(compacted.distributions) };
    } else if (compacted.populationContexts.length > 0) {
      compacted = { ...compacted, populationContexts: compacted.populationContexts.slice(0, -1) };
    } else if (compacted.facts.length > 1) {
      compacted = { ...compacted, facts: compacted.facts.slice(0, -1) };
    } else if (compacted.distributions.length > 0) {
      compacted = { ...compacted, distributions: compacted.distributions.slice(0, -1) };
    } else {
      compacted = { ...compacted, limitations: compacted.limitations.slice(0, -1) };
    }
  }
  return compacted;
}

function derivePopulationContexts(
  executions: readonly { readonly id: string; readonly plan: AnalyticalQueryPlan; readonly result: AnalyticalQueryResult }[],
): readonly CopilotPopulationContext[] {
  const fullCounts = new Map<string, number>();
  const analyzedCounts = new Map<string, number>();

  for (const execution of executions) {
    const entity = entityDescriptorForPlan(execution.plan);
    if (!entity) continue;
    const basis = analysisPopulationBasisForPlan(execution.plan);
    for (const metric of execution.plan.metrics ?? []) {
      if (!isPopulationCountMetric(metric.aggregation)) continue;
      for (const row of execution.result.rows.slice(0, ANALYTICAL_EVIDENCE_MAX_DISTRIBUTION_ROWS)) {
        const entityId = scalarValue(row, entity.resultField);
        const population = numericCountValue(scalarValue(row, metric.alias));
        if (entityId === null || typeof entityId === 'boolean' || population === null) continue;
        const key = populationContextKey(entity.type, entityId, basis ?? 'full');
        if (basis === 'rfm') analyzedCounts.set(key, population);
        else fullCounts.set(key, population);
      }
    }
  }

  const contexts: CopilotPopulationContext[] = [];
  const seen = new Set<string>();
  for (const execution of executions) {
    const entity = entityDescriptorForPlan(execution.plan);
    const basis = analysisPopulationBasisForPlan(execution.plan);
    if (!entity || !basis) continue;
    for (const row of execution.result.rows.slice(0, ANALYTICAL_EVIDENCE_MAX_DISTRIBUTION_ROWS)) {
      const entityId = scalarValue(row, entity.resultField);
      if (entityId === null || typeof entityId === 'boolean') continue;
      const analyzedPopulation = analyzedCounts.get(populationContextKey(entity.type, entityId, basis));
      const fullPopulation = fullCounts.get(populationContextKey(entity.type, entityId, 'full'));
      if (analyzedPopulation === undefined && fullPopulation === undefined) continue;
      const contextKey = populationContextKey(entity.type, entityId, basis);
      if (seen.has(contextKey)) continue;
      seen.add(contextKey);
      contexts.push({
        entityType: entity.type,
        entityId,
        ...(typeof fullPopulation === 'number' ? { fullPopulation } : {}),
        ...(typeof analyzedPopulation === 'number' ? { analyzedPopulation } : {}),
        analysisBasis: basis,
        ...(typeof fullPopulation === 'number' && fullPopulation > 0 && typeof analyzedPopulation === 'number'
          ? { coverageRatio: analyzedPopulation / fullPopulation }
          : {}),
      });
    }
  }
  return contexts;
}

function buildPopulationDiagnostics(
  populationContexts: readonly CopilotPopulationContext[],
): Partial<Pick<
  NonNullable<Extract<CustomerIntelligenceCopilotResponse, { readonly status: 'answered' }>['analysis']>,
  'populationContextPresent' | 'fullPopulationCount' | 'analyzedPopulationCount' | 'analysisPopulationBasis' | 'populationContexts'
>> {
  if (populationContexts.length === 0) return { populationContextPresent: false };
  const primary = populationContexts.length === 1 ? populationContexts[0] : populationContexts.find((context) => isMaterialPopulationContext(context)) ?? null;
  return {
    populationContextPresent: true,
    ...(primary && typeof primary.fullPopulation === 'number' ? { fullPopulationCount: primary.fullPopulation } : {}),
    ...(primary && typeof primary.analyzedPopulation === 'number' ? { analyzedPopulationCount: primary.analyzedPopulation } : {}),
    ...(primary?.analysisBasis ? { analysisPopulationBasis: primary.analysisBasis } : {}),
    populationContexts,
  };
}

function analysisPopulationBasisForPlan(plan: AnalyticalQueryPlan): 'rfm' | null {
  const fields = [
    ...(plan.dimensions ?? []),
    ...filterFieldNames(plan),
    ...(plan.metrics ?? []).map((metric) => metric.field).filter((field): field is string => typeof field === 'string'),
  ];
  return fields.some((field) => field.startsWith('rfm.')) ? 'rfm' : null;
}

function isPopulationCountMetric(aggregation: string): boolean {
  return aggregation === 'count' || aggregation === 'count_distinct';
}

function numericCountValue(value: unknown): number | null {
  if (!isEvidenceValue(value)) return null;
  const numeric = numericComparableValue(value);
  return numeric === null ? null : Math.round(numeric);
}

function populationContextKey(entityType: string, entityId: string | number, basis: string): string {
  return `${entityType}:${String(entityId)}:${basis}`;
}

function isMaterialPopulationContext(context: CopilotPopulationContext): boolean {
  return typeof context.fullPopulation === 'number'
    && typeof context.analyzedPopulation === 'number'
    && context.fullPopulation > 0
    && context.analyzedPopulation !== context.fullPopulation;
}

function renderPopulationContextLine(context: CopilotPopulationContext): string | null {
  if (!isMaterialPopulationContext(context)) return null;
  const entity = businessEntityLabel(context.entityType, context.entityId);
  const fullPopulation = formatBusinessValue(context.fullPopulation ?? null, 'count');
  const analyzedPopulation = formatBusinessValue(context.analyzedPopulation ?? null, 'count');
  if (context.analysisBasis === 'rfm') {
    return `${entity} tiene ${fullPopulation} clientes en total. Para esta comparacion RFM hay informacion disponible para ${analyzedPopulation} de ellos, por lo que las metricas RFM se calculan sobre esa subpoblacion.`;
  }
  return `${entity} tiene ${fullPopulation} clientes en total. Para este analisis hay informacion disponible para ${analyzedPopulation} de ellos, por lo que los resultados se calculan sobre esa subpoblacion.`;
}

// Trims one row off whichever distribution currently holds the most rows, so a char-budget
// overrun degrades every distribution gracefully instead of dropping one entirely first.
function trimLargestDistribution(distributions: AnalyticalEvidenceBundle['distributions']): AnalyticalEvidenceBundle['distributions'] {
  let largestIndex = 0;
  for (let index = 1; index < distributions.length; index += 1) {
    if (distributions[index]!.rows.length > distributions[largestIndex]!.rows.length) largestIndex = index;
  }
  return distributions.map((distribution, index) => (index === largestIndex ? { ...distribution, rows: distribution.rows.slice(0, -1) } : distribution));
}

// The PrimaryAnalyticalFinding this turn established (task MARKETING-R1-T05.8.4 Section 2),
// read back from the just-persisted session via the same deriveSemanticFocus/
// selectPrimaryQueryResult classification used for the next turn's semantic anchor (task
// MARKETING-R1-T05.8.5) - never a second, parallel classifier that could disagree with it.
function primaryFindingDiagnostic(session: CopilotSession): {
  readonly primaryFindingEntityType: string | null;
  readonly primaryFindingEntityId: string | number | null;
  readonly primaryFindingMetric: string | null;
  readonly primaryFindingType: string | null;
  readonly primaryFindingSourceQueryId: string | null;
  readonly distributionRowCount?: number;
} {
  const finding = deriveSemanticFocus(session).activeFinding;
  if (!finding) {
    return { primaryFindingEntityType: null, primaryFindingEntityId: null, primaryFindingMetric: null, primaryFindingType: null, primaryFindingSourceQueryId: null };
  }
  const sourceEntry = session.analyticalState.results.find((entry) => entry.queryId === finding.sourceQueryId);
  return {
    primaryFindingEntityType: finding.entityType,
    primaryFindingEntityId: finding.entityId,
    primaryFindingMetric: finding.metric,
    primaryFindingType: finding.findingType,
    primaryFindingSourceQueryId: finding.sourceQueryId,
    ...(finding.findingType === 'distribution' && sourceEntry ? { distributionRowCount: sourceEntry.result.rowCount } : {}),
  };
}

// An audience-level query filtered to `IS NULL` on the entity dimension (e.g. an unclustered- or
// unsegmented-customer count) reads far better labeled by that dimension ("Clientes sin cluster
// asignado") than as a generic, unlabeled audience fact.
function nullEntityDimensionFromFilters(plan: AnalyticalQueryPlan): 'cluster' | 'rfm_segment' | null {
  const fields = filterFieldNames(plan);
  const isNullFields = new Set<string>();
  const filters = plan.filters;
  const nodes = Array.isArray(filters) ? filters : filters ? [filters as AnalyticalFilterNode] : [];
  for (const node of nodes) collectIsNullFields(node, isNullFields);
  if (fields.includes('cluster.clusterId') && isNullFields.has('cluster.clusterId')) return 'cluster';
  if (fields.includes('rfm.segmentCode') && isNullFields.has('rfm.segmentCode')) return 'rfm_segment';
  return null;
}

function collectIsNullFields(filter: AnalyticalFilterNode, fields: Set<string>): void {
  if ('field' in filter) {
    if (filter.operator === 'is_null') fields.add(filter.field);
    return;
  }
  if ('and' in filter) for (const child of filter.and) collectIsNullFields(child, fields);
  if ('or' in filter) for (const child of filter.or) collectIsNullFields(child, fields);
}

function entityDescriptorForPlan(plan: AnalyticalQueryPlan): { readonly type: 'cluster' | 'rfm_segment'; readonly resultField: string } | null {
  const dimensions = plan.dimensions ?? [];
  if (dimensions.includes('cluster.clusterId')) return { type: 'cluster', resultField: 'clusterId' };
  if (dimensions.includes('cluster.label')) return { type: 'cluster', resultField: 'label' };
  if (dimensions.includes('rfm.segmentCode')) return { type: 'rfm_segment', resultField: 'segmentCode' };
  return null;
}

function rankedRowsForMetric(
  execution: { readonly plan: AnalyticalQueryPlan; readonly result: AnalyticalQueryResult },
  metricAlias: string,
): readonly AnalyticalQueryResult['rows'][number][] {
  const rows = execution.result.rows.slice(0, ANALYTICAL_EVIDENCE_MAX_DISTRIBUTION_ROWS);
  if (execution.plan.orderBy?.some((order) => order.field === metricAlias)) return rows;
  return [...rows].sort((a, b) => {
    const left = numericComparableValue(scalarValue(a, metricAlias));
    const right = numericComparableValue(scalarValue(b, metricAlias));
    if (left === null || right === null) return 0;
    return right - left;
  });
}

function comparisonForMetricOrder(plan: AnalyticalQueryPlan, metricAlias: string): 'highest' | 'lowest' | 'observed' {
  const order = plan.orderBy?.find((candidate) => candidate.field === metricAlias);
  if (!order) return 'highest';
  return order.direction === 'asc' ? 'lowest' : 'highest';
}

function sameEntityId(left: string | number | boolean | null, right: string | number | null): boolean {
  if (left === null || typeof left === 'boolean' || right === null) return false;
  return String(left) === String(right);
}

function isEvidenceValue(value: unknown): value is string | number | boolean | null {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null;
}

function canUseDeterministicSynthesisFallback(error: unknown, evidenceBundle: AnalyticalEvidenceBundle): boolean {
  if (evidenceBundle.facts.length === 0 && evidenceBundle.comparisons.length === 0) return false;
  if (!error || typeof error !== 'object') return false;
  const category = (error as { readonly category?: unknown }).category;
  return category === 'provider_timeout' || category === 'provider_network_error' || category === 'provider_invalid_response';
}

function fallbackToolSynthesisResponse(args: {
  readonly session: CopilotSession;
  readonly turnId: string;
  readonly question: string;
  readonly executions: readonly { readonly id: string; readonly plan: AnalyticalQueryPlan; readonly result: AnalyticalQueryResult }[];
  readonly queryResults: readonly CopilotSessionQueryResult[];
  readonly evidenceBundle: AnalyticalEvidenceBundle;
  readonly selectionMetadata: CopilotModelMetadata | null;
  readonly provenance: CustomerIntelligenceSnapshotContext;
}): { readonly sessionId: string; readonly turnId: string; readonly queryIds: readonly string[]; readonly sourceQueryIds: readonly string[] } & CustomerIntelligenceCopilotResponse {
  return withSession(
    { sessionId: args.session.sessionId, turnId: args.turnId, queryIds: args.queryResults.map((entry) => entry.queryId), sourceQueryIds: [] },
    answered(
      args.executions,
      renderDeterministicEvidenceFallback(args.evidenceBundle, args.question),
      args.selectionMetadata,
      null,
      args.provenance,
      { used: true, populationContexts: args.evidenceBundle.populationContexts },
    ),
  );
}

// task MARKETING-R1-T05.8.6 Section 10: business-readable prose, never internal aliases (avg_r,
// customer_count, query ids, "rank N"). Every grouped value the (already bounded) evidence bundle
// retained must stay represented - no additional truncation is applied here.
function renderDeterministicEvidenceFallback(bundle: AnalyticalEvidenceBundle, question: string): string {
  if (asksForAnalyticalRecommendation(question)) {
    const recommendation = renderReactivationRecommendationFallback(bundle);
    if (recommendation) return recommendation;
  }

  const lines = bundle.populationContexts
    .map(renderPopulationContextLine)
    .filter((line): line is string => line !== null);

  for (const distribution of bundle.distributions) {
    const metric = resolveBusinessMetricByName(distribution.metric);
    const noun = distribution.entityType === 'rfm_segment' ? 'segmento' : 'cluster';
    lines.push(`Distribucion de ${metric.label.toLowerCase()} por ${noun}:`);
    for (const row of distribution.rows) {
      const suffix = metric.format === 'count' ? ' clientes' : '';
      lines.push(`- ${businessEntityLabel(distribution.entityType, row.entityId)}: ${formatBusinessValue(row.value, metric.format)}${suffix}.`);
    }
  }

  for (const comparison of bundle.comparisons) {
    const metric = resolveBusinessMetricByName(comparison.metric);
    const leftLabel = businessEntityLabel(comparison.left.entityType, comparison.left.entityId);
    const rightLabel = businessEntityLabel(comparison.right.entityType, comparison.right.entityId);
    const rightPreposition = comparison.right.entityType === 'audience' ? 'de' : 'del';
    const leftValue = formatBusinessValue(comparison.left.value, metric.format);
    const rightValue = formatBusinessValue(comparison.right.value, metric.format);
    const leftNumeric = typeof comparison.left.value === 'number' ? comparison.left.value : Number(comparison.left.value);
    const rightNumeric = typeof comparison.right.value === 'number' ? comparison.right.value : Number(comparison.right.value);
    const ratioPhrase = buildRatioPhrase(leftNumeric, rightNumeric);
    const hasSuffix = metric.format === 'count' ? `${leftLabel} tiene ${leftValue} clientes, frente a ${rightValue} ${rightPreposition} ${rightLabel}${ratioPhrase}.` : `${leftLabel} tiene ${metric.label.toLowerCase()} de ${leftValue}, frente a ${rightValue} ${rightPreposition} ${rightLabel}${ratioPhrase}.`;
    lines.push(hasSuffix);
  }

  for (const fact of bundle.facts) {
    const metric = resolveBusinessMetricByName(fact.metric);
    const value = formatBusinessValue(fact.value, metric.format);
    if (fact.entityType === 'audience') {
      lines.push(`${metric.label} observado: ${value}.`);
      continue;
    }
    const entity = businessEntityLabel(fact.entityType, fact.entityId);
    if (metric.format === 'count') {
      if (fact.entityId === null) lines.push(`${entity}: ${value}.`);
      else if (fact.comparison === 'highest') lines.push(`${entity} es el grupo con mas clientes: ${value}.`);
      else if (fact.comparison === 'lowest') lines.push(`${entity} es el grupo con menos clientes: ${value}.`);
      else lines.push(`${entity} tiene ${value} clientes.`);
      continue;
    }
    if (fact.comparison === 'highest') lines.push(`${entity} presenta el mayor ${metric.label.toLowerCase()} observado: ${value}.`);
    else if (fact.comparison === 'lowest') lines.push(`${entity} presenta el menor ${metric.label.toLowerCase()} observado: ${value}.`);
    else lines.push(`${entity} presenta ${metric.label.toLowerCase()} de ${value}.`);
  }

  lines.push(...bundle.limitations);
  return lines.join('\n');
}

function renderReactivationRecommendationFallback(bundle: AnalyticalEvidenceBundle): string | null {
  const recommendedEntity = bundle.anchor?.entityType === 'cluster' || bundle.anchor?.entityType === 'rfm_segment'
    ? { entityType: bundle.anchor.entityType, entityId: bundle.anchor.entityId }
    : firstRecommendationEntity(bundle);
  if (!recommendedEntity || recommendedEntity.entityId === null) return null;

  const entity = businessEntityLabel(recommendedEntity.entityType, recommendedEntity.entityId);
  const supportingFacts = bundle.facts.filter((fact) =>
    fact.entityType === recommendedEntity.entityType
    && fact.entityId !== null
    && String(fact.entityId) === String(recommendedEntity.entityId)
    && fact.value !== null,
  );
  const supportingComparisons = bundle.comparisons.filter((comparison) =>
    comparison.left.entityType === recommendedEntity.entityType
    && comparison.left.entityId !== null
    && String(comparison.left.entityId) === String(recommendedEntity.entityId),
  );
  const populationLines = bundle.populationContexts
    .filter((context) => context.entityType === recommendedEntity.entityType && context.entityId !== null && String(context.entityId) === String(recommendedEntity.entityId))
    .map(renderPopulationContextLine)
    .filter((line): line is string => line !== null);

  const valueSignals = supportingFacts.filter((fact) => isReactivationValueMetric(fact.metric));
  const inactivitySignals = supportingFacts.filter((fact) => isReactivationInactivityMetric(fact.metric));
  const factLine = supportingFacts
    .slice(0, 2)
    .map((fact) => {
      const metric = resolveBusinessMetricByName(fact.metric);
      return `${metric.label}: ${formatBusinessValue(fact.value, metric.format)}`;
    })
    .join('; ');
  const comparisonLine = supportingComparisons[0]
    ? renderReactivationComparisonLine(supportingComparisons[0])
    : null;

  const lines = [...populationLines];
  lines.push(`FACT: ${entity}${factLine.length > 0 ? ` muestra ${factLine}.` : ' concentra las senales historicas mas fuertes observadas para esta decision.'}`);
  lines.push(`INTERPRETACION: ${buildReactivationInterpretation(entity, valueSignals.length > 0, inactivitySignals.length > 0)}.`);
  lines.push(`RECOMENDACION: Priorizaria ${entity} para una campana de reactivacion por combinar ${buildReactivationReason(valueSignals.length > 0, inactivitySignals.length > 0)}.`);
  if (comparisonLine) lines.push(`FACT: ${comparisonLine}`);
  lines.push('LIMITACION: Esta es una recomendacion basada en evidencia historica; no predice conversion ni garantiza resultados de campana.');
  return lines.join('\n');
}

function firstRecommendationEntity(bundle: AnalyticalEvidenceBundle): { readonly entityType: 'cluster' | 'rfm_segment'; readonly entityId: string | number | null } | null {
  const firstFact = bundle.facts.find((fact) => isPopulationEntityType(fact.entityType) && fact.entityId !== null);
  if (firstFact && isPopulationEntityType(firstFact.entityType)) return { entityType: firstFact.entityType, entityId: firstFact.entityId };
  const firstComparison = bundle.comparisons.find((comparison) => isPopulationEntityType(comparison.left.entityType) && comparison.left.entityId !== null);
  if (firstComparison && isPopulationEntityType(firstComparison.left.entityType)) {
    return { entityType: firstComparison.left.entityType, entityId: firstComparison.left.entityId };
  }
  return null;
}

function isPopulationEntityType(entityType: string | null): entityType is 'cluster' | 'rfm_segment' {
  return entityType === 'cluster' || entityType === 'rfm_segment';
}

function isReactivationValueMetric(metric: string): boolean {
  return metric === 'averageOrderValue'
    || metric === 'totalSpent'
    || metric === 'validOrderCount'
    || metric === 'orders365d'
    || metric === 'averageFrequencyScore'
    || metric === 'averageMonetaryScore';
}

function isReactivationInactivityMetric(metric: string): boolean {
  return metric === 'daysSinceLastOrder' || metric === 'averageRecencyScore';
}

function buildReactivationInterpretation(entity: string, hasValueSignal: boolean, hasInactivitySignal: boolean): string {
  if (hasValueSignal && hasInactivitySignal) return `${entity} combina valor historico con senales de inactividad recientes o acumuladas`;
  if (hasValueSignal) return `${entity} destaca por su valor historico y por eso puede ser un buen candidato de recuperacion`;
  if (hasInactivitySignal) return `${entity} muestra inactividad suficiente como para justificar una reactivacion prioritaria`;
  return `${entity} aparece como el mejor candidato disponible con la evidencia historica observada`;
}

function buildReactivationReason(hasValueSignal: boolean, hasInactivitySignal: boolean): string {
  if (hasValueSignal && hasInactivitySignal) return 'valor historico e inactividad observada';
  if (hasValueSignal) return 'valor historico observado';
  if (hasInactivitySignal) return 'inactividad observada';
  return 'las senales historicas disponibles';
}

function renderReactivationComparisonLine(comparison: AnalyticalEvidenceBundle['comparisons'][number]): string {
  const metric = resolveBusinessMetricByName(comparison.metric);
  const leftLabel = businessEntityLabel(comparison.left.entityType, comparison.left.entityId);
  const rightLabel = businessEntityLabel(comparison.right.entityType, comparison.right.entityId);
  return `${leftLabel} se compara con ${rightLabel} en ${metric.label.toLowerCase()}: ${formatBusinessValue(comparison.left.value, metric.format)} frente a ${formatBusinessValue(comparison.right.value, metric.format)}${buildRatioPhrase(Number(comparison.left.value), Number(comparison.right.value))}.`;
}

function buildRatioPhrase(leftValue: number, rightValue: number): string {
  if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return '';
  const ratio = leftValue >= rightValue ? formatRatio(leftValue, rightValue) : formatRatio(rightValue, leftValue);
  if (!ratio) return '';
  return `; es aproximadamente ${ratio} ${leftValue >= rightValue ? 'mayor' : 'menor'}`;
}

function messageProjectionChars(messages: readonly CopilotConversationalMessage[]): number {
  return messages.reduce((sum, message) => {
    if (message.role === 'assistant') return sum + (message.content?.length ?? 0) + (message.toolCalls ? JSON.stringify(message.toolCalls).length : 0);
    return sum + message.content.length;
  }, 0);
}

function toolRuntimeSemanticDiagnostic(sessionContext: ReturnType<typeof buildCopilotSessionContext>) {
  return {
    activeSemanticEntityType: sessionContext.semanticFocus.activeEntity?.type ?? null,
    activeSemanticEntityId: sessionContext.semanticFocus.activeEntity?.id ?? null,
    activeMetric: sessionContext.semanticFocus.activeMetric?.name ?? null,
    activeFindingType: sessionContext.semanticFocus.activeFinding?.findingType ?? null,
    activeFindingSourceQueryId: sessionContext.semanticFocus.activeFinding?.sourceQueryId ?? null,
    unresolvedClarificationPresent: sessionContext.semanticFocus.unresolvedClarification !== null,
  };
}

function toolCallDiagnostic(steps: readonly ValidatedStep[]) {
  return {
    toolCallCount: 1,
    toolQueryIds: steps.map((step) => step.id),
    toolQueryCount: steps.length,
    compactToolContract: steps.length > 0 && steps.every((step) => step.compactToolContract),
    toolQueries: steps.map((step) => ({
      id: step.id,
      dimensions: step.plan.dimensions ?? [],
      metrics: step.plan.metrics?.map((metric) => metric.alias) ?? [],
      filterFieldNames: filterFieldNames(step.plan),
      hasEntityFilter: filterFieldNames(step.plan).some((field) => field === 'cluster.clusterId' || field === 'rfm.segmentCode'),
      limit: step.plan.limit ?? null,
      orderByFields: step.plan.orderBy?.map((order) => order.field) ?? [],
    })),
  };
}

function filterFieldNames(plan: AnalyticalQueryPlan): readonly string[] {
  const fields: string[] = [];
  const filters = plan.filters;
  if (Array.isArray(filters)) {
    for (const filter of filters) collectFilterFields(filter, fields);
  } else if (filters) {
    collectFilterFields(filters as AnalyticalFilterNode, fields);
  }
  return [...new Set(fields)];
}

function collectFilterFields(filter: AnalyticalFilterNode, fields: string[]): void {
  if ('field' in filter) fields.push(filter.field);
  if ('and' in filter) for (const child of filter.and) collectFilterFields(child, fields);
  if ('or' in filter) for (const child of filter.or) collectFilterFields(child, fields);
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
    finalResponseState: 'success',
    answer: message,
    analysis: {
      contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
      decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
      decisionAction: 'respond_directly',
      orchestratorModel: modelName(metadata),
      finalResponseState: 'success',
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
    const validation = 'plan' in query ? validateCopilotAnalyticalQueryPlan(query.plan) : expandCompactAnalyticalQuery(rawQuery);
    if (!validation.ok) errors.push(...validation.errors.map((error) => `${query.id}: ${error}`));
    else steps.push({ id: query.id, plan: validation.plan, compactToolContract: !('plan' in query) || isCompactAnalyticalQueryShape(query.plan) });
  }

  if (errors.length > 0) {
    const failureStatus = errors.some((error) => /unknown (compact )?field|unsupported aggregation|unsupported operator|invalid orderBy|must specify either "select"|requires a structured AnalyticalQueryPlan|alias matching|expanded T03 plan invalid/.test(error))
      ? 'tool_call_query_validation_failed'
      : 'tool_call_invalid_arguments';
    return { ok: false, failureStatus, errors };
  }
  return { ok: true, toolCall, steps };
}

function validateCopilotAnalyticalQueryPlan(rawPlan: unknown):
  | { readonly ok: true; readonly plan: AnalyticalQueryPlan }
  | { readonly ok: false; readonly errors: readonly string[] } {
  if (isCompactAnalyticalQueryShape(rawPlan)) return expandCompactAnalyticalQuery(rawPlan);
  const validation = validateAnalyticalQueryPlan(rawPlan);
  return validation.ok ? { ok: true, plan: validation.plan.canonical } : validation;
}

function queryCountFromToolCalls(toolCalls: readonly CopilotToolCall[]): number {
  const first = toolCalls[0];
  if (!first || first.arguments === null || typeof first.arguments !== 'object' || Array.isArray(first.arguments)) return 0;
  const queries = (first.arguments as { readonly queries?: unknown }).queries;
  return Array.isArray(queries) ? queries.length : 0;
}

function toolArgumentChars(toolCalls: readonly CopilotToolCall[]): number {
  return toolCalls.reduce((sum, call) => sum + JSON.stringify(call.arguments ?? null).length, 0);
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
  const deterministicAnswer = shouldUseDeterministicAnswer(executions) ? renderDeterministicSimpleAnswer(executions, args.session.pinnedContext) : null;
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
    const validation = validateCopilotAnalyticalQueryPlan(query.plan);
    if (!validation.ok) errors.push(...validation.errors.map((error) => `${query.id}: ${error}`));
    else steps.push({ id: query.id, plan: validation.plan, compactToolContract: isCompactAnalyticalQueryShape(query.plan) });
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
  if (!plan || plan.select || !plan.metrics || plan.metrics.length === 0) return false;
  const metric = primaryDeterministicMetric(plan);
  if (!metric) return false;
  const dimension = primaryDeterministicDimension(plan);
  const dimensionCount = semanticDimensionCount(plan);
  if (dimensionCount === 0) return plan.metrics.length === 1;
  if (!dimension) return false;
  if (metric.aggregation === 'count') return true;
  return isSimpleTopMetricRankingPlan(plan);
}

function deterministicRendererEligibility(
  executions: readonly { readonly plan: AnalyticalQueryPlan; readonly result: AnalyticalQueryResult }[],
  semanticAnchor: CopilotSemanticAnchor | null = null,
): { readonly eligible: boolean; readonly reason: DeterministicRendererReason } {
  if (executions.length !== 1) return { eligible: false, reason: 'multiple_queries' };
  const execution = executions[0];
  if (!execution) return { eligible: false, reason: 'unexpected_result_shape' };
  // Only an anchor that names a specific entity (top_rank/single_value with a concrete entityId)
  // must force synthesis, to protect that entity from being silently replaced by a new ranking
  // (task MARKETING-R1-T05.8.3). A `distribution` anchor names no entity at all (task
  // MARKETING-R1-T05.8.5 Section 4), so a fresh follow-up ranking - e.g. "Cual tiene mas?" after
  // "Cuantos hay en cada cluster?" - remains eligible for the fast deterministic path.
  if (anchorProtectsSpecificEntity(semanticAnchor)) return { eligible: false, reason: 'explanatory_question_requires_synthesis' };
  if (execution.plan.select || !execution.plan.metrics || execution.plan.metrics.length === 0) return { eligible: false, reason: 'unexpected_result_shape' };
  const dimensionCount = semanticDimensionCount(execution.plan);
  if (dimensionCount === 0 && execution.plan.metrics.length !== 1) return { eligible: false, reason: 'multiple_metrics' };
  const metric = primaryDeterministicMetric(execution.plan);
  if (!metric) return { eligible: false, reason: execution.plan.metrics.length > 1 ? 'multiple_metrics' : 'unexpected_result_shape' };
  if (dimensionCount > 0 && !primaryDeterministicDimension(execution.plan)) return { eligible: false, reason: 'unsupported_dimension' };
  if (dimensionCount > 0 && metric.aggregation !== 'count' && !execution.plan.orderBy?.length) return { eligible: false, reason: 'missing_order' };
  if (dimensionCount > 0 && metric.aggregation !== 'count' && !isSimpleTopMetricRankingPlan(execution.plan)) return { eligible: false, reason: 'order_metric_mismatch' };
  // RESULT_LIMIT_TRUNCATION caused by the plan's own `LIMIT 1` top-k request is semantically
  // safe (task MARKETING-R1-T05.8.4 Section 1): the caller asked for only the winner, so rows
  // beyond it are intentionally absent, not a runtime cutoff of needed data.
  const truncationSafe = !execution.result.execution.truncated || isIntentionalTopKTruncation(execution.plan, dimensionCount);
  if (!truncationSafe) return { eligible: false, reason: 'truncated_result' };
  const resultReason = deterministicResultRejectionReason(execution, metric);
  if (resultReason) return { eligible: false, reason: resultReason };
  return { eligible: true, reason: execution.result.execution.truncated ? 'eligible_top_k_truncation' : 'eligible' };
}

function isIntentionalTopKTruncation(plan: AnalyticalQueryPlan, dimensionCount: number): boolean {
  return plan.limit === 1 && dimensionCount === 1 && !!plan.orderBy?.length && isSimpleTopMetricRankingPlan(plan);
}

function anchorProtectsSpecificEntity(semanticAnchor: CopilotSemanticAnchor | null): boolean {
  if (!semanticAnchor || semanticAnchor.findingType === null || semanticAnchor.findingType === 'distribution') return false;
  return semanticAnchor.entityId !== null;
}

function renderDeterministicSimpleAnswer(
  executions: readonly { readonly plan: AnalyticalQueryPlan; readonly result: AnalyticalQueryResult }[],
  provenance: CustomerIntelligenceSnapshotContext,
): string | null {
  if (executions.length !== 1) return null;
  const execution = executions[0];
  // Truncation safety is already decided by deterministicRendererEligibility (callers only
  // reach this function when eligible, including the safe top-k truncation case), so this does
  // not re-reject on `execution.result.execution.truncated`.
  if (!execution || !canRenderDeterministicSimpleAnswer(execution.plan) || !resultSupportsDeterministicAnswer(execution)) return null;
  const metric = primaryDeterministicMetric(execution.plan);
  if (!metric) return null;
  const businessMetric = resolveBusinessMetric(metric);
  if ((execution.plan.dimensions?.length ?? 0) === 0 && metric.aggregation === 'count') {
    const value = scalarValue(execution.result.rows[0], metric.alias);
    if (typeof value !== 'number') return null;
    return `Hay ${formatBusinessValue(value, 'count')} clientes en la poblacion actual de Customer Intelligence. La referencia es el snapshot ${provenance.featureSnapshot.snapshotId}.`;
  }
  if ((execution.plan.dimensions?.length ?? 0) === 0) {
    const metricValue = scalarValue(execution.result.rows[0], metric.alias);
    if (metricValue === null || typeof metricValue === 'boolean') return null;
    const value = formatBusinessValue(metricValue, businessMetric.format);
    return `El valor observado de ${businessMetric.label.toLowerCase()} es ${value}. La referencia es el snapshot ${provenance.featureSnapshot.snapshotId}.`;
  }
  const dimension = primaryDeterministicDimension(execution.plan);
  if (!dimension || execution.result.rows.length === 0) return null;
  const entityType = dimensionEntityType(dimension);
  const row = execution.result.rows[0];
  const dimensionValue = scalarValue(row, resultColumnName(dimension));
  const metricValue = scalarValue(row, metric.alias);
  if (dimensionValue === null || typeof dimensionValue === 'boolean' || metricValue === null || typeof metricValue === 'boolean') return null;
  const entity = businessEntityLabel(entityType, dimensionValue);
  const value = formatBusinessValue(metricValue, businessMetric.format);
  if (metric.aggregation === 'count') {
    if (!isSimpleTopMetricRankingPlan(execution.plan) && execution.result.rows.length > 1) {
      const dimensionName = resultColumnName(dimension);
      const items = execution.result.rows.slice(0, ANALYTICAL_EVIDENCE_MAX_DISTRIBUTION_ROWS).map((entry) => {
        const entryDimensionValue = scalarValue(entry, dimensionName);
        const entryMetricValue = scalarValue(entry, metric.alias);
        const entryEntityId = entryDimensionValue === null || typeof entryDimensionValue === 'boolean' ? null : entryDimensionValue;
        return `- ${businessEntityLabel(entityType, entryEntityId)}: ${formatBusinessValue(entryMetricValue, 'count')} clientes.`;
      });
      const noun = entityType === 'rfm_segment' ? 'segmento' : 'cluster';
      return `Distribucion de clientes por ${noun}:\n${items.join('\n')}\nLa referencia es el snapshot ${provenance.featureSnapshot.snapshotId}.`;
    }
    return `${entity} tiene la mayor cantidad de clientes: ${value}. La referencia es el snapshot ${provenance.featureSnapshot.snapshotId}.`;
  }
  return `${entity} presenta el mayor ${businessMetric.label.toLowerCase()}: ${value}. La referencia es el snapshot ${provenance.featureSnapshot.snapshotId}.`;
}

function dimensionEntityType(dimension: string): 'cluster' | 'rfm_segment' | null {
  if (dimension === 'cluster.clusterId' || dimension === 'cluster.label') return 'cluster';
  if (dimension === 'rfm.segmentCode') return 'rfm_segment';
  return null;
}

function shouldUseDeterministicAnswer(
  executions: readonly { readonly plan: AnalyticalQueryPlan; readonly result: AnalyticalQueryResult }[],
): boolean {
  return deterministicRendererEligibility(executions).eligible;
}

function isSimpleTopMetricRankingPlan(plan: AnalyticalQueryPlan): boolean {
  const metric = primaryDeterministicMetric(plan);
  const order = plan.orderBy?.[0];
  if (!metric || !order || order.field !== metric.alias) return false;
  if (metric.aggregation === 'min') return order.direction === 'asc';
  return order.direction === 'desc';
}

function resultSupportsDeterministicAnswer(execution: { readonly plan: AnalyticalQueryPlan; readonly result: AnalyticalQueryResult }): boolean {
  const metric = primaryDeterministicMetric(execution.plan);
  if (!metric) return false;
  if (!execution.result.columns.some((column) => column.name === metric.alias)) return false;
  const dimension = primaryDeterministicDimension(execution.plan);
  if (dimension && !execution.result.columns.some((column) => column.name === resultColumnName(dimension))) return false;
  if ((execution.plan.dimensions?.length ?? 0) === 0) return execution.result.rows.length === 1;
  if (!isSimpleTopMetricRankingPlan(execution.plan)) return execution.result.rows.length > 0;
  if (execution.result.rows.length === 1) return scalarValue(execution.result.rows[0], metric.alias) !== null;
  const first = numericComparableValue(scalarValue(execution.result.rows[0], metric.alias));
  const second = numericComparableValue(scalarValue(execution.result.rows[1], metric.alias));
  if (first === null || second === null) return true;
  return first !== second;
}

function deterministicResultRejectionReason(
  execution: { readonly plan: AnalyticalQueryPlan; readonly result: AnalyticalQueryResult },
  metric: NonNullable<AnalyticalQueryPlan['metrics']>[number],
): DeterministicRendererReason | null {
  if (!execution.result.columns.some((column) => column.name === metric.alias)) return 'unexpected_result_shape';
  const dimension = primaryDeterministicDimension(execution.plan);
  if (dimension && !execution.result.columns.some((column) => column.name === resultColumnName(dimension))) return 'unexpected_result_shape';
  if ((execution.plan.dimensions?.length ?? 0) === 0) return execution.result.rows.length === 1 ? null : 'unexpected_result_shape';
  if (execution.result.rows.length === 0) return 'unexpected_result_shape';
  if (!isSimpleTopMetricRankingPlan(execution.plan)) return null;
  if (execution.result.rows.length === 1) return scalarValue(execution.result.rows[0], metric.alias) !== null ? null : 'unexpected_result_shape';
  const first = numericComparableValue(scalarValue(execution.result.rows[0], metric.alias));
  const second = numericComparableValue(scalarValue(execution.result.rows[1], metric.alias));
  return first !== null && second !== null && first === second ? 'tie_detected' : null;
}

function primaryDeterministicMetric(plan: AnalyticalQueryPlan): NonNullable<AnalyticalQueryPlan['metrics']>[number] | null {
  const metrics = plan.metrics ?? [];
  if (metrics.length === 1) return metrics[0] ?? null;
  const orderedMetricAliases = new Set((plan.orderBy ?? []).map((order) => order.field));
  const orderedMetrics = metrics.filter((metric) => orderedMetricAliases.has(metric.alias));
  return orderedMetrics.length === 1 ? orderedMetrics[0]! : null;
}

function primaryDeterministicDimension(plan: AnalyticalQueryPlan): string | null {
  const dimensions = plan.dimensions ?? [];
  if (dimensions.includes('cluster.clusterId')) return 'cluster.clusterId';
  if (dimensions.includes('rfm.segmentCode')) return 'rfm.segmentCode';
  if (dimensions.length === 1 && dimensions[0] === 'cluster.label') return 'cluster.label';
  return null;
}

function semanticDimensionCount(plan: AnalyticalQueryPlan): number {
  const dimensions = plan.dimensions ?? [];
  const entityDimensions = [
    dimensions.some((dimension) => dimension === 'cluster.clusterId' || dimension === 'cluster.label'),
    dimensions.includes('rfm.segmentCode'),
  ].filter(Boolean).length;
  if (entityDimensions > 0) return entityDimensions;
  return dimensions.length;
}

function numericComparableValue(value: string | number | boolean | null): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scalarValue(row: AnalyticalQueryResult['rows'][number] | undefined, key: string): string | number | boolean | null {
  return row?.[key] ?? null;
}

function resultColumnName(logicalName: string): string {
  const parts = logicalName.split('.');
  return parts[parts.length - 1] ?? logicalName;
}

function formatEvidenceNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
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
  readonly diagnosticContext?: Partial<Omit<CopilotStageLatencyDiagnostic, 'event' | 'stage' | 'provider' | 'model' | 'durationMs' | 'success' | 'failureStatus' | 'repairAttempted' | 'queryCount' | 'analyticsExecutionDurationMs' | 'totalTurnDurationMs' | 'executionMode'>>;
  readonly outputDiagnosticContext?: (output: T) => Partial<Omit<CopilotStageLatencyDiagnostic, 'event' | 'stage' | 'provider' | 'model' | 'durationMs' | 'success' | 'failureStatus' | 'repairAttempted' | 'queryCount' | 'analyticsExecutionDurationMs' | 'totalTurnDurationMs' | 'executionMode'>>;
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
      ...args.diagnosticContext,
      ...(args.outputDiagnosticContext?.(output) ?? {}),
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
      ...args.diagnosticContext,
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
    readonly diagnosticContext?: Partial<Omit<CopilotStageLatencyDiagnostic, 'event' | 'stage' | 'provider' | 'model' | 'durationMs' | 'success' | 'failureStatus' | 'repairAttempted' | 'queryCount' | 'analyticsExecutionDurationMs' | 'totalTurnDurationMs' | 'executionMode'>>;
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
    ...args.diagnosticContext,
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
  if (/unknown (compact )?field/.test(error)) return 'unknown_field';
  if (/invalid orderBy field/.test(error)) return 'invalid_order_by';
  if (/requires a structured AnalyticalQueryPlan/.test(error)) return 'malformed_query_plan';
  if (/query_plan requires at least one query/.test(error)) return 'missing_queries';
  if (/unsupported planVersion/.test(error)) return 'unsupported_version';
  return 'other_validation_error';
}

function answered(
  executions: readonly { readonly id: string; readonly plan: AnalyticalQueryPlan; readonly result: AnalyticalQueryResult }[],
  answer: string,
  plannerMetadata: CopilotModelMetadata | null,
  answerMetadata: CopilotModelMetadata | null,
  provenance: CustomerIntelligenceSnapshotContext,
  synthesisFallback?: { readonly used: boolean; readonly populationContexts?: readonly CopilotPopulationContext[] },
): CustomerIntelligenceCopilotResponse {
  const populationContexts = synthesisFallback?.populationContexts ?? derivePopulationContexts(executions);
  const finalResponseState = synthesisFallback?.used ? 'degraded_success' : 'success';
  return {
    status: 'answered',
    finalResponseState,
    answer,
    analysis: {
      contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
      analysisPlanVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
      finalResponseState,
      queryCount: executions.length,
      queryPlanHashes: executions.map((execution) => execution.result.queryPlanHash),
      resultRowCount: executions.reduce((sum, execution) => sum + execution.result.rowCount, 0),
      executionDurationMs: executions.reduce((sum, execution) => sum + execution.result.execution.durationMs, 0),
      plannerModel: modelName(plannerMetadata),
      answerModel: modelName(answerMetadata),
      ...(synthesisFallback ? { synthesisFallbackUsed: synthesisFallback.used } : {}),
      ...buildPopulationDiagnostics(populationContexts),
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
    assistantFinalResponseState: response.finalResponseState,
    assistantAnswer,
    ...('analysis' in response && 'synthesisFallbackUsed' in response.analysis ? { synthesisFallbackUsed: response.analysis.synthesisFallbackUsed } : {}),
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
  return { status, finalResponseState: 'success', message, contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION };
}

function orchestratorInvalid(errors: readonly string[]): CustomerIntelligenceCopilotResponse {
  return { status: 'orchestrator_invalid', finalResponseState: 'failure', errors, contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION };
}

function plannerInvalid(errors: readonly string[]): CustomerIntelligenceCopilotResponse {
  return { status: 'planner_invalid', finalResponseState: 'failure', errors, contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION };
}

function answerGenerationFailed(error: unknown): CustomerIntelligenceCopilotResponse {
  const provider = mapProviderError(error);
  if (provider) return provider;
  return {
    status: 'answer_generation_failed',
    finalResponseState: 'failure',
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
      finalResponseState: 'failure',
      message: error instanceof Error ? error.message : category,
      contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
    };
  }
  return null;
}

function mapContextFailure(reason: string): AnalyticsUnavailableResponse {
  return { status: 'analytics_unavailable', finalResponseState: 'failure', message: reason, contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION };
}

function mapAnalyticsError(error: unknown): AnalyticsFailureResponse {
  if (error instanceof AnalyticsTimeoutError) return { status: 'analytics_timeout', finalResponseState: 'failure', message: error.message, contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION };
  if (error instanceof AnalyticsUnavailableError || error instanceof AnalyticsSchemaIncompatibleError) return { status: 'analytics_unavailable', finalResponseState: 'failure', message: error.message, contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION };
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
      assistantFinalResponseState: 'success' as const,
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
