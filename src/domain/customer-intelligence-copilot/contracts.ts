import type { AnalyticalQueryPlan, AnalyticalQueryResult, AnalyticalSchema } from '../customer-intelligence-query/index.js';
import type { CustomerIntelligenceSnapshotContext } from '../customer-intelligence/index.js';

export const CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION = 'customer-intelligence-copilot-v1';
export const CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION = 'customer-intelligence-copilot-analysis-plan-v1';
export const CUSTOMER_INTELLIGENCE_COPILOT_SESSION_VERSION = 'customer-intelligence-copilot-session-v1';
export const CUSTOMER_INTELLIGENCE_COPILOT_SESSION_CONTEXT_VERSION = 'customer-intelligence-copilot-session-context-v1';
export const CUSTOMER_INTELLIGENCE_COPILOT_XLSX_EXPORT_VERSION = 'customer-intelligence-xlsx-export-v1';
export const CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION = 'customer-intelligence-conversation-decision-v1';
export const CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION = 'customer-intelligence-conversation-plan-v1';
export const CUSTOMER_INTELLIGENCE_COPILOT_RUN_ANALYTICAL_QUERIES_TOOL = 'run_analytical_queries';
export const CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES = 3;
export const CUSTOMER_INTELLIGENCE_COPILOT_PLAN_REPAIR_ATTEMPTS = 1;
export const CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_REPAIR_ATTEMPTS = 1;
export const CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_REPAIR_ATTEMPTS = 1;

export type CopilotPlanStatus = 'query_plan' | 'answer_from_context' | 'unsupported_data' | 'unsupported_operation' | 'clarification_required';

export type CopilotQueryStep = {
  readonly id: string;
  readonly plan: AnalyticalQueryPlan;
};

export type CopilotAnalysisPlan =
  | {
      readonly planVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION;
      readonly status: 'query_plan';
      readonly queries: readonly CopilotQueryStep[];
    }
  | {
      readonly planVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION;
      readonly status: 'answer_from_context';
      readonly sourceQueryIds: readonly string[];
    }
  | {
      readonly planVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION;
      readonly status: Exclude<CopilotPlanStatus, 'query_plan' | 'answer_from_context'>;
      readonly message: string;
    };

export type CopilotConversationDecisionAction =
  | 'respond_directly'
  | 'clarification_required'
  | 'answer_from_context'
  | 'run_analytics'
  | 'unsupported';

export type CopilotConversationDecisionActionConstraints = {
  readonly decisionVersion: typeof CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION;
  readonly allowedActions: readonly CopilotConversationDecisionAction[];
  readonly availableSourceQueryIds: readonly string[];
  readonly sessionReferenceCount: number;
  readonly sessionResultCount: number;
  readonly answerFromContextAllowed: boolean;
  readonly freshBusinessFactQuestion: boolean;
  readonly rules: readonly string[];
  readonly allowedActionEnvelopes: readonly Record<string, unknown>[];
};

export type CopilotConversationDecision =
  | {
      readonly decisionVersion: typeof CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION;
      readonly action: 'respond_directly';
      readonly message: string;
    }
  | {
      readonly decisionVersion: typeof CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION;
      readonly action: 'clarification_required';
      readonly message: string;
    }
  | {
      readonly decisionVersion: typeof CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION;
      readonly action: 'answer_from_context';
      readonly sourceQueryIds: readonly string[];
      readonly instruction: string;
    }
  | {
      readonly decisionVersion: typeof CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION;
      readonly action: 'run_analytics';
      readonly analyticalQuestion: string;
    }
  | {
      readonly decisionVersion: typeof CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION;
      readonly action: 'unsupported';
      readonly message: string;
    };

export type CopilotConversationPlan =
  | {
      readonly version: typeof CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION;
      readonly action: 'respond_directly';
      readonly message: string;
    }
  | {
      readonly version: typeof CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION;
      readonly action: 'clarification_required';
      readonly message: string;
    }
  | {
      readonly version: typeof CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION;
      readonly action: 'answer_from_context';
      readonly sourceQueryIds: readonly string[];
      readonly instruction: string;
    }
  | {
      readonly version: typeof CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION;
      readonly action: 'run_analytics';
      readonly analyticalQuestion: string;
      readonly analysisPlan: CopilotAnalysisPlan;
    }
  | {
      readonly version: typeof CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION;
      readonly action: 'unsupported';
      readonly message: string;
    };

