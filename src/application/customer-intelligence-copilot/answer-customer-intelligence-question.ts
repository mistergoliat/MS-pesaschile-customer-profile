import {
  CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
  CUSTOMER_INTELLIGENCE_COPILOT_PLAN_REPAIR_ATTEMPTS,
  CUSTOMER_INTELLIGENCE_COPILOT_ANSWER_PROMPT_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_PROMPT_VERSION,
  serializeAnalyticalQueryContractForCopilot,
  serializeAnalyticalSchemaForCopilot,
  validateCopilotAnalysisPlan,
  type CopilotAnalysisPlan,
  type CustomerIntelligenceCopilotResponse,
} from '../../domain/customer-intelligence-copilot/index.js';
import { validateAnalyticalQueryPlan, type AnalyticalQueryPlan } from '../../domain/customer-intelligence-query/index.js';
import type {
  ResolveCurrentCustomerIntelligenceContext,
  ResolveCustomerIntelligenceContextForFeatureSnapshot,
} from '../customer-intelligence/resolve-customer-intelligence-context.js';
import type { ExecuteAnalyticalQueryWithResolvedContext } from '../customer-intelligence-query/index.js';
import { AnalyticsTimeoutError, AnalyticsUnavailableError, AnalyticsSchemaIncompatibleError } from '../customer-profile/errors.js';
import type { AnalyticalSchemaProvider, CustomerIntelligenceCopilotModel, CopilotModelMetadata } from './ports.js';

export type AnswerCustomerIntelligenceQuestionRequest = {
  readonly question: string;
  readonly featureSnapshotId?: string | null;
};

export type AnswerCustomerIntelligenceQuestion = (
  request: AnswerCustomerIntelligenceQuestionRequest,
) => Promise<CustomerIntelligenceCopilotResponse>;

type ValidatedStep = {
  readonly id: string;
  readonly plan: AnalyticalQueryPlan;
};

export function createAnswerCustomerIntelligenceQuestion(deps: {
  readonly getAnalyticalSchema: AnalyticalSchemaProvider;
  readonly resolveCurrent: ResolveCurrentCustomerIntelligenceContext;
  readonly resolveForFeatureSnapshot: ResolveCustomerIntelligenceContextForFeatureSnapshot;
  readonly executeAnalyticalQuery: ExecuteAnalyticalQueryWithResolvedContext;
  readonly model: CustomerIntelligenceCopilotModel;
}): AnswerCustomerIntelligenceQuestion {
  return async (request) => {
    const question = request.question.trim();
    if (question.length === 0) {
      return terminal('clarification_required', 'Necesito una pregunta analitica concreta para consultar Customer Intelligence.');
    }

    const schema = serializeAnalyticalSchemaForCopilot(deps.getAnalyticalSchema());
    const queryContract = serializeAnalyticalQueryContractForCopilot();
    const plannerOutput = await deps.model.generateAnalysisPlan({
      question,
      schema,
      queryContract,
      plannerPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_PROMPT_VERSION,
      maxQueries: CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
    });

    const planning = await validateOrRepairPlan({
      rawPlan: plannerOutput.plan,
      plannerMetadata: plannerOutput.metadata,
      question,
      schema,
      queryContract,
      model: deps.model,
    });
    if (planning.status !== 'query_plan') {
      return planning.response;
    }

    const contextResult = request.featureSnapshotId
      ? await deps.resolveForFeatureSnapshot(request.featureSnapshotId)
      : await deps.resolveCurrent();

    if (contextResult.status !== 'available') {
      return mapContextFailure(contextResult.status === 'degraded' ? contextResult.reason : contextResult.status);
    }

    const executions = [];
    for (const step of planning.steps) {
      try {
        const execution = await deps.executeAnalyticalQuery({
          plan: step.plan,
          context: contextResult.context,
          resolvedIds: contextResult.resolvedIds,
        });
        if (execution.status === 'invalid_plan') {
          return plannerInvalid(execution.errors);
        }
        executions.push({ id: step.id, plan: step.plan, result: execution.result });
      } catch (error) {
        return mapAnalyticsError(error);
      }
    }

    let answerOutput;
    try {
      answerOutput = await deps.model.generateAnswer({
        question,
        answerPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANSWER_PROMPT_VERSION,
        context: contextResult.context,
        executions,
      });
    } catch (error) {
      return {
        status: 'answer_generation_failed',
        message: error instanceof Error ? error.message : 'Answer generation failed',
        contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
      };
    }

    return {
      status: 'answered',
      answer: answerOutput.answer,
      analysis: {
        contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
        analysisPlanVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
        queryCount: executions.length,
        queryPlanHashes: executions.map((execution) => execution.result.queryPlanHash),
        resultRowCount: executions.reduce((sum, execution) => sum + execution.result.rowCount, 0),
        executionDurationMs: executions.reduce((sum, execution) => sum + execution.result.execution.durationMs, 0),
        plannerModel: modelName(planning.plannerMetadata),
        answerModel: modelName(answerOutput.metadata),
      },
      provenance: contextResult.context,
    };
  };
}

