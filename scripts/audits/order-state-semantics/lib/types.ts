// Shared shapes for the CP-R1-T06A order-state-semantics audit tool. This file has no
// runtime logic — it exists so lib/*.ts modules can be typed and unit tested without
// importing the DB-connecting entrypoint (audit-order-state-semantics.ts).

export type GrantAssessment = {
  readonly safe: boolean;
  readonly disallowedPrivileges: readonly string[];
  readonly hasGrantOption: boolean;
};

export type LoadAssessment = {
  readonly safe: boolean;
  readonly threadsRunning: number;
  readonly maxConnections: number;
  readonly ratio: number;
  readonly reason: string | null;
};

export type PrefixDiscoveryResult = {
  readonly prefix: string | null;
  readonly candidates: readonly string[];
  readonly found: Readonly<Record<string, string>>;
  readonly missing: readonly string[];
  readonly ambiguous: boolean;
};

export type OrderDetailDiscoveryResult = {
  readonly tableName: string | null;
  readonly candidatesChecked: readonly string[];
};

// Mirrors ps_order_state's boolean/int columns, coerced to boolean where PrestaShop
// stores a 0/1 tinyint. moduleName is nullable (empty string in PrestaShop means "no
// module owns this state"), normalized to null here.
export type OrderStateFlags = {
  readonly invoice: boolean;
  readonly sendEmail: boolean;
  readonly moduleName: string | null;
  readonly unremovable: boolean;
  readonly hidden: boolean;
  readonly logable: boolean;
  readonly delivery: boolean;
  readonly shipped: boolean;
  readonly paid: boolean;
  readonly pdfInvoice: boolean;
  readonly pdfDelivery: boolean;
  readonly deleted: boolean;
};

export type StateVolumeInput = {
  readonly stateId: number;
  // Localized name — descriptive only. proposeClassification() must never use this as
  // decision evidence, only as a non-authoritative note (see classification.ts).
  readonly name: string | null;
  // null means: no matching row in order_state at all (current_state points at a
  // nonexistent state id) — distinct from a state that exists but has no translation.
  readonly flags: OrderStateFlags | null;
  readonly orderCount: number;
  readonly totalOrders: number;
};

export type ClassificationConfidence = 'high' | 'medium' | 'low';

export type ClassificationCandidate =
  | 'payment_confirmed'
  | 'preparing'
  | 'packed'
  | 'ready_for_dispatch'
  | 'dispatched'
  | 'delivered'
  | 'cancelled'
  | 'refunded'
  | 'exception'
  | 'unknown';

export type ClassificationProposal = {
  readonly stateId: number;
  readonly candidateStage: ClassificationCandidate;
  readonly confidence: ClassificationConfidence;
  // Evidence that actually drove the decision — flags and volume only, never `name`.
  readonly evidence: readonly string[];
  // Non-authoritative observations (e.g. what the name text suggests). Never used as
  // decision input; kept separate so a reader cannot mistake a weak signal for evidence.
  readonly weakSignals: readonly string[];
  readonly manualReviewRequired: boolean;
};
