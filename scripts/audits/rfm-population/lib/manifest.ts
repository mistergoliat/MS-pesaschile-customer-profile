// CP-R1-T10A-3 (section 15): the rfm-v1-provisional manifest. This is a proposal object —
// it is written to an ignored output file and documented, never persisted as a production
// snapshot or config row. Every governed boundary (population, shops, window, R/F/M
// definitions, limits, tie policy, operational exclusion, version) must appear here so a
// future implementation has one place to read them from, instead of re-deriving them from
// this audit's prose.
export type RecencyMethod = 'tie_safe_percentile_rank_dynamic' | 'frozen_boundaries';
export type MonetaryMethod = 'tie_safe_percentile_rank_dynamic' | 'frozen_boundaries';
export type MasterMigrationGate = 'blocked' | 'ready';

export type RfmModelManifest = {
  readonly modelVersion: 'rfm-v1-provisional';
  readonly identityAuthority: 'prestashop_customer_provisional';
  readonly identityCanonical: false;
  readonly populationPolicyVersion: string;
  readonly operationalAccountPolicyVersion: string;
  readonly frequencyThresholdVersion: string;
  readonly asOfDate: string;
  readonly windowMonths: 12;
  readonly includedShopIds: readonly number[];
  readonly excludedShopIds: readonly number[];
  readonly recencyMethod: RecencyMethod;
  readonly recencyBoundaries: readonly number[] | null;
  readonly frequencyMethod: 'discrete_thresholds';
  readonly frequencyBoundaries: readonly number[];
  readonly monetaryMethod: MonetaryMethod;
  readonly monetaryBoundaries: readonly string[] | null;
  readonly tiePolicy: 'same_value_same_score';
  readonly lifecycleVersion: string;
  readonly masterMigrationGate: MasterMigrationGate;
};

export type RfmModelManifestInput = {
  readonly populationPolicyVersion: string;
  readonly operationalAccountPolicyVersion: string;
  readonly frequencyThresholdVersion: string;
  readonly asOfDate: string;
  readonly includedShopIds: readonly number[];
  readonly excludedShopIds: readonly number[];
  readonly recencyMethod: RecencyMethod;
  readonly recencyBoundaries: readonly number[] | null;
  readonly frequencyBoundaries: readonly number[];
  readonly monetaryMethod: MonetaryMethod;
  readonly monetaryBoundaries: readonly string[] | null;
  readonly lifecycleVersion: string;
  readonly masterMigrationGate: MasterMigrationGate;
};

export function buildRfmModelManifest(input: RfmModelManifestInput): RfmModelManifest {
  return {
    modelVersion: 'rfm-v1-provisional',
    identityAuthority: 'prestashop_customer_provisional',
    identityCanonical: false,
    populationPolicyVersion: input.populationPolicyVersion,
    operationalAccountPolicyVersion: input.operationalAccountPolicyVersion,
    frequencyThresholdVersion: input.frequencyThresholdVersion,
    asOfDate: input.asOfDate,
    windowMonths: 12,
    includedShopIds: input.includedShopIds,
    excludedShopIds: input.excludedShopIds,
    recencyMethod: input.recencyMethod,
    recencyBoundaries: input.recencyBoundaries,
    frequencyMethod: 'discrete_thresholds',
    frequencyBoundaries: input.frequencyBoundaries,
    monetaryMethod: input.monetaryMethod,
    monetaryBoundaries: input.monetaryBoundaries,
    tiePolicy: 'same_value_same_score',
    lifecycleVersion: input.lifecycleVersion,
    masterMigrationGate: input.masterMigrationGate,
  };
}
