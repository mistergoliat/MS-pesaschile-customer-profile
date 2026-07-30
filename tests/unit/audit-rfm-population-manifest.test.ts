import { describe, expect, it } from 'vitest';
import { buildRfmModelManifest } from '../../scripts/audits/rfm-population/lib/manifest.js';

describe('CP-R1-T10A-3 rfm-v1-provisional manifest (section 15)', () => {
  it('builds a manifest with every governed field, never canonical, gate blocked in this run', () => {
    const manifest = buildRfmModelManifest({
      populationPolicyVersion: 'commercial-population-v1',
      operationalAccountPolicyVersion: 'operational-account-v1',
      frequencyThresholdVersion: 'rfm-v1-f1',
      asOfDate: '2026-07-29',
      includedShopIds: [1],
      excludedShopIds: [2, 3],
      recencyMethod: 'frozen_boundaries',
      recencyBoundaries: [10, 30, 60, 120],
      frequencyBoundaries: [1, 2, 4, 9],
      monetaryMethod: 'frozen_boundaries',
      monetaryBoundaries: ['10.000000', '20.000000', '30.000000', '40.000000'],
      lifecycleVersion: 'lifecycle-v1',
      masterMigrationGate: 'blocked',
    });

    expect(manifest).toMatchObject({
      modelVersion: 'rfm-v1-provisional',
      identityAuthority: 'prestashop_customer_provisional',
      identityCanonical: false,
      windowMonths: 12,
      includedShopIds: [1],
      excludedShopIds: [2, 3],
      frequencyMethod: 'discrete_thresholds',
      tiePolicy: 'same_value_same_score',
      masterMigrationGate: 'blocked',
    });
    expect(manifest.recencyBoundaries).toEqual([10, 30, 60, 120]);
    expect(manifest.monetaryBoundaries).toEqual(['10.000000', '20.000000', '30.000000', '40.000000']);
  });

  it('supports a null boundaries state for a fully dynamic method', () => {
    const manifest = buildRfmModelManifest({
      populationPolicyVersion: 'commercial-population-v1',
      operationalAccountPolicyVersion: 'operational-account-v1',
      frequencyThresholdVersion: 'rfm-v1-f1',
      asOfDate: '2026-07-29',
      includedShopIds: [1],
      excludedShopIds: [2, 3],
      recencyMethod: 'tie_safe_percentile_rank_dynamic',
      recencyBoundaries: null,
      frequencyBoundaries: [1, 2, 4, 9],
      monetaryMethod: 'tie_safe_percentile_rank_dynamic',
      monetaryBoundaries: null,
      lifecycleVersion: 'lifecycle-v1',
      masterMigrationGate: 'ready',
    });
    expect(manifest.recencyBoundaries).toBeNull();
    expect(manifest.monetaryBoundaries).toBeNull();
    expect(manifest.masterMigrationGate).toBe('ready');
  });
});
