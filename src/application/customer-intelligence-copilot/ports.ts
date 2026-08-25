import type { AnalyticalQueryPlan, AnalyticalQueryResult, AnalyticalSchema } from '../../domain/customer-intelligence-query/index.js';
import type { CustomerIntelligenceSnapshotContext } from '../../domain/customer-intelligence/index.js';
import type {
  CompactAnalyticalSchema,
  CompactAnalyticalQueryContract,
  CopilotAnalysisPlan,
  CopilotConversationDecisionActionConstraints,
  CopilotConversationDecision,
  CopilotSessionContext,
} from '../../domain/customer-intelligence-copilot/index.js';

export type CopilotModelMetadata = {
  readonly provider: string;
  readonly model: string;
  readonly promptCharCount?: number;
  readonly responseCharCount?: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
};

export type GenerateAnalysisPlanInput = {
  readonly question: string;
  readonly schema: CompactAnalyticalSchema;
  readonly queryContract: CompactAnalyticalQueryContract;
  readonly plannerPromptVersion: string;
  readonly maxQueries: number;
  readonly sessionContext?: CopilotSessionContext;
};

export type RepairAnalysisPlanInput = GenerateAnalysisPlanInput & {
  readonly previousPlan: unknown;
  readonly validationErrors: readonly string[];
};

export type GenerateAnalysisPlanOutput = {
  readonly plan: unknown;
  readonly metadata: CopilotModelMetadata | null;
};

export type GenerateConversationDecisionInput = {
  readonly question: string;
  readonly orchestratorPromptVersion: string;
  readonly sessionContext: CopilotSessionContext;
  readonly actionConstraints: CopilotConversationDecisionActionConstraints;
};

export type RepairConversationDecisionInput = GenerateConversationDecisionInput & {
  readonly previousDecision: unknown;
  readonly validationErrors: readonly string[];
};

export type GenerateConversationDecisionOutput = {
  readonly decision: unknown;
  readonly metadata: CopilotModelMetadata | null;
};

export type GenerateAnswerInput = {
  readonly question: string;
  readonly answerPromptVersion: string;
  readonly context: CustomerIntelligenceSnapshotContext;
  readonly sessionContext?: CopilotSessionContext;
  readonly executions: readonly {
    readonly id: string;
    readonly plan: AnalyticalQueryPlan;
    readonly result: AnalyticalQueryResult;
  }[];
};

export type GenerateAnswerOutput = {
  readonly answer: string;
  readonly metadata: CopilotModelMetadata | null;
};

export type CustomerIntelligenceCopilotModel = {
  generateConversationDecision(input: GenerateConversationDecisionInput): Promise<GenerateConversationDecisionOutput>;
  repairConversationDecision(input: RepairConversationDecisionInput): Promise<GenerateConversationDecisionOutput>;
  generateAnalysisPlan(input: GenerateAnalysisPlanInput): Promise<GenerateAnalysisPlanOutput>;
  repairAnalysisPlan(input: RepairAnalysisPlanInput): Promise<GenerateAnalysisPlanOutput>;
  generateAnswer(input: GenerateAnswerInput): Promise<GenerateAnswerOutput>;
};

export type AnalyticalSchemaProvider = () => AnalyticalSchema;

export type CopilotPlanForExecution = Extract<CopilotAnalysisPlan, { status: 'query_plan' }>;
export type CopilotDecisionForAnalytics = Extract<CopilotConversationDecision, { action: 'run_analytics' }>;