export type CompactAnalyticalSchema = Pick<AnalyticalSchema, 'schemaVersion' | 'readModelVersion'> & {
  readonly fields: readonly {
    readonly logicalName: string;
    readonly type: string;
    readonly nullable: boolean;
    readonly description: string;
    readonly allowedOperators: readonly string[];
    readonly allowedAggregations: readonly string[];
  }[];
};

export type CompactAnalyticalQueryContract = {
  readonly planVersion: string;
  readonly maxQueries: number;
  readonly modes: {
    readonly row: {
      readonly useFor: readonly string[];
      readonly required: readonly string[];
      readonly forbidden: readonly string[];
      readonly optional: readonly string[];
    };
    readonly aggregate: {
      readonly useFor: readonly string[];
      readonly required: readonly string[];
      readonly forbidden: readonly string[];
      readonly optional: readonly string[];
    };
  };
  readonly metricSchema: {
    readonly required: readonly string[];
    readonly aggregation: {
      readonly allowed: readonly string[];
      readonly count: { readonly field: 'omit_for_count_all' };
      readonly count_distinct: { readonly field: 'required' };
      readonly sum: { readonly field: 'required_numeric' };
      readonly avg: { readonly field: 'required_numeric' };
      readonly min: { readonly field: 'required' };
      readonly max: { readonly field: 'required' };
    };
    readonly alias: {
      readonly required: true;
      readonly pattern: string;
      readonly validExamples: readonly string[];
      readonly invalidExamples: readonly string[];
    };
  };
  readonly filters: {
    readonly shape: string;
    readonly operators: readonly string[];
    readonly maxLeaves: number;
    readonly maxDepth: number;
    readonly maxInValues: number;
  };
  readonly dimensions: {
    readonly max: number;
    readonly fieldsMustBeLogicalNames: true;
    readonly requireMetrics: true;
  };
  readonly orderBy: {
    readonly fieldsMustReference: string;
    readonly directions: readonly ['asc', 'desc'];
  };
  readonly limits: {
    readonly default: number;
    readonly maxRows: number;
  };
  readonly semanticRules: {
    readonly nullableDimensions: readonly {
      readonly field: string;
      readonly nullMeaning: string;
      readonly excludeNullWhen: readonly string[];
      readonly includeNullWhen: readonly string[];
    }[];
    readonly exploratoryAnalysis: {
      readonly maxQueries: number;
      readonly preferredMetricFamilies: readonly string[];
      readonly stateLimitations: true;
    };
    readonly unsupportedConcepts: readonly {
      readonly concept: string;
      readonly reason: string;
      readonly closestSupportedAnalyses: readonly string[];
    }[];
  };
  readonly examples: readonly {
    readonly question: string;
    readonly plan: AnalyticalQueryPlan;
  }[];
};

export type CopilotExecutedQuery = {
  readonly id: string;
  readonly plan: AnalyticalQueryPlan;
  readonly result: AnalyticalQueryResult;
};

export type CopilotAnalyticalReference = {
  readonly name: string;
  readonly sourceQueryId: string;
  readonly filters: readonly {
    readonly field: string;
    readonly operator: string;
    readonly value?: string | number | boolean | null | readonly (string | number)[];
  }[];
};

