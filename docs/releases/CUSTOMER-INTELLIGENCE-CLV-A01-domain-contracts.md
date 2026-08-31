# CUSTOMER-INTELLIGENCE-CLV-A01 Domain Contracts

Status: **READY**.

Type: pure domain contracts, versioning, snapshot primitives, and validators. No model, labels, migrations, persistence, Customer Intelligence integration, RFM changes, clustering changes, or affinity changes.

Baseline: `docs/audits/CUSTOMER-INTELLIGENCE-CLV-A00-existing-capability-and-readiness.md`, decision `CLV_TRACK_READY_WITH_PREREQUISITES`.

## 1. CLV Definition

CLV v1 is explicitly defined as:

```text
expected future revenue
over a fixed 12-month horizon
in CLP
tax included
```

It is not historical lifetime spend, profit, margin, acquisition budget, retention budget, RFM score, cluster score, affinity score, or purchase probability.

## 2. Domain Module

New module:

```text
src/domain/customer-clv/
  contracts.ts
  snapshot.ts
  validation.ts
  index.ts
```

`contracts.ts` defines the stable public shapes:

- `CustomerClvRecord`
- `CustomerClvSnapshotHeader`
- `CustomerClvSnapshotRow`
- `CustomerIntelligenceClvSnapshotRef`
- `CustomerIntelligenceClv`
- reliability bucket and snapshot status unions
- v1 lineage constants

`snapshot.ts` defines deterministic snapshot-key construction and the v1 horizon guard.

`validation.ts` defines pure assertion helpers for records, snapshot headers, rows, ids, timestamps, policies, checksums, CLP currency, v1 horizon, decimal strings, and reliability buckets.

## 3. Horizon And Currency

V1 horizon is fixed:

```text
CUSTOMER_CLV_HORIZON_MONTHS = 12
```

V1 currency is explicit:

```text
CUSTOMER_CLV_CURRENCY_ISO_CODE = 'CLP'
```

The horizon is not runtime-mutable in v1. A future 6-month or 24-month model should introduce explicit versioned semantics and a distinct snapshot lineage.

## 4. Target And Monetary Semantics

The primary target is:

```text
expectedRevenueTaxIncl
```

This is a decimal string and must be non-negative. Persisted currency values are not represented as JavaScript floating-point numbers.

`expectedOrders` is optional because expected future order count is auxiliary. A CLV snapshot row remains valid without it.

Initial monetary policy version:

```text
CUSTOMER_CLV_MONETARY_POLICY_VERSION =
  'customer-clv-future-valid-order-tax-incl-clp-revenue-v1'
```

The contract reserves this lineage explicitly. CLV-A02 must finalize the precise cutoff-safe order/line policy for labels and inputs, including valid-order status, positive paid value, operational exclusions, seller-service treatment, cancellations, and refund diagnostics. This slice does not silently reuse RFM monetary semantics.

## 5. Model Version

Initial model version:

```text
CUSTOMER_CLV_MODEL_VERSION = 'customer-clv-cohort-v1'
```

This names the intended methodology family from A00: cohort-based expected value with shrinkage and reliability buckets. It does not encode model math yet, and no model is implemented in A01.

## 6. Population Policy

Initial population policy version:

```text
CUSTOMER_CLV_POPULATION_POLICY_VERSION =
  'customer-clv-population-valid-order-ge1-operational-excluded-v1'
```

Semantics reserved by the contract:

- customers with at least one valid order are in scope;
- known operational accounts are excluded;
- one-order customers remain in scope;
- zero-order customers are out of scope for purchase-history CLV v1.

No population query is implemented in this slice.

## 7. Reliability Bucket

Reliability values:

```text
LOW
MEDIUM
HIGH
```

Semantics:

- `LOW`: sparse history, weak cohort support, or immature observation history.
- `MEDIUM`: moderate historical/cohort support.
- `HIGH`: strong historical support and well-supported cohort/model estimate.

This is not statistical confidence, not a confidence interval, and not purchase probability.

## 8. Snapshot Lineage

Snapshot status reuses the existing lifecycle:

