import type { StoredCustomerFeatureSnapshot } from '../customer-analytics/ports.js';
import type {
  AudienceAffinitySnapshotLineageV1, AudienceAvailabilityV1, AudienceEvaluationContextV1,
  AudienceEvaluationResultV1, AudienceFilterV1, AudienceRfmSnapshotLineageV1,
  AudienceClusterSnapshotLineageV1, AudienceClvSnapshotLineageV1, AudienceTruthV1,
} from '../../domain/customer-intelligence-audience/index.js';

export type AudienceRfmSnapshotHeader = AudienceRfmSnapshotLineageV1;
export type AudienceClusterSnapshotHeader = AudienceClusterSnapshotLineageV1;
export type AudienceClvSnapshotHeader = AudienceClvSnapshotLineageV1;
export type AudienceAffinitySnapshotHeader = AudienceAffinitySnapshotLineageV1;

export type AudienceSnapshotHeaderReader = {
  getPublishedRfmSnapshotHeaders(): Promise<readonly AudienceRfmSnapshotHeader[]>;
  getPublishedClusterSnapshotHeaders(): Promise<readonly AudienceClusterSnapshotHeader[]>;
  getPublishedClvSnapshotHeaders(): Promise<readonly AudienceClvSnapshotHeader[]>;
  getPublishedAffinitySnapshotHeaders(): Promise<readonly AudienceAffinitySnapshotHeader[]>;
};

export type AudienceContextResolution = {
  readonly status: 'available';
  readonly context: AudienceEvaluationContextV1;
  readonly availability: AudienceAvailabilityV1;
} | {
  readonly status: 'unavailable';
  readonly reason: 'FEATURE_SNAPSHOT_NOT_FOUND' | 'ANALYTICS_UNAVAILABLE';
  readonly context: null;
  readonly availability: AudienceAvailabilityV1;
};

export type AudienceContextResolver = {
  resolveCurrent(): Promise<AudienceContextResolution>;
  resolveForFeatureSnapshot(snapshotId: string): Promise<AudienceContextResolution>;
};

export type AudienceSqlRow = { readonly customerId: number; readonly truth: AudienceTruthV1 | 1 | 0 | null | string };
export type CompiledAudienceSql = { readonly sql: string; readonly params: readonly unknown[] };
export type AudienceSqlExecutor = { execute(compiled: CompiledAudienceSql): Promise<readonly AudienceSqlRow[]> };

export type AudiencePreviewReadRow = {
  readonly customerId: number;
  readonly validOrders: number;
  readonly totalSpentTaxIncl: string;
  readonly averageOrderValueTaxIncl: string;
  readonly firstOrderAt: string;
  readonly lastOrderAt: string;
  readonly daysSinceLastOrder: number;
  readonly purchaseFrequencyDays: string | null;
  readonly rfm: {
    readonly recencyScore: number;
    readonly frequencyScore: number;
    readonly monetaryScore: number;
    readonly rfmCode: string;
    readonly segmentCode: string | null;
    readonly segmentVersion: string | null;
    readonly recencyDays: number;
    readonly frequencyOrders: number;
    readonly grossOrderValueTaxIncl: string;
  } | null;
  readonly cluster: { readonly clusterId: number; readonly modelVersion: string; readonly label: string | null } | null;
  readonly clv: { readonly expectedRevenueTaxIncl: string; readonly expectedOrders: string | null; readonly estimateSupportLevel: string } | null;
  readonly affinityPopulationMember: boolean;
  readonly affinity?: {
    readonly axis: 'PRODUCT_FAMILY' | 'DISCIPLINE' | 'USE_CONTEXT';
    readonly code: string;
    readonly score: string;
    readonly supportingOrderCount: number;
    readonly supportingProductCount: number;
    readonly supportingSpend: string;
    readonly lastEvidenceAt: string;
    readonly explicitEvidenceCoverage: string | null;
  };
};

export type AudiencePreviewReader = {
  /** One bounded, set-based read for all requested members, using the supplied lineage. */
  read(context: AudienceEvaluationContextV1, customerIds: readonly number[]): Promise<readonly AudiencePreviewReadRow[]>;
};

export type EvaluateAudienceRequest = {
  readonly definition: unknown;
  readonly featureSnapshotId?: string;
  readonly previewLimit?: number;
  readonly evaluationId?: string | null;
  readonly evaluatedAt?: string;
};
export type EvaluateAudience = (request: EvaluateAudienceRequest) => Promise<AudienceEvaluationResultV1>;

export type AudienceSqlCompilerOptions = {
  readonly context: AudienceEvaluationContextV1;
  readonly filter: AudienceFilterV1;
};

export type AudienceFeatureSnapshot = StoredCustomerFeatureSnapshot;
