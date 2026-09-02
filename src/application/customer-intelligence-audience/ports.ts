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
