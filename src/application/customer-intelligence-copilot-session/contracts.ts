import type {
  CopilotAnalyticalReference,
  CopilotFinalResponseState,
  CopilotSessionContext,
  CopilotUiContextRequest,
  CopilotUiContextSelectedPopulation,
  CustomerIntelligenceCopilotResponse,
} from '../../domain/customer-intelligence-copilot/index.js';
import type { AnalyticalFilterInput, AnalyticalQueryPlan, AnalyticalQueryResult } from '../../domain/customer-intelligence-query/index.js';
import type { CustomerIntelligenceSnapshotContext } from '../../domain/customer-intelligence/index.js';
import type { ResolvedCustomerIntelligenceSnapshotIds } from '../customer-intelligence/ports.js';

export type CopilotSessionLimits = {
  readonly ttlMinutes: number;
  readonly maxActiveSessions: number;
  readonly maxTurns: number;
  readonly contextRecentTurns: number;
  readonly maxStoredResults: number;
  readonly maxResultRowsRetained: number;
  readonly maxQuestionChars: number;
  readonly maxAnswerChars: number;
  readonly exportMaxRows: number;
  readonly exportBatchSize: number;
  readonly summaryAfterTurns: number;
};

export type CopilotSessionTurn = {
  readonly turnId: string;
  readonly createdAt: string;
  readonly userQuestion: string;
  readonly assistantStatus: string;
  readonly assistantFinalResponseState: CopilotFinalResponseState;
  readonly assistantAnswer: string | null;
  readonly synthesisFallbackUsed?: boolean;
  readonly queryIds: readonly string[];
  readonly sourceQueryIds: readonly string[];
};

export type CopilotSessionQueryResult = {
  readonly queryId: string;
  readonly turnId: string;
  readonly plan: AnalyticalQueryPlan;
  readonly result: AnalyticalQueryResult;
};

// task MARKETING-R1-T06.4 Section 8: bounded, persisted state for the currently active dashboard
// selection - the compact selectedPopulation projection itself (never redundant result rows or
// chain-of-thought) plus the canonical T03 filter tree needed to compose it into future analytical
// queries (Section 10/11) and the turn/time it was resolved at (Section 8's "turn association").
// rawFilters is execution-only and must never be serialized into a model prompt - only
// selectedPopulation (already label-projected) is model-facing (session-context.ts).
export type CopilotSessionUiContextState = {
  readonly selectedPopulation: CopilotUiContextSelectedPopulation;
  readonly rawFilters: AnalyticalFilterInput | null;
  readonly resolvedAtTurnId: string;
  readonly resolvedAt: string;
};

export type CopilotSession = {
  readonly sessionId: string;
  readonly sessionVersion: 'customer-intelligence-copilot-session-v1';
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly expiresAt: string;
  readonly status?: 'active' | 'archived' | 'deleted';
  readonly title?: string | null;
  readonly summary?: string | null;
  readonly summaryVersion?: string | null;
  readonly pinnedContext: CustomerIntelligenceSnapshotContext;
  readonly resolvedIds: ResolvedCustomerIntelligenceSnapshotIds;
  readonly turns: readonly CopilotSessionTurn[];
  readonly analyticalState: {
    readonly references: readonly CopilotAnalyticalReference[];
    readonly results: readonly CopilotSessionQueryResult[];
  };
  // null until the first turn that carries a valid uiContext (task Section 7/8) - absent from a
  // later turn's request never clears it (a turn with no dashboard selection attached does not
  // erase the previously selected population).
  readonly uiContext: CopilotSessionUiContextState | null;
};

export type CopilotSessionSummary = Pick<CopilotSession, 'sessionId' | 'sessionVersion' | 'createdAt' | 'lastActivityAt' | 'expiresAt' | 'pinnedContext'> & {
  readonly status?: 'active' | 'archived' | 'deleted';
  readonly title?: string | null;
  readonly summary?: string | null;
  readonly turnCount: number;
  readonly resultCount: number;
};

export type CopilotSessionDetail = CopilotSessionSummary & {
  readonly turns: readonly CopilotSessionTurn[];
  readonly analyticalReferences: readonly CopilotAnalyticalReference[];
};

export type CreateCopilotSessionRequest = {
  readonly featureSnapshotId?: string | null;
};

export type CreateCopilotSessionResult =
  | { readonly status: 'created'; readonly session: CopilotSessionSummary }
  | { readonly status: 'analytics_unavailable'; readonly message: string };

export type ListCopilotSessionsResult = {
  readonly status: 'ok';
  readonly sessions: readonly CopilotSessionSummary[];
};

export type GetCopilotSessionResult =
  | { readonly status: 'ok'; readonly session: CopilotSessionDetail }
  | { readonly status: 'session_not_found' | 'session_expired' };

export type ProcessCopilotSessionTurnRequest = {
  readonly sessionId: string;
  readonly question: string;
  // task MARKETING-R1-T06.4 Section 2: optional and backward compatible - omitted entirely,
  // behavior is unchanged from before this task.
  readonly uiContext?: CopilotUiContextRequest;
};

export type CopilotSessionTurnResponse = {
  readonly sessionId: string;
  readonly turnId: string;
  readonly queryIds: readonly string[];
  readonly sourceQueryIds: readonly string[];
} & CustomerIntelligenceCopilotResponse;

export type ProcessCopilotSessionTurnResult =
  | { readonly status: 'ok'; readonly response: CopilotSessionTurnResponse; readonly sessionContext: CopilotSessionContext }
  | { readonly status: 'session_not_found' | 'session_expired' };

export type RefreshCopilotSessionContextResult =
  | { readonly status: 'refreshed'; readonly session: CopilotSessionSummary }
  | { readonly status: 'session_not_found' | 'session_expired' }
  | { readonly status: 'analytics_unavailable'; readonly message: string };

export type ResetCopilotSessionResult =
  | { readonly status: 'reset'; readonly session: CopilotSessionSummary }
  | { readonly status: 'session_not_found' | 'session_expired' };

export type DeleteCopilotSessionResult = { readonly status: 'deleted' | 'session_not_found' | 'session_expired' };

export type ExportCopilotSessionQueryRequest = {
  readonly sessionId: string;
  readonly queryId: string;
  readonly format: 'xlsx';
};

export type ExportCopilotSessionQueryResult =
  | {
      readonly status: 'ok';
      readonly contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      readonly filename: string;
      readonly buffer: Buffer;
      readonly metadata: {
        readonly sessionId: string;
        readonly queryId: string;
        readonly queryPlanHash: string;
        readonly rowCount: number;
        readonly durationMs: number;
        readonly exportComplete: boolean;
      };
    }
  | { readonly status: 'session_not_found' | 'session_expired' | 'query_not_found' | 'invalid_query' | 'analytics_unavailable' | 'analytics_timeout'; readonly message?: string };

export type CopilotSessionStoreGetResult =
  | { readonly status: 'found'; readonly session: CopilotSession }
  | { readonly status: 'session_not_found' | 'session_expired' };

export type CopilotSessionStore = {
  create(session: CopilotSession, now: Date): Promise<void>;
  get(sessionId: string, now: Date): Promise<CopilotSessionStoreGetResult>;
  save(session: CopilotSession, now: Date): Promise<void>;
  delete(sessionId: string, now: Date): Promise<DeleteCopilotSessionResult>;
  list(now: Date, limit: number): Promise<readonly CopilotSession[]>;
  activeCount(now: Date): Promise<number>;
};