async function validateOrRepairPlan(args: {
  readonly rawPlan: unknown;
  readonly plannerMetadata: CopilotModelMetadata | null;
  readonly question: string;
  readonly schema: ReturnType<typeof serializeAnalyticalSchemaForCopilot>;
  readonly queryContract: ReturnType<typeof serializeAnalyticalQueryContractForCopilot>;
  readonly model: CustomerIntelligenceCopilotModel;
}): Promise<
  | { readonly status: 'query_plan'; readonly steps: readonly ValidatedStep[]; readonly plannerMetadata: CopilotModelMetadata | null }
  | { readonly status: 'terminal'; readonly response: CustomerIntelligenceCopilotResponse }
> {
  const first = validatePlanEnvelopeAndQueries(args.rawPlan);
  if (first.ok) {
    if (first.plan.status !== 'query_plan') {
      if (first.plan.status === 'answer_from_context') {
        return { status: 'terminal', response: plannerInvalid(['answer_from_context requires a Copilot session']) };
      }
      return { status: 'terminal', response: terminal(first.plan.status, first.plan.message) };
    }
    return { status: 'query_plan', steps: first.steps, plannerMetadata: args.plannerMetadata };
  }

  let repaired = null as unknown;
  let repairedMetadata = null as CopilotModelMetadata | null;
  for (let attempt = 0; attempt < CUSTOMER_INTELLIGENCE_COPILOT_PLAN_REPAIR_ATTEMPTS; attempt += 1) {
    const repairOutput = await args.model.repairAnalysisPlan({
      question: args.question,
      schema: args.schema,
      queryContract: args.queryContract,
      plannerPromptVersion: CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_PROMPT_VERSION,
      maxQueries: CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
      previousPlan: args.rawPlan,
      validationErrors: first.errors,
    });
    repaired = repairOutput.plan;
    repairedMetadata = repairOutput.metadata;
    const validation = validatePlanEnvelopeAndQueries(repaired);
    if (validation.ok) {
      if (validation.plan.status !== 'query_plan') {
        if (validation.plan.status === 'answer_from_context') {
          return { status: 'terminal', response: plannerInvalid(['answer_from_context requires a Copilot session']) };
        }
        return { status: 'terminal', response: terminal(validation.plan.status, validation.plan.message) };
      }
      return { status: 'query_plan', steps: validation.steps, plannerMetadata: repairedMetadata };
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
    if (!validation.ok) {
      errors.push(...validation.errors.map((error) => `${query.id}: ${error}`));
    } else {
      steps.push({ id: query.id, plan: validation.plan.canonical });
    }
  }
  return errors.length === 0 ? { ok: true, plan: envelope.plan, steps } : { ok: false, errors };
}

function terminal(status: 'clarification_required' | 'unsupported_data' | 'unsupported_operation', message: string): CustomerIntelligenceCopilotResponse {
  return { status, message, contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION };
}

function plannerInvalid(errors: readonly string[]): CustomerIntelligenceCopilotResponse {
  return { status: 'planner_invalid', errors, contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION };
}

function mapContextFailure(reason: string): CustomerIntelligenceCopilotResponse {
  if (reason === 'analytics_not_configured' || reason === 'analytics_unavailable' || reason === 'no_published_feature_snapshot' || reason === 'feature_snapshot_not_found') {
    return {
      status: 'analytics_unavailable',
      message: reason,
      contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
    };
  }
  return {
    status: 'analytics_unavailable',
    message: reason,
    contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
  };
}

function mapAnalyticsError(error: unknown): CustomerIntelligenceCopilotResponse {
  if (error instanceof AnalyticsTimeoutError) {
    return { status: 'analytics_timeout', message: error.message, contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION };
  }
  if (error instanceof AnalyticsUnavailableError || error instanceof AnalyticsSchemaIncompatibleError) {
    return { status: 'analytics_unavailable', message: error.message, contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION };
  }
  throw error;
}

function modelName(metadata: CopilotModelMetadata | null): string | null {
  return metadata ? `${metadata.provider}:${metadata.model}` : null;
}
