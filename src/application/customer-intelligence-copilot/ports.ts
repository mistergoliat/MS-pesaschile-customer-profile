import type { AnalyticalQueryPlan, AnalyticalQueryResult, AnalyticalSchema } from '../../domain/customer-intelligence-query/index.js';
import type { CustomerIntelligenceSnapshotContext } from '../../domain/customer-intelligence/index.js';
import type { CompactAnalyticalSchema, CopilotAnalysisPlan, CopilotSessionContext } from '../../domain/customer-intelligence-copilot/index.js';

export type CopilotModelMetadata = {
  readonly provider: string;
  readonly model: string;
};

export type GenerateAnalysisPlanInput = {
  readonly question: string;
  readonly schema: CompactAnalyticalSchema;
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
  generateAnalysisPlan(input: GenerateAnalysisPlanInput): Promise<GenerateAnalysisPlanOutput>;
  repairAnalysisPlan(input: RepairAnalysisPlanInput): Promise<GenerateAnalysisPlanOutput>;
  generateAnswer(input: GenerateAnswerInput): Promise<GenerateAnswerOutput>;
};

export type AnalyticalSchemaProvider = () => AnalyticalSchema;

export type CopilotPlanForExecution = Extract<CopilotAnalysisPlan, { status: 'query_plan' }>;
