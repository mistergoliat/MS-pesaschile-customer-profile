import { describe, expect, it } from 'vitest';
import { summarizeIdentityCoverage } from '../../scripts/audits/rfm-population/lib/identity.js';
import {
  buildSnapshotProposal,
  CUSTOMER_RFM_SNAPSHOT_CONTRACT_FIELDS,
} from '../../scripts/audits/rfm-population/lib/snapshot-proposal.js';

describe('RFM population audit identity and snapshot proposal', () => {
  it('summarizes canonical identity coverage without individual IDs', () => {
    const summary = summarizeIdentityCoverage({
      canonicalLinkedMasters: 80,
      mastersWithoutPrestashopLink: 20,
      prestashopCustomersWithValidOrders: 100,
      prestashopCustomersWithValidOrdersLinkedCanonically: 80,
      validOrders: 1000,
      validOrdersLinkedCanonically: 900,
      validGrossMonetaryTaxIncl: '1000000.000000',
      validGrossMonetaryTaxInclLinkedCanonically: '900000.000000',
      duplicatePrestashopLinks: 1,
      guestOrZeroCustomerOrders: 2,
    });

    expect(summary).toMatchObject({
      canonicalLinkedMasters: 80,
      mastersWithoutPrestashopLink: 20,
      duplicatePrestashopLinks: 1,
      guestOrZeroCustomerOrders: 2,
      coverage: {
        customers: '0.800000',
        orders: '0.900000',
      },
    });
    expect(JSON.stringify(summary)).not.toMatch(/email|rut|firstname|lastname|phone|address/i);
  });

  it('documents the future CustomerRfmSnapshot contract and versioned pipeline', () => {
    expect(CUSTOMER_RFM_SNAPSHOT_CONTRACT_FIELDS).toEqual([
      'masterCustomerId',
      'status',
      'modelVersion',
      'calculatedAt',
      'asOfDate',
      'windowStartInclusive',
      'windowEndExclusive',
      'metrics.recencyDays',
      'metrics.frequencyOrders',
      'metrics.grossMonetaryTaxIncl',
      'scores.recency',
      'scores.frequency',
      'scores.monetary',
      'scores.rfmCode',
      'percentiles.recency',
      'percentiles.frequency',
      'percentiles.monetary',
      'lifecycleStage',
    ]);
    expect(buildSnapshotProposal()).toMatchObject({
      modelVersion: 'rfm-v1',
      recommendedFrequency: 'daily',
      persistPercentiles: true,
      publishNamedSegment: false,
    });
  });
});
