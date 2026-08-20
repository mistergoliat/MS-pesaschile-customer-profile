export const CUSTOMER_ANALYTICS_CONTRACT_VERSION = 'customer-analytics-runtime-v1';

// One product line's raw aggregate, pre-derivation — carried in the source row so
// sourceDatasetChecksum reflects the actual PrestaShop extraction (task Section 27/28), not
// values already run through HHI/share math.
export type CustomerFeatureProductAggregate = {
  readonly productId: number;
  readonly productOrderCount: number;
  readonly totalQuantity: number;
  // Decimal string (behavior-decimal SCALE=6 convention) — never a JS float, to keep SUM/HHI
  // math exact across many rows (task Section 22).
  readonly totalSpentTaxIncl: string;
};

// Raw, pre-derivation extraction for one customer — exactly the aggregates read from
// PrestaShop, nothing computed from them yet. This is what sourceDatasetChecksum hashes
// (task Section 28): if PrestaShop's underlying rows change retroactively, this shape
// changes and the checksum changes, independent of whether the derivation formulas
// themselves changed.
export type CustomerFeatureSourceRow = {
  readonly prestashopCustomerId: number;
  readonly validOrders: number;
  readonly firstOrderAt: string;
  readonly lastOrderAt: string;
  readonly orders365d: number;
  readonly totalSpentTaxIncl: string;
  readonly totalDiscountsTaxIncl: string;
  readonly totalShippingTaxIncl: string;
  readonly totalOrdersAllStates: number;
  readonly cancelledOrders: number;
  readonly customerCreatedAt: string;
  readonly products: readonly CustomerFeatureProductAggregate[];
};

// The derived, materialized row — INPUT/DERIVED commercial features only, never RFM
// scores/segments or cluster ids (task Section 11). Columns, not JSON (task Section 23) so
// every field is directly SQL-queryable (WHERE/GROUP BY/AVG/ORDER BY).
export type CustomerFeatureRow = {
  readonly prestashopCustomerId: number;
  readonly validOrders: number;
  readonly totalSpentTaxIncl: string;
  readonly averageOrderValueTaxIncl: string;
  readonly firstOrderAt: string;
  readonly lastOrderAt: string;
  readonly daysSinceLastOrder: number;
  readonly customerTenureDays: number;
  readonly distinctProducts: number;
  readonly repeatProductRate: string;
  readonly top1Share: string;
  readonly top3Share: string;
  readonly effectiveDiversity: string;
  readonly averageUnitsPerOrder: string;
  // NULL when validOrders < 2 — a single-order customer has no purchase interval to measure.
  // Never a synthetic 0 (task Section 13), matching the existing
  // commercial-summary-calculations.ts precedent.
  readonly purchaseFrequencyDays: string | null;
  readonly orders365d: number;
  readonly cancelledOrderRatio: string;
  readonly discountShare: string;
  readonly shippingShare: string;
};

export type CustomerFeatureSnapshotManifest = {
  readonly snapshotKey: string;
  readonly featureVersion: string;
  readonly populationPolicyVersion: string;
  readonly operationalExclusionPolicyVersion: string;
  readonly shopScope: string;
  readonly referenceTime: string;
  readonly populationSize: number;
  readonly sourceDatasetChecksum: string;
  readonly featureDatasetChecksum: string;
  readonly generatedAt: string;
};

export type CurrentCustomerFeatureSnapshotMetadata = {
  readonly snapshotId: string;
  readonly featureVersion: string;
  readonly populationPolicyVersion: string;
  readonly referenceTime: Date;
  readonly publishedAt: Date;
  readonly populationSize: number;
  readonly sourceDatasetChecksum: string;
  readonly featureDatasetChecksum: string;
};
