import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCustomerClvSnapshotKey,
  CUSTOMER_CLV_CURRENCY_ISO_CODE,
  CUSTOMER_CLV_HORIZON_MONTHS,
  CUSTOMER_CLV_IDENTITY_AUTHORITY,
  CUSTOMER_CLV_MODEL_VERSION,
  CUSTOMER_CLV_MONETARY_POLICY_VERSION,
  CUSTOMER_CLV_POPULATION_POLICY_VERSION,
  CUSTOMER_CLV_RELIABILITY_BUCKETS,
  type CustomerClvRecord,
  type CustomerClvReliabilityBucket,
  type CustomerClvSnapshotHeader,
  type CustomerClvSnapshotRow,
  type CustomerIntelligenceClv,
  assertValidCustomerClvRecord,
  assertValidCustomerClvSnapshotHeader,
  assertValidCustomerClvSnapshotRow,
} from '../../src/domain/customer-clv/index.js';

const referenceTime = '2026-08-29T00:00:00.000Z';
const generatedAt = '2026-08-29T00:01:00.000Z';

function baseRecord(overrides: Partial<CustomerClvRecord> = {}): CustomerClvRecord {
  return {
    customerId: 123,
    horizonMonths: CUSTOMER_CLV_HORIZON_MONTHS,
    expectedRevenueTaxIncl: '125000.000000',
    currencyIsoCode: CUSTOMER_CLV_CURRENCY_ISO_CODE,
    modelVersion: CUSTOMER_CLV_MODEL_VERSION,
    referenceTime,
    populationPolicyVersion: CUSTOMER_CLV_POPULATION_POLICY_VERSION,
    monetaryPolicyVersion: CUSTOMER_CLV_MONETARY_POLICY_VERSION,
    reliabilityBucket: 'MEDIUM',
    ...overrides,
  };
}

function baseHeader(overrides: Partial<CustomerClvSnapshotHeader> = {}): CustomerClvSnapshotHeader {
  const modelVersion = overrides.modelVersion ?? CUSTOMER_CLV_MODEL_VERSION;
  const horizonMonths = overrides.horizonMonths ?? CUSTOMER_CLV_HORIZON_MONTHS;
  const populationPolicyVersion = overrides.populationPolicyVersion ?? CUSTOMER_CLV_POPULATION_POLICY_VERSION;
  const monetaryPolicyVersion = overrides.monetaryPolicyVersion ?? CUSTOMER_CLV_MONETARY_POLICY_VERSION;
  const headerReferenceTime = overrides.referenceTime ?? referenceTime;

  return {
    snapshotId: '42',
    snapshotKey: buildCustomerClvSnapshotKey({
      modelVersion,
      horizonMonths,
      populationPolicyVersion,
      monetaryPolicyVersion,
      referenceTime: headerReferenceTime,
    }),
    status: 'published',
    referenceTime: headerReferenceTime,
    generatedAt,
    horizonMonths,
    modelVersion,
    populationPolicyVersion,
    monetaryPolicyVersion,
    identityAuthority: CUSTOMER_CLV_IDENTITY_AUTHORITY,
    currencyIsoCode: CUSTOMER_CLV_CURRENCY_ISO_CODE,
    populationSize: 10,
    datasetChecksum: 'dataset-checksum',
    outputChecksum: 'output-checksum',
    ...overrides,
  };
}

