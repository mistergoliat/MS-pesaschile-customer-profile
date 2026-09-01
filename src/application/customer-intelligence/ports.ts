import type { CustomerIntelligenceRow } from '../../domain/customer-intelligence/contracts.js';
import type { SnapshotHeaderCandidate } from '../../domain/customer-intelligence/snapshot-selection.js';
import type { CoverageCounts } from '../../domain/customer-intelligence/coverage.js';
import type { CustomerClvSnapshotRow } from '../../domain/customer-clv/contracts.js';
import type { CustomerClvProductionSnapshotHeader } from '../customer-clv/create-customer-clv-snapshot.js';

export type RfmSnapshotHeader = SnapshotHeaderCandidate & { readonly calculationVersion: string };
export type ClusterSnapshotHeader = SnapshotHeaderCandidate & { readonly modelId: string; readonly modelVersion: string };

// Deliberately new, small, header-only queries (task Section 6/44) — distinct from every
// existing RFM/clustering reader, none of which expose "every published snapshot header" or a
// temporal (at-or-before) filter; both are needed only by this cross-capability composition
// concern and belong to neither RFM nor clustering individually. Never touches
// customer_rfm_snapshot_row/customer_cluster_snapshot_row (the bulk data) — those are read
// only once a specific snapshot id has already been resolved (see CustomerIntelligenceReader
// below).
export type SnapshotHeaderReader = {
  getPublishedRfmSnapshotHeaders(): Promise<readonly RfmSnapshotHeader[]>;
  getPublishedClusterSnapshotHeaders(): Promise<readonly ClusterSnapshotHeader[]>;
};

// Re-exported for convenience — Customer Intelligence resolves the feature-snapshot anchor
// through the exact same port CP-R3-T01 already defined and tests, never a second definition
// (task Section 27).
export type { CustomerFeatureSnapshotReader } from '../customer-analytics/ports.js';

export type ResolvedCustomerIntelligenceSnapshotIds = {
  readonly featureSnapshotId: string;
  readonly featureReferenceTime: string;
  readonly featureVersion: string;
  readonly populationPolicyVersion: string;
  // All five below are null together whenever no compatible snapshot was found — never a
  // partially-populated set (task Section 13).
  readonly rfmSnapshotId: string | null;
  readonly rfmReferenceTime: string | null;
  readonly calculationVersion: string | null;
  readonly clusterSnapshotId: string | null;
  readonly clusterReferenceTime: string | null;
  readonly clusterModelId: string | null;
  readonly clusterModelVersion: string | null;
  // Optional because the pre-A07 port remains usable when CLV is not configured.
  readonly clvSnapshotId?: string | null;
  readonly clvSnapshotKey?: string | null;
  readonly clvReferenceTime?: string | null;
  readonly clvGeneratedAt?: string | null;
  readonly clvModelVersion?: string | null;
  readonly clvEstimatorPolicyVersion?: string | null;
  readonly clvSourceAvailableDataThrough?: string | null;
  readonly clvHorizonMonths?: number | null;
  readonly clvCurrencyIsoCode?: string | null;
};

export type CustomerClvActiveSnapshotReader = {
  getActiveSnapshotMetadata(): Promise<CustomerClvProductionSnapshotHeader | null>;
  getCustomerClv(snapshotId: string, customerId: number): Promise<CustomerClvSnapshotRow | null>;
  getCustomerClvBatch?(snapshotId: string, customerIds: readonly number[]): Promise<readonly CustomerClvSnapshotRow[]>;
};

export type ListCustomerIntelligenceRowsOptions = {
  readonly limit: number;
  // Keyset pagination (task Section 21/36): never OFFSET, which degrades at scale. null on the
  // first page.
  readonly afterCustomerId: number | null;
};

export type ListCustomerIntelligenceRowsResult = {
  readonly rows: readonly CustomerIntelligenceRow[];
  readonly hasMore: boolean;
};

// The single JOIN-backed reader (task Section 40/41): behind this interface today is one SQL
// statement across customer_feature_snapshot_row/customer_rfm_snapshot_row/
// customer_cluster_snapshot_row, justified by all three currently sharing one physical
// MariaDB schema (task Section 42) — but the interface itself says nothing about that; a
// future implementation could compose across genuinely separate databases behind the same
// three methods without any domain/application-layer change.
export type CustomerIntelligenceReader = {
  getRow(ids: ResolvedCustomerIntelligenceSnapshotIds, prestashopCustomerId: number): Promise<CustomerIntelligenceRow | null>;
  listRows(
    ids: ResolvedCustomerIntelligenceSnapshotIds,
    options: ListCustomerIntelligenceRowsOptions,
  ): Promise<ListCustomerIntelligenceRowsResult>;
  getCoverageCounts(ids: ResolvedCustomerIntelligenceSnapshotIds): Promise<CoverageCounts>;
};
