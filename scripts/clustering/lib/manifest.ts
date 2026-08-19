import { sha256Stable } from '../../../src/domain/customer-rfm/checksum.js';
import { operationalAccountExclusionPolicyVersion } from '../../../src/domain/customer-rfm/operational-account-exclusion-policy.js';
import { RAW_FEATURE_COLUMNS, type RawFeatureRow } from './feature-builder.js';

export const featureVersion = 'cluster-features-v1';
export const populationPolicyVersion = 'cp-r2-clustering-population-b-prime-v1';
export const populationScope = 'all_valid_prestashop_shops';
export const checksumVersion = 'clustering-checksum-canonical-json-v1';
export const experimentVersion = 'cp-r2-t01-v1';

export type FeatureDistribution = {
  readonly min: number;
  readonly p01: number;
  readonly p05: number;
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly mean: number;
  readonly nullCount: number;
  readonly zeroCount: number;
};

export function describeFeatureDistribution(values: readonly number[]): FeatureDistribution {
  const finite = values.filter((value) => Number.isFinite(value));
  const sorted = [...finite].sort((a, b) => a - b);
  const zeroCount = finite.filter((value) => value === 0).length;
  return {
    min: percentile(sorted, 0),
    p01: percentile(sorted, 0.01),
    p05: percentile(sorted, 0.05),
    p25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: percentile(sorted, 1),
    mean: sorted.length === 0 ? 0 : sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    nullCount: values.length - finite.length,
    zeroCount,
  };
}

function percentile(sortedAscending: readonly number[], fraction: number): number {
  if (sortedAscending.length === 0) return 0;
  const index = Math.min(sortedAscending.length - 1, Math.max(0, Math.ceil(fraction * sortedAscending.length) - 1));
  return sortedAscending[index]!;
}

export type DatasetManifest = {
  readonly experimentVersion: string;
  readonly featureVersion: string;
  readonly populationPolicyVersion: string;
  readonly populationScope: string;
  readonly operationalAccountExclusionPolicyVersion: string;
  readonly checksumVersion: string;
  readonly referenceTime: string;
  readonly window365dStartInclusive: string;
  readonly window365dEndExclusive: string;
  readonly generatedAt: string;
  readonly populationSize: number;
  readonly featureNames: readonly string[];
  readonly featureDistributions: Record<string, FeatureDistribution>;
  readonly datasetChecksum: string;
  readonly extractionDurationMs: number;
  readonly notes: readonly string[];
};

export function buildDatasetManifest(input: {
  readonly referenceTime: string;
  readonly window365dStartInclusive: string;
  readonly window365dEndExclusive: string;
  readonly generatedAt: string;
  readonly rows: readonly RawFeatureRow[];
  readonly extractionDurationMs: number;
}): DatasetManifest {
  const sortedRows = [...input.rows].sort((a, b) => a.customerId - b.customerId);
  const featureNames = RAW_FEATURE_COLUMNS.filter((column) => column !== 'customerId');

  const featureDistributions: Record<string, FeatureDistribution> = {};
  for (const column of featureNames) {
    featureDistributions[column] = describeFeatureDistribution(sortedRows.map((row) => row[column] as number));
  }

  const datasetChecksum = sha256Stable({
    featureVersion,
    populationPolicyVersion,
    populationScope,
    operationalAccountExclusionPolicyVersion,
    checksumVersion,
    referenceTime: input.referenceTime,
    columns: RAW_FEATURE_COLUMNS,
    rows: sortedRows,
  });

  return {
    experimentVersion,
    featureVersion,
    populationPolicyVersion,
    populationScope,
    operationalAccountExclusionPolicyVersion,
    checksumVersion,
    referenceTime: input.referenceTime,
    window365dStartInclusive: input.window365dStartInclusive,
    window365dEndExclusive: input.window365dEndExclusive,
    generatedAt: input.generatedAt,
    populationSize: sortedRows.length,
    featureNames,
    featureDistributions,
    datasetChecksum,
    extractionDurationMs: input.extractionDurationMs,
    notes: [
      'Population B′: >=2 valid orders lifetime, operational accounts excluded (same policy as RFM).',
      'orders365d window: [referenceTime-365d, referenceTime) — inclusive start, exclusive end, matching RFM date-window.ts.',
      'Shop scope actually used: all_valid_prestashop_shops (all shops pooled) — matches the shipped RFM population reader, NOT the older T10A-3 shop-1-only decision. Flagged, not resolved, per readiness audit Step 5.',
      'rfmCode/segmentCode were never used as training inputs — RFM segments are joined in strictly after clustering, for the cross-tab only.',
      'hhi is intentionally excluded from the trained feature set (kept only in this raw extraction/manifest): effectiveDiversity = 1/hhi is a deterministic bijective transform of hhi, so including both would double-count concentration in Euclidean distance without adding information.',
    ],
  };
}
