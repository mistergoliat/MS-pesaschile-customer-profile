import type { AnalyticalFilterInput, AnalyticalFilterValue, AnalyticalQueryPlan, AnalyticalQueryResult, AnalyticalSchema, CompactAnalyticalQuery } from '../customer-intelligence-query/index.js';
import type { CustomerIntelligenceSnapshotContext } from '../customer-intelligence/index.js';
import type { IntersectionRequiredDimension } from '../customer-intelligence-intersection/index.js';

export const CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION = 'customer-intelligence-copilot-v1';
export const CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION = 'customer-intelligence-copilot-analysis-plan-v1';
export const CUSTOMER_INTELLIGENCE_COPILOT_SESSION_VERSION = 'customer-intelligence-copilot-session-v1';
export const CUSTOMER_INTELLIGENCE_COPILOT_SESSION_CONTEXT_VERSION = 'customer-intelligence-copilot-session-context-v1';
export const CUSTOMER_INTELLIGENCE_COPILOT_XLSX_EXPORT_VERSION = 'customer-intelligence-xlsx-export-v1';
export const CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION = 'customer-intelligence-conversation-decision-v1';
export const CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION = 'customer-intelligence-conversation-plan-v1';
// task MARKETING-R1-T06.4 Section 2: the envelope around the embedded `intersection` object -
// the `filters` shape inside it is T03's own AnalyticalFilterInput, reused verbatim (never
// re-declared). This is its own version because it is a distinct transport (copilot session
// messages) from T06.3's dashboard intersection HTTP endpoint, even though both carry the same
// underlying filter contract.
export const CUSTOMER_INTELLIGENCE_COPILOT_UI_CONTEXT_VERSION = 'customer-intelligence-copilot-ui-context-v1';
export const CUSTOMER_INTELLIGENCE_COPILOT_RUN_ANALYTICAL_QUERIES_TOOL = 'run_analytical_queries';
export const CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES = 3;
export const CUSTOMER_INTELLIGENCE_COPILOT_PLAN_REPAIR_ATTEMPTS = 1;
export const CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_REPAIR_ATTEMPTS = 1;
export const CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_REPAIR_ATTEMPTS = 1;

export type CopilotFinalResponseState = 'success' | 'degraded_success' | 'failure';

export type CopilotPlanStatus = 'query_plan' | 'answer_from_context' | 'unsupported_data' | 'unsupported_operation' | 'clarification_required';

export type CopilotQueryStep = {
  readonly id: string;
  readonly plan: AnalyticalQueryPlan | CompactAnalyticalQuery;
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
  readonly fields: Readonly<Record<string, {
    readonly f: string;
    readonly t: string;
    readonly n: boolean;
    readonly d: string;
    readonly ops: readonly string[];
    readonly aggs: readonly string[];
  }>>;
};

