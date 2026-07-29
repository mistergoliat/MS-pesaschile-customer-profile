// Shared shapes for the CP-R1-T07A commercial-summary audit tool. No runtime logic here
// — lets lib/*.ts modules be typed and unit tested without importing the DB-connecting
// entrypoint (audit-commercial-summary.ts). Mirrors the split already used by
// scripts/audits/order-state-semantics/lib/types.ts.

export type PrefixDiscoveryResult = {
  readonly prefix: string | null;
  readonly candidates: readonly string[];
  readonly found: Readonly<Record<string, string>>;
  readonly missing: readonly string[];
  readonly ambiguous: boolean;
};

export type VariantTableDiscoveryResult = {
  readonly tableName: string | null;
  readonly candidatesChecked: readonly string[];
};

// One row of the valid x current_state aggregate matrix (CP-R1-T07A section 4). Every
// field here is already an aggregate — no individual order id, reference or customer id.
export type ValidityMatrixRow = {
  readonly valid: boolean;
  readonly currentStateId: number | null;
  readonly stateName: string | null;
  readonly paid: boolean | null;
  readonly logable: boolean | null;
  readonly orderCount: number;
  readonly sumTotalPaidTaxIncl: string;
  readonly sumTotalProductsWt: string;
  readonly firstSeenAt: string | null;
  readonly lastSeenAt: string | null;
};

export type ValiditySummary = {
  readonly totalOrders: number;
  readonly validOrderCount: number;
  readonly invalidOrderCount: number;
  readonly stateIdsWithValid1: readonly number[];
  readonly stateIdsWithValid0: readonly number[];
  // A state id appearing in both lists — the same current_state observed under both
  // valid=1 and valid=0 — is the concrete signal that `valid` alone may not cleanly
  // separate commercial purchases from failed attempts. See section 4.
  readonly stateIdsWithBothValidities: readonly number[];
  // null means: the configured cancelled/refunded state id was not observed in the data
  // at all (0 orders), not "false" — those are different facts.
  readonly cancelledStateHasValidOrders: boolean | null;
  readonly refundedStateHasValidOrders: boolean | null;
  readonly cleanSplit: boolean;
};

export type CurrencyRow = {
  readonly idCurrency: number;
  readonly isoCode: string | null;
  readonly orderCount: number;
};

export type CurrencyDetectionResult = {
  readonly isSingleCurrency: boolean;
  readonly dominantCurrencyId: number | null;
  readonly dominantIsoCode: string | null;
  readonly currencies: readonly CurrencyRow[];
};

export type ContractFieldDoc = {
  readonly field: string;
  readonly type: string;
  readonly source: string;
  readonly filter: string;
  readonly formula: string;
  readonly nullability: string;
  readonly precision: string;
  readonly limitations: string;
};

export type OrderCountBuckets = {
  readonly one: number;
  readonly twoToThree: number;
  readonly fourToTen: number;
  readonly moreThanTen: number;
};

export type RecencyBuckets = {
  readonly inactive30Days: number;
  readonly inactive90Days: number;
  readonly inactive180Days: number;
  readonly inactive365Days: number;
};
