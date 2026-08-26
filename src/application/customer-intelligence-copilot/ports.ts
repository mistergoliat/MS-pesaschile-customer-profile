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
  readonly promptCacheHitTokens?: number;
  readonly promptCacheMissTokens?: number;
  // The provider's raw finish reason (e.g. "stop", "length", "tool_calls"), when the transport
  // exposes one - lets diagnostics distinguish natural completion from output truncation (task
  // MARKETING-R1-T05.8.6 Section 3) without logging any provider payload.
  readonly finishReason?: string | null;
};

export type CopilotConversationalMessage =
  | { readonly role: 'system' | 'user'; readonly content: string }
  | { readonly role: 'assistant'; readonly content?: string | null; readonly toolCalls?: readonly CopilotToolCall[] }
  | { readonly role: 'tool'; readonly content: string; readonly toolCallId: string };

export type CopilotToolDefinition = {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
};

export type CopilotToolChoice = 'auto' | 'none';

export type CopilotToolCall = {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
  readonly argumentsParseError?: string;
};

export type GenerateConversationalTurnInput = {
  readonly messages: readonly CopilotConversationalMessage[];
  readonly tools: readonly CopilotToolDefinition[];
  readonly toolChoice: CopilotToolChoice;
  readonly stage: 'tool_selection' | 'tool_synthesis';
  readonly maxTokens?: number;
};

export type GenerateConversationalTurnOutput = {
  readonly content: string | null;
  readonly toolCalls: readonly CopilotToolCall[];
  readonly metadata: CopilotModelMetadata | null;
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

export type GenerateConversationPlanInput = {
  readonly question: string;
  readonly schema: CompactAnalyticalSchema;
  readonly queryContract: CompactAnalyticalQueryContract;
  readonly unifiedPlannerPromptVersion: string;
  readonly maxQueries: number;
  readonly sessionContext: CopilotSessionContext;
  readonly actionConstraints: CopilotConversationDecisionActionConstraints;
};

export type RepairConversationPlanInput = GenerateConversationPlanInput & {
  readonly previousConversationPlan: unknown;
  readonly validationErrors: readonly string[];
};

export type GenerateConversationPlanOutput = {
  readonly conversationPlan: unknown;
  readonly metadata: CopilotModelMetadata | null;
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
  generateConversationalTurn?(input: GenerateConversationalTurnInput): Promise<GenerateConversationalTurnOutput>;
  generateConversationPlan?(input: GenerateConversationPlanInput): Promise<GenerateConversationPlanOutput>;
  repairConversationPlan?(input: RepairConversationPlanInput): Promise<GenerateConversationPlanOutput>;
  generateConversationDecision(input: GenerateConversationDecisionInput): Promise<GenerateConversationDecisionOutput>;
  repairConversationDecision(input: RepairConversationDecisionInput): Promise<GenerateConversationDecisionOutput>;
  generateAnalysisPlan(input: GenerateAnalysisPlanInput): Promise<GenerateAnalysisPlanOutput>;
  repairAnalysisPlan(input: RepairAnalysisPlanInput): Promise<GenerateAnalysisPlanOutput>;
  generateAnswer(input: GenerateAnswerInput): Promise<GenerateAnswerOutput>;
};

export type AnalyticalSchemaProvider = () => AnalyticalSchema;

export type CopilotPlanForExecution = Extract<CopilotAnalysisPlan, { status: 'query_plan' }>;
export type CopilotDecisionForAnalytics = Extract<CopilotConversationDecision, { action: 'run_analytics' }>;