describe('CustomerClvRecord', () => {
  it('accepts a valid minimal expected-revenue record', () => {
    expect(() => assertValidCustomerClvRecord(baseRecord())).not.toThrow();
  });

  it('accepts omitted expectedOrders', () => {
    const record = baseRecord();

    expect(record.expectedOrders).toBeUndefined();
    expect(() => assertValidCustomerClvRecord(record)).not.toThrow();
  });

  it('accepts expectedOrders when present as a non-negative decimal string', () => {
    expect(() => assertValidCustomerClvRecord(baseRecord({ expectedOrders: '1.250000' }))).not.toThrow();
  });

  it('rejects negative expected revenue', () => {
    expect(() => assertValidCustomerClvRecord(baseRecord({ expectedRevenueTaxIncl: '-1.000000' }))).toThrow(
      /expectedRevenueTaxIncl/,
    );
  });

  it('rejects invalid customerId', () => {
    expect(() => assertValidCustomerClvRecord(baseRecord({ customerId: 0 }))).toThrow(/customerId/);
  });

  it('rejects invalid currency', () => {
    expect(() =>
      assertValidCustomerClvRecord(baseRecord({ currencyIsoCode: 'USD' as typeof CUSTOMER_CLV_CURRENCY_ISO_CODE })),
    ).toThrow(/currencyIsoCode/);
  });

  it('rejects a non-v1 horizon', () => {
    expect(() => assertValidCustomerClvRecord(baseRecord({ horizonMonths: 24 as typeof CUSTOMER_CLV_HORIZON_MONTHS }))).toThrow(
      /horizonMonths/,
    );
  });

  it('rejects empty lineage versions', () => {
    expect(() => assertValidCustomerClvRecord(baseRecord({ modelVersion: '' }))).toThrow(/modelVersion/);
    expect(() => assertValidCustomerClvRecord(baseRecord({ populationPolicyVersion: '' }))).toThrow(
      /populationPolicyVersion/,
    );
    expect(() => assertValidCustomerClvRecord(baseRecord({ monetaryPolicyVersion: '' }))).toThrow(
      /monetaryPolicyVersion/,
    );
  });

  it('rejects a non-ISO referenceTime', () => {
    expect(() => assertValidCustomerClvRecord(baseRecord({ referenceTime: '2026-08-29 00:00:00' }))).toThrow(
      /referenceTime/,
    );
  });

  it('accepts LOW, MEDIUM and HIGH reliability buckets', () => {
    for (const reliabilityBucket of CUSTOMER_CLV_RELIABILITY_BUCKETS) {
      expect(() => assertValidCustomerClvRecord(baseRecord({ reliabilityBucket }))).not.toThrow();
    }
  });

  it('rejects invalid reliability bucket', () => {
    expect(() =>
      assertValidCustomerClvRecord(baseRecord({ reliabilityBucket: 'CONFIDENT' as CustomerClvReliabilityBucket })),
    ).toThrow(/reliabilityBucket/);
  });

  it('does not expose RFM, cluster, affinity or budget fields', () => {
    const keys = new Set(Object.keys(baseRecord()));
    for (const forbidden of [
      'rfmSegment',
      'rfmScore',
      'clusterId',
      'clusterLabel',
      'affinity',
      'allowableSpend',
      'recommendedBudget',
      'campaignCostCeiling',
      'retentionBudget',
      'acquisitionBudget',
      'confidenceInterval',
      'probabilityOfPurchase',
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });
});

describe('CustomerClvSnapshotHeader and row', () => {
  it('uses prestashop_customer as identity authority', () => {
    const header = baseHeader();

    expect(header.identityAuthority).toBe('prestashop_customer');
    expect(() => assertValidCustomerClvSnapshotHeader(header)).not.toThrow();
  });

  it('accepts a snapshot row without expectedOrders', () => {
    const row: CustomerClvSnapshotRow = {
      customerId: 123,
      expectedRevenueTaxIncl: '1000.000000',
      reliabilityBucket: 'LOW',
    };

    expect(() => assertValidCustomerClvSnapshotRow(row)).not.toThrow();
  });

  it('accepts a snapshot row with expectedOrders', () => {
    const row: CustomerClvSnapshotRow = {
      customerId: 123,
      expectedRevenueTaxIncl: '1000.000000',
      expectedOrders: '0.500000',
      reliabilityBucket: 'HIGH',
    };

    expect(() => assertValidCustomerClvSnapshotRow(row)).not.toThrow();
  });

  it('rejects negative expectedOrders', () => {
    expect(() =>
      assertValidCustomerClvSnapshotRow({
        customerId: 123,
        expectedRevenueTaxIncl: '1000.000000',
        expectedOrders: '-0.500000',
        reliabilityBucket: 'HIGH',
      }),
    ).toThrow(/expectedOrders/);
  });

  it('rejects invalid population size and empty checksums', () => {
    expect(() => assertValidCustomerClvSnapshotHeader(baseHeader({ populationSize: -1 }))).toThrow(/populationSize/);
    expect(() => assertValidCustomerClvSnapshotHeader(baseHeader({ datasetChecksum: '' }))).toThrow(/datasetChecksum/);
    expect(() => assertValidCustomerClvSnapshotHeader(baseHeader({ outputChecksum: '' }))).toThrow(/outputChecksum/);
  });

  it('rejects invalid snapshot header lineage and identity values', () => {
    expect(() => assertValidCustomerClvSnapshotHeader(baseHeader({ status: 'draft' as CustomerClvSnapshotHeader['status'] }))).toThrow(
      /snapshot status/,
    );
    expect(() =>
      assertValidCustomerClvSnapshotHeader(
        baseHeader({ identityAuthority: 'master_customer' as typeof CUSTOMER_CLV_IDENTITY_AUTHORITY }),
      ),
    ).toThrow(/identityAuthority/);
    expect(() =>
      assertValidCustomerClvSnapshotHeader(
        baseHeader({ currencyIsoCode: 'USD' as typeof CUSTOMER_CLV_CURRENCY_ISO_CODE }),
      ),
    ).toThrow(/currencyIsoCode/);
  });
});

describe('Customer CLV snapshot key', () => {
  const input = {
    modelVersion: CUSTOMER_CLV_MODEL_VERSION,
    horizonMonths: CUSTOMER_CLV_HORIZON_MONTHS,
    populationPolicyVersion: CUSTOMER_CLV_POPULATION_POLICY_VERSION,
    monetaryPolicyVersion: CUSTOMER_CLV_MONETARY_POLICY_VERSION,
    referenceTime,
  } as const;

  it('is deterministic for the same logical input', () => {
    expect(buildCustomerClvSnapshotKey(input)).toBe(buildCustomerClvSnapshotKey(input));
  });

  it('changes when modelVersion changes', () => {
    expect(buildCustomerClvSnapshotKey({ ...input, modelVersion: 'customer-clv-cohort-v2' })).not.toBe(
      buildCustomerClvSnapshotKey(input),
    );
  });

  it('changes when horizon changes', () => {
    expect(buildCustomerClvSnapshotKey({ ...input, horizonMonths: 24 })).not.toBe(buildCustomerClvSnapshotKey(input));
  });

  it('changes when population policy changes', () => {
    expect(buildCustomerClvSnapshotKey({ ...input, populationPolicyVersion: 'population-v2' })).not.toBe(
      buildCustomerClvSnapshotKey(input),
    );
  });

  it('changes when monetary policy changes', () => {
    expect(buildCustomerClvSnapshotKey({ ...input, monetaryPolicyVersion: 'monetary-v2' })).not.toBe(
      buildCustomerClvSnapshotKey(input),
    );
  });

  it('changes when referenceTime changes', () => {
    expect(buildCustomerClvSnapshotKey({ ...input, referenceTime: '2026-08-30T00:00:00.000Z' })).not.toBe(
      buildCustomerClvSnapshotKey(input),
    );
  });
});

describe('future Customer Intelligence CLV shape', () => {
  it('represents missing CLV as null, not as a zero-valued sentinel record', () => {
    const missing: CustomerIntelligenceClv | null = null;
    const zeroValue: CustomerIntelligenceClv = {
      snapshot: {
        snapshotId: '42',
        referenceTime,
        modelVersion: CUSTOMER_CLV_MODEL_VERSION,
        horizonMonths: CUSTOMER_CLV_HORIZON_MONTHS,
      },
      expectedRevenueTaxIncl: '0.000000',
      currencyIsoCode: CUSTOMER_CLV_CURRENCY_ISO_CODE,
      reliabilityBucket: 'LOW',
    };

    expect(missing).toBeNull();
    expect(zeroValue).not.toBeNull();
    expect(zeroValue.expectedRevenueTaxIncl).toBe('0.000000');
  });
});

describe('customer-clv architecture guard', () => {
  it('does not import RFM scoring, clustering, affinity, catalog-service or product semantics', () => {
    const files = ['contracts.ts', 'snapshot.ts', 'validation.ts', 'index.ts'];
    const forbiddenImportPatterns = [
      /from ['"].*customer-rfm\/(?:scoring|segmentation)/,
      /from ['"].*customer-clustering/,
      /from ['"].*customer-commercial-affinity/,
      /from ['"].*catalog-service/,
      /from ['"].*product-semantic/,
      /from ['"].*commercial-product-ontology/,
    ];

    for (const file of files) {
      const source = readFileSync(join(process.cwd(), 'src', 'domain', 'customer-clv', file), 'utf8');
      for (const pattern of forbiddenImportPatterns) {
        expect(source).not.toMatch(pattern);
      }
    }
  });
});