export type CompactAnalyticalQueryContract = {
  readonly contractVersion: string;
  readonly maxQueries: number;
  readonly queryShape: {
    readonly aggregate: 'dimensions? + metrics';
    readonly row: 'select + filters/orderBy/limit';
    readonly fieldNames: 'use schema.fields keys';
    readonly noSql: true;
  };
  readonly metrics: {
    readonly ops: readonly string[];
    readonly shape: '{ op, field?, alias }';
    readonly count: 'omit field';
    readonly fieldRequiredFor: readonly string[];
    readonly alias: {
      readonly required: true;
      readonly pattern: string;
    };
  };
  readonly filters: {
    readonly shape: '{ field, op, value? } or bounded { and|or: [...] }';
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
    readonly query: CompactAnalyticalQuery;
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

// The deterministic, explicit "what actually answered the prior turn" contract (task
// MARKETING-R1-T05.8.4 Section 2). It is selected structurally from the executed query/result
// shape, never from position (latest/first) or an arbitrary top row - see
// selectPrimaryQueryResult in session-context.ts. `distribution` (task MARKETING-R1-T05.8.5
// Section 1) marks a complete grouped breakdown - it always carries entityId: null, since no
// single group is "active" until a follow-up resolves one.
export type CopilotPrimaryFinding = {
  readonly sourceQueryId: string;
  readonly sourceTurnId: string;
  readonly findingType: 'top_rank' | 'single_value' | 'distribution';
  readonly entityType: 'cluster' | 'rfm_segment' | 'audience' | null;
  readonly entityId: string | number | null;
  readonly metric: string | null;
  readonly value: string | number | boolean | null;
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
  readonly activeFinding?: CopilotPrimaryFinding | null;
  readonly lastAnalyticalResult: {
    readonly queryId: string;
    readonly rowCount: number;
    readonly columns: readonly string[];
    readonly topRowFacts: readonly { readonly field: string; readonly value: string | number | boolean | null }[];
  } | null;
};

export type CopilotSemanticAnchor = {
  readonly entityType: 'cluster' | 'rfm_segment' | 'audience' | 'comparison_set' | null;
  readonly entityId: string | number | null;
  readonly metric: string | null;
  readonly findingType: 'top_rank' | 'single_value' | 'distribution' | null;
  readonly sourceQueryId: string | null;
  readonly sourceTurnId?: string | null;
};

// task MARKETING-R1-T05.8.6 Section 4: a bounded semantic structure, not a mostly-flat
// collection. Every value here is read back from a validated AnalyticalQueryResult - never
// model-generated - and comparisons/distributions are deterministically derived (task Section 6:
// "only derive arithmetic that is deterministic and safe").
export type AnalyticalEvidenceEntityRef = {
  readonly entityType: string | null;
  readonly entityId: string | number | null;
  readonly value: string | number | boolean;
};

export type CopilotPopulationContext = {
  readonly entityType: 'cluster' | 'rfm_segment';
  readonly entityId: string | number | null;
  readonly fullPopulation?: number;
  readonly analyzedPopulation?: number;
  readonly analysisBasis?: string;
  readonly coverageRatio?: number;
};

export type AnalyticalEvidenceBundle = {
  readonly anchor: Pick<CopilotSemanticAnchor, 'entityType' | 'entityId' | 'metric'> | null;
  readonly facts: readonly {
    readonly queryId: string;
    readonly metric: string;
    readonly entityType: string | null;
    readonly entityId: string | number | null;
    readonly value: string | number | boolean | null;
    readonly rank?: number;
    readonly comparison?: 'highest' | 'lowest' | 'observed';
  }[];
  // basis: anchor_vs_peer_range (an active entity vs. its observed peer range), pairwise (exactly
  // two rows, e.g. "compare cluster 3 vs cluster 1"), or top_vs_bottom (a ranked 3+ row result
  // with no active entity - the two extremes only, never O(n^2) pairwise combinations).
  readonly comparisons: readonly {
    readonly queryId: string;
    readonly metric: string;
    readonly basis: 'anchor_vs_peer_range' | 'pairwise' | 'top_vs_bottom';
    readonly left: AnalyticalEvidenceEntityRef;
    readonly right: AnalyticalEvidenceEntityRef;
    readonly absoluteDifference: string | null;
    readonly relativeDifference: string | null;
    readonly peerMin: string | number | null;
    readonly peerMax: string | number | null;
  }[];
  // A grouped breakdown (task MARKETING-R1-T05.8.5 `distribution` finding) kept as its own bounded
  // structure instead of N separate facts, so the fallback/synthesis layer can render it as one
  // coherent breakdown.
  readonly distributions: readonly {
    readonly queryId: string;
    readonly metric: string;
    readonly entityType: string | null;
    readonly rows: readonly { readonly entityId: string | number | null; readonly value: string | number | boolean }[];
  }[];
  readonly populationContexts: readonly CopilotPopulationContext[];
  readonly limitations: readonly string[];
};

// task MARKETING-R1-T06.4 Section 2/3: the request envelope a message can optionally carry.
// `intersection.filters` is T03's own AnalyticalFilterInput shape, reused verbatim - no second,
// UI-specific filter grammar. The model never sees this raw shape; only the validated, projected
// CopilotUiContextSelectedPopulation below ever reaches a prompt (Section 5).
export type CopilotUiContextRequest = {
  readonly intersection: {
    readonly contractVersion?: typeof CUSTOMER_INTELLIGENCE_COPILOT_UI_CONTEXT_VERSION;
    readonly featureSnapshotId?: string;
    readonly filters?: AnalyticalFilterInput;
  };
};

// One filter leaf as projected for the model/UI (task Section 5) - label/businessValue come
// exclusively from business-semantics.ts (Section 14), never a second dictionary here.
export type CopilotUiContextSelectedPopulationFilter = {
  readonly field: string;
  readonly label: string;
  readonly operator: string;
  readonly value?: AnalyticalFilterValue;
  readonly businessValue: string | null;
};

// The bounded, compact semantic projection of a validated uiContext (task Section 5) - the ONLY
// shape that ever reaches a model prompt or gets persisted on the session (task Section 8). Never
// SQL, physical columns, or internal plan/compiler details.
export type CopilotUiContextSelectedPopulation = {
  readonly filters: readonly CopilotUiContextSelectedPopulationFilter[];
  readonly matchingPopulation: number;
  readonly queryPlanHash: string;
  readonly featureSnapshotId: string;
  readonly rfmSnapshotId: string | null;
  readonly clusterSnapshotId: string | null;
  readonly requiredDimensions: readonly IntersectionRequiredDimension[];
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
  // The dashboard-selected population currently in scope (task Section 6: a distinct concept from
  // the conversational semantic anchor above) - optional/null when no uiContext has been resolved
  // this session yet, never a fabricated empty population. Optional (not required) so every
  // pre-T06.4 construction site of this contract stays valid (task Section 2: backward
  // compatibility is mandatory).
  readonly uiContext?: CopilotUiContextSelectedPopulation | null;
};

export type CustomerIntelligenceCopilotResponse =
  | {
      readonly status: 'answered';
      readonly finalResponseState: 'success' | 'degraded_success';
      readonly answer: string;
      readonly analysis: {
        readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION;
        readonly analysisPlanVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION;
        readonly finalResponseState: 'success' | 'degraded_success';
        readonly queryCount: number;
        readonly queryPlanHashes: readonly string[];
        readonly resultRowCount: number;
        readonly executionDurationMs: number;
        readonly plannerModel: string | null;
        readonly answerModel: string | null;
        readonly synthesisFallbackUsed?: boolean;
        readonly populationContextPresent?: boolean;
        readonly fullPopulationCount?: number;
        readonly analyzedPopulationCount?: number;
        readonly analysisPopulationBasis?: string;
        readonly populationContexts?: readonly CopilotPopulationContext[];
      };
      readonly provenance: CustomerIntelligenceSnapshotContext;
    }
  | {
      readonly status: 'answered_from_context';
      readonly finalResponseState: 'success';
      readonly answer: string;
      readonly analysis: {
        readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION;
        readonly analysisPlanVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION;
        readonly finalResponseState: 'success';
        readonly sourceQueryIds: readonly string[];
        readonly resultRowCount: number;
        readonly plannerModel: string | null;
        readonly answerModel: string | null;
        readonly populationContextPresent?: boolean;
        readonly fullPopulationCount?: number;
        readonly analyzedPopulationCount?: number;
        readonly analysisPopulationBasis?: string;
        readonly populationContexts?: readonly CopilotPopulationContext[];
      };
      readonly provenance: CustomerIntelligenceSnapshotContext;
    }
  | {
      readonly status: 'responded_directly';
      readonly finalResponseState: 'success';
      readonly answer: string;
      readonly analysis: {
        readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION;
        readonly decisionVersion: typeof CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION;
        readonly decisionAction: 'respond_directly';
        readonly orchestratorModel: string | null;
        readonly finalResponseState: 'success';
      };
      readonly provenance: CustomerIntelligenceSnapshotContext;
    }
  | {
      readonly status: 'clarification_required' | 'unsupported_data' | 'unsupported_operation';
      readonly finalResponseState: 'success';
      readonly message: string;
      readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION;
    }
  | {
      readonly status: 'planner_invalid';
      readonly finalResponseState: 'failure';
      readonly errors: readonly string[];
      readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION;
    }
  | {
      // task MARKETING-R1-T06.4 Section 18: a stable, deterministic failure - unknown fields,
      // invalid operators/filter shape, a feature snapshot that does not match the session's
      // pinned one, or a required RFM/cluster dimension that is unavailable. Never calls the
      // model (Section 18); never silently drops the bad filters and continues unscoped.
      readonly status: 'invalid_ui_context';
      readonly finalResponseState: 'failure';
      readonly errors: readonly string[];
      readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION;
    }
  | {
      readonly status: 'orchestrator_invalid';
      readonly finalResponseState: 'failure';
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
      readonly finalResponseState: 'failure';
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