export type CopilotSemanticFocus = {
  readonly activeEntity: {
    readonly type: 'cluster' | 'rfm_segment' | 'audience' | 'comparison_set';
    readonly id: string | number | null;
    readonly sourceQueryId: string | null;
  } | null;
  readonly activeMetric: {
    readonly name: string;
    readonly field: string | null;
    readonly aggregation: string | null;
    readonly sourceQueryId: string | null;
  } | null;
  readonly activeComparison: {
    readonly entityType: 'cluster' | 'rfm_segment' | 'audience';
    readonly entityIds: readonly (string | number | null)[];
    readonly criterion: string | null;
    readonly sourceQueryId: string | null;
  } | null;
  readonly unresolvedClarification: {
    readonly turnId: string;
    readonly originalQuestion: string;
    readonly assistantMessage: string | null;
  } | null;
  readonly activeFinding?: {
    readonly sourceQueryId: string;
    readonly findingType: 'top_rank' | 'single_value';
    readonly entityType: 'cluster' | 'rfm_segment' | 'audience' | null;
    readonly entityId: string | number | null;
    readonly metric: string | null;
    readonly value: string | number | boolean | null;
  } | null;
  readonly lastAnalyticalResult: {
    readonly queryId: string;
    readonly rowCount: number;
    readonly columns: readonly string[];
    readonly topRowFacts: readonly { readonly field: string; readonly value: string | number | boolean | null }[];
  } | null;
};

export type CopilotSessionContext = {
  readonly contextVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_SESSION_CONTEXT_VERSION;
  readonly pinnedContext: CustomerIntelligenceSnapshotContext;
  readonly conversationSummary?: string | null;
  readonly recentTurns: readonly {
    readonly turnId: string;
    readonly userQuestion: string;
    readonly assistantStatus: string;
    readonly assistantAnswer: string | null;
  }[];
  readonly semanticFocus: CopilotSemanticFocus;
  readonly analyticalReferences: readonly CopilotAnalyticalReference[];
  readonly recentResults: readonly {
    readonly queryId: string;
    readonly queryPlanHash: string;
    readonly columns: readonly { readonly name: string; readonly type: string }[];
    readonly rows: readonly Record<string, unknown>[];
    readonly rowCount: number;
    readonly truncated: boolean;
  }[];
};

export type CustomerIntelligenceCopilotResponse =
  | {
      readonly status: 'answered';
      readonly answer: string;
      readonly analysis: {
        readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION;
        readonly analysisPlanVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION;
        readonly queryCount: number;
        readonly queryPlanHashes: readonly string[];
        readonly resultRowCount: number;
        readonly executionDurationMs: number;
        readonly plannerModel: string | null;
        readonly answerModel: string | null;
      };
      readonly provenance: CustomerIntelligenceSnapshotContext;
    }
  | {
      readonly status: 'answered_from_context';
      readonly answer: string;
      readonly analysis: {
        readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION;
        readonly analysisPlanVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION;
        readonly sourceQueryIds: readonly string[];
        readonly resultRowCount: number;
        readonly plannerModel: string | null;
        readonly answerModel: string | null;
      };
      readonly provenance: CustomerIntelligenceSnapshotContext;
    }
  | {
      readonly status: 'responded_directly';
      readonly answer: string;
      readonly analysis: {
        readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION;
        readonly decisionVersion: typeof CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION;
        readonly decisionAction: 'respond_directly';
        readonly orchestratorModel: string | null;
      };
      readonly provenance: CustomerIntelligenceSnapshotContext;
    }
  | {
      readonly status: 'clarification_required' | 'unsupported_data' | 'unsupported_operation';
      readonly message: string;
      readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION;
    }
  | {
      readonly status: 'planner_invalid';
      readonly errors: readonly string[];
      readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION;
    }
  | {
      readonly status: 'orchestrator_invalid';
      readonly errors: readonly string[];
      readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION;
    }
  | {
      readonly status:
        | 'analytics_unavailable'
        | 'analytics_timeout'
        | 'answer_generation_failed'
        | 'provider_authentication_error'
        | 'provider_billing_error'
        | 'provider_rate_limited'
        | 'provider_timeout'
        | 'provider_network_error'
        | 'provider_invalid_response';
      readonly message: string;
      readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION;
    };

export type CopilotInternalTrace = {
  readonly question: string;
  readonly generatedPlan: unknown;
  readonly repairedPlan: unknown | null;
  readonly validationErrors: readonly string[];
  readonly queryPlanHashes: readonly string[];
  readonly plannerModel: string | null;
  readonly answerModel: string | null;
};
