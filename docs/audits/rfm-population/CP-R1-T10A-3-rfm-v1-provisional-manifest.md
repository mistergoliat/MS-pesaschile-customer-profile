# CP-R1-T10A-3 rfm-v1-provisional Manifest

## Facts

Output: `rfm-v1-provisional-manifest.json` (`lib/manifest.ts` `buildRfmModelManifest`). This is a **proposal object** — written to an ignored output file and documented here, never persisted as a production snapshot, config table, or runtime contract. Shape:

```ts
type RfmModelManifest = {
  modelVersion: 'rfm-v1-provisional';
  identityAuthority: 'prestashop_customer_provisional';
  identityCanonical: false;
  populationPolicyVersion: string;      // "commercial-population-v1"
  operationalAccountPolicyVersion: string; // "operational-account-v1"
  frequencyThresholdVersion: string;    // "rfm-v1-f1"
  asOfDate: string;
  windowMonths: 12;
  includedShopIds: readonly number[];   // [1]
  excludedShopIds: readonly number[];   // [2, 3]
  recencyMethod: 'frozen_boundaries';
  recencyBoundaries: readonly number[] | null;
  frequencyMethod: 'discrete_thresholds';
  frequencyBoundaries: readonly number[]; // [1, 2, 4, 9]
  monetaryMethod: 'frozen_boundaries';
  monetaryBoundaries: readonly string[] | null;
  tiePolicy: 'same_value_same_score';
  lifecycleVersion: string;             // "lifecycle-v1"
  masterMigrationGate: 'blocked' | 'ready';
};
```

`masterMigrationGate` is `"blocked"` in this run and remains `"blocked"` until `master_customer` is populated and audited under `RFM_IDENTITY_MODE=master_customer` — see `CP-R1-T10A-master-migration-plan.md` (T10A-2) for the acceptance criteria that flip it to `"ready"`.

## Interpretations

Every field on this manifest corresponds to a decision closed by this task and cross-referenced from `t10a3-audit-result.json`'s `decisionsClosed`. The point of centralizing them into one versioned object is operational: a future implementation reads boundaries, thresholds, and shop scope from here instead of re-deriving them from this audit's prose, and a version bump (`rfm-v1-f2`, `commercial-population-v2`, …) makes it unambiguous which historical output was produced under which rule set.

`identityCanonical: false` and `masterMigrationGate` staying explicit on the manifest itself (not only in surrounding metadata) is deliberate — the manifest is the object most likely to be read out of context by a future consumer, so it must carry its own provisional status rather than depending on the caller to have also read the wrapping `identityMode` metadata.

## Decisions

1. The manifest is a proposal/design artifact in this task — no runtime code reads it, no snapshot table is created.
2. `masterMigrationGate` is closed as `"blocked"` for this run.
3. Every governed boundary from `CP-R1-T10A-3-rfm-method-finalization.md` and `CP-R1-T10A-3-multishop-decision.md` is represented on the manifest; nothing governed is left implicit.
4. Version fields (`populationPolicyVersion`, `operationalAccountPolicyVersion`, `frequencyThresholdVersion`, `lifecycleVersion`) are independent of each other — changing one does not require bumping the others.

## Follow-up

- When an implementation task picks this up, the manifest fields become the seed for that snapshot job's configuration — do not re-derive boundaries from raw percentiles at that point; read them from here (or from a re-run of this audit at the new calibration date).
- Flip `masterMigrationGate` to `"ready"` only after the CP-R1-T10A-2 migration acceptance criteria are met and independently verified, not as part of this task.