```text
building
validated
published
failed
superseded
```

`CustomerClvSnapshotHeader` carries:

- `snapshotId`
- `snapshotKey`
- `status`
- `referenceTime`
- `generatedAt`
- `horizonMonths`
- `modelVersion`
- `populationPolicyVersion`
- `monetaryPolicyVersion`
- `identityAuthority`
- `currencyIsoCode`
- `populationSize`
- `datasetChecksum`
- `outputChecksum`
- optional bounded `trainingMetadata`
- optional bounded `validationMetadata`

Training metadata is deliberately small: cutoff range, window count, and model-fit version only. Validation metadata is likewise bounded to a few summary metrics; no arbitrary model implementation blob is part of the domain contract.

## 9. Snapshot Row

`CustomerClvSnapshotRow` is one row per customer:

```ts
{
  customerId;
  expectedRevenueTaxIncl;
  expectedOrders?;
  reliabilityBucket;
}
```

It is output-only. It does not carry experimental training features.

## 10. Snapshot Key

`buildCustomerClvSnapshotKey()` includes:

- `modelVersion`
- `horizonMonths`
- `populationPolicyVersion`
- `monetaryPolicyVersion`
- `referenceTime`

Same logical inputs produce the same key. Changing any lineage-relevant field changes the key.

## 11. Identity Authority

CLV uses:

```text
CUSTOMER_CLV_IDENTITY_AUTHORITY = 'prestashop_customer'
```

It does not require `masterCustomerId`. The CLV track remains independently buildable from ecommerce analytical identity.

## 12. Customer Intelligence Future Shape

A future integration can compose:

```ts
type CustomerIntelligenceClvSnapshotRef = {
  readonly snapshotId: string;
  readonly referenceTime: string;
  readonly modelVersion: string;
  readonly horizonMonths: 12;
};

type CustomerIntelligenceClv = {
  readonly snapshot: CustomerIntelligenceClvSnapshotRef;
  readonly expectedRevenueTaxIncl: string;
  readonly currencyIsoCode: 'CLP';
  readonly reliabilityBucket: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly expectedOrders?: string;
};
```

This is defined for future use only. `CustomerIntelligenceRow` is not modified in A01. Absence of CLV in that future read model should be `null`, not `expectedRevenueTaxIncl = '0.000000'`.

## 13. Boundaries

CLV contracts deliberately do not include:

- RFM scores, RFM segment, or RFM code;
- cluster id, cluster label, or cluster distance;
- Commercial Affinity rows or semantic facts;
- allowable spend, recommended budget, campaign ceiling, acquisition budget, or retention budget;
- margin/profit fields;
- confidence intervals or purchase probability.

Those dimensions can compose downstream in Customer Intelligence or a later budget-policy layer. They are not part of CLV v1 itself.

## 14. Validation

Focused tests:

```text
tests/unit/customer-clv-contracts.test.ts
```

Coverage:

- valid minimal record;
- omitted and present `expectedOrders`;
- negative expected revenue rejected;
- invalid customer id rejected;
- invalid currency rejected;
- LOW/MEDIUM/HIGH accepted;
- invalid reliability rejected;
- snapshot row/header validation;
- snapshot key determinism;
- key changes on model, horizon, population policy, monetary policy, and reference time changes;
- identity authority is `prestashop_customer`;
- missing CLV is structurally `null`, not zero CLV;
- no RFM/cluster/affinity/budget fields on public record;
- architecture guard against forbidden CLV-domain imports.

## 15. Intentionally Not Implemented

A01 does not:

- build a historical dataset;
- create future labels;
- implement cohort expected value;
- implement baselines;
- train anything;
- add DB migrations;
- persist snapshots;
- modify Customer Intelligence;
- modify RFM;
- modify clustering;
- modify Customer Commercial Affinity;
- call Catalog Service;
- write to PrestaShop;
- use an LLM for prediction.

## 16. Next Step

`CLV-A02 Historical Dataset + Backtest Builder`: create cutoff-safe historical input and future-label datasets using the A01 contracts as the stable output target.
