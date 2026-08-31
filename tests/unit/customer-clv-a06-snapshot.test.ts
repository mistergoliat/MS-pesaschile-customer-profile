import { describe, expect, it } from 'vitest';
import { sha256Stable } from '../../src/domain/customer-rfm/checksum.js';
import { validateCustomerClvProductionSnapshot, type CustomerClvProductionSnapshotHeader } from '../../src/application/customer-clv/create-customer-clv-snapshot.js';

const rows = [
  { customerId: 10, expectedRevenueTaxIncl: '100.000000', expectedOrders: '1.000000', estimateSupportLevel: 'SUPPORTED' as const },
  { customerId: 20, expectedRevenueTaxIncl: '0.000000', estimateSupportLevel: 'SPARSE' as const },
];

function header(overrides: Partial<CustomerClvProductionSnapshotHeader> = {}): CustomerClvProductionSnapshotHeader {
  const base = {
    snapshotId: null,
    snapshotKey: 'customer-clv-two-stage-cohort-v1__12m__reference',
    status: 'building' as const,
    referenceTime: '2026-08-31T00:00:00.000Z',
    generatedAt: '2026-08-31T00:01:00.000Z',
    horizonMonths: 12 as const,
    modelVersion: 'customer-clv-two-stage-cohort-v1',
    estimatorPolicyVersion: 'two-stage-cohort-a04-3-far-stale-adjustment-recent2-v1',
    activityModelVersion: 'customer-clv-two-stage-cohort-fit-v1',
    activityTrainingWindowPolicy: 'recent_2_eligible_cutoffs',
    activityRecalibrationVersion: 'customer-clv-two-stage-activity-recalibration-stale-parent-v1',
    staleAdjustmentPolicyVersion: 'customer-clv-two-stage-stale-activity-adjustment-v1',
    conditionalValuePolicyVersion: 'value-cohort-order_depth_recency_revenue365d_refined',
    rankRefinementPolicyVersion: 'customer-clv-two-stage-value-rank-refinement-log1p-revenue365d-v1',
    estimateSupportPolicyVersion: 'customer-clv-estimate-support-v1',
    trainingTimePolicyVersion: 'customer-clv-training-label-window-known-by-eval-cutoff-v1',
    datasetVersion: 'customer-clv-backtest-dataset-v1',
    populationPolicyVersion: 'customer-clv-population-valid-order-ge1-operational-excluded-v1',
    monetaryPolicyVersion: 'customer-clv-future-valid-order-tax-incl-clp-revenue-v1',
    identityAuthority: 'prestashop_customer' as const,
    currencyIsoCode: 'CLP' as const,
    populationSize: rows.length,
    sourceAvailableDataThrough: '2026-08-31T00:00:00.000Z',
    modelChecksum: 'a'.repeat(64),
    inputChecksum: 'b'.repeat(64),
    outputChecksum: '',
    acceptedValidationDecision: 'CLV_MODEL_V1_ACCEPTED_WITH_DOCUMENTED_DEBT',
    acceptedValidationArtifactVersion: 'customer-clv-a05-acceptance-validation-v1',
    acceptedValidationArtifactChecksum: 'c'.repeat(64),
    datasetChecksum: 'b'.repeat(64),
    trainingMetadata: {
      trainingCutoffs: [],
      effectiveStageATrainingCutoffs: [],
      effectiveStageBTrainingCutoffs: [],
      trainingDatasetChecksums: [],
      trainingRowCount: 0,
      temporalStatePolicyVersion: 'customer-clv-current-valid-observed-with-documented-drift-v1',
    },
  } satisfies CustomerClvProductionSnapshotHeader;
  const outputChecksum = sha256Stable({ snapshotKey: base.snapshotKey, referenceTime: base.referenceTime, rows });
  return { ...base, outputChecksum, ...overrides };
}

describe('CLV A06 snapshot validation', () => {
  it('accepts decimal rows and reports SPARSE/SUPPORTED counts', () => {
    const result = validateCustomerClvProductionSnapshot({ header: header(), rows });
    expect(result.populationSize).toBe(2);
    expect(result.supportCounts).toEqual({ SPARSE: 1, SUPPORTED: 1 });
  });

  it('rejects duplicate customers and invalid support values', () => {
    expect(() => validateCustomerClvProductionSnapshot({ header: header({ populationSize: 2 }), rows: [rows[0]!, rows[0]!] })).toThrow(/Duplicate/);
    expect(() => validateCustomerClvProductionSnapshot({ header: header(), rows: [{ ...rows[0]!, estimateSupportLevel: 'HIGH' as never }, rows[1]!] })).toThrow(/estimateSupportLevel/);
  });

  it('rejects output checksum changes before publication', () => {
    expect(() => validateCustomerClvProductionSnapshot({ header: header({ outputChecksum: 'd'.repeat(64) }), rows })).toThrow(/checksum/);
  });
});
