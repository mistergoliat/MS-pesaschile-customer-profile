# CUSTOMER-INTELLIGENCE-CLV-A02 Historical Dataset + Backtest Builder

Status: **READY WITH DOCUMENTED DEBT**.

Type: deterministic historical CLV dataset builder, read-only PrestaShop source reader, synthetic backtest coverage, and bounded real-data dry run. No CLV model, no CLV persistence, no Customer Intelligence integration, no RFM/clustering/affinity modifications, and no production DB writes.

## 1. Architecture

New CLV-A02 path:

```text
MySQL PrestaShop (read only)
  -> src/infrastructure/prestashop/mysql-customer-clv-historical-reader.ts
  -> src/domain/customer-clv/dataset.ts
  -> deterministic JSON artifact via serializeCustomerClvBacktestDataset()
  -> scripts/clv/backtest-dry-run.ts
```

This is intentionally separate from the production per-customer runtime readers. The builder is pure and cutoff-driven; the reader is bulk, read-only, and SQL-only.

## 2. Source Reader

`createMysqlCustomerClvHistoricalReader()` reads:

- `ps_orders`
- `ps_customer`
- `ps_currency`
- `ps_order_detail`

Guardrails:

- schema verification before data reads;
- safe table-prefix validation;
- read-only usage only;
- bulk reads only, no N+1 customer queries;
- seller-service revenue aggregated in a dedicated CTE;
- product behavior aggregated at `orderId x productId` before entering the pure builder.

Historical source shape:

```ts
{
  availableDataThrough;
  orders: [{
    orderId;
    customerId;
    customerCreatedAt;
    createdAt;
    currentValid;
    currentStateId;
    currencyIsoCode;
    totalPaidTaxIncl;
    totalDiscountsTaxIncl;
    totalShippingTaxIncl;
    sellerServiceRevenueTaxIncl;
    refundEvidence;
    products: [{ productId, quantity, revenueTaxIncl }];
  }];
}
```

## 3. Cutoff And Label Semantics

All timestamps are normalized to UTC ISO strings.

Feature window:

```text
order.createdAt < cutoffTime
```

Label window:

```text
order.createdAt >= cutoffTime
AND
order.createdAt < cutoffTime + 12 months
```

Half-open intervals are enforced. An order at `cutoffTime` belongs only to labels. An order at exactly `cutoffTime + 12 months` is excluded.

Maturity guard:

```text
cutoffTime + 12 months <= availableDataThrough
```

Incomplete label windows are rejected; they are never backfilled as zero revenue.

## 4. Population And Monetary Policy

Dataset version:

```text
customer-clv-backtest-dataset-v1
```

Population policy:

```text
customer-clv-population-valid-order-ge1-operational-excluded-v1
```

Order eligibility policy:

```text
customer-clv-order-eligibility-current-valid-positive-clp-v1
```

Monetary policy:

```text
customer-clv-future-valid-order-tax-incl-clp-revenue-v1
```

Product feature policy:

```text
customer-clv-product-features-non-product-excluded-v1
```

Order status temporal policy:

```text
customer-clv-current-valid-observed-with-documented-drift-v1
```

Implemented rules:

- customers must exist by cutoff;
- customers must have `>=1` eligible historical valid order before cutoff;
- customers with zero future orders remain in population with zero labels;
- operational accounts are excluded using the known IDs `39617, 85980, 86421, 90890`;
- eligible orders must satisfy `currentValid=true`, `totalPaidTaxIncl>0`, `currencyIsoCode='CLP'`;
- compatible currency is enforced, not assumed; valid positive non-CLP orders fail the build;
- seller-service revenue is excluded from commercial revenue using confirmed product id `444`;
- product behavior excludes confirmed non-product ids `444, 505, 554, 555, 556, 557, 558, 902, 903`;
- duplicate order ids are rejected;
- duplicate `productId` rows inside one order are rejected;
- one customer row is emitted per `customerId x cutoffTime`.

## 5. Feature Set

Built from pre-cutoff history only:

- `historicalValidOrderCount`
- `historicalRevenueTaxIncl`
- `historicalAovTaxIncl`
- `firstValidOrderAt`
- `lastValidOrderAt`
- `customerTenureDays`
- `daysSinceLastOrder`
- `purchaseFrequencyDays`
- `orders90d`
- `orders180d`
- `orders365d`
- `revenue90d`
- `revenue180d`
- `revenue365d`
- `distinctPurchaseMonths`
- `cancellationRatio`
- `discountShare`
- `shippingShare`
- `distinctProductCount`
- `repeatProductRate`
- `productConcentration`

Null semantics:

- `purchaseFrequencyDays = null` for one-order customers;
- `repeatProductRate = null` when no product rows exist after non-product exclusion;
- `productConcentration = null` when total product revenue is zero.

Labels:

- `futureRevenueTaxIncl`
- `futureValidOrderCount`

## 6. Leakage Guards

The builder does not read:

- current customer feature snapshots;
- current RFM snapshots;
- current cluster assignments;
- current affinity;
- lifetime totals extending beyond cutoff;
- mutable current customer attributes;
- future orders for feature derivation.

The test suite includes a mandatory adversarial leakage regression: two sources identical before cutoff but radically different after cutoff produce identical feature vectors and different labels only.

## 7. Temporal-State Limitation

Point-in-time order validity/state reconstruction is not fully available from current repository evidence.

Known limitation carried explicitly in the dataset manifest:

- `ps_orders.valid` is observed at extraction time, not reconstructed as of cutoff;
- `ps_orders.current_state` can diverge from the latest `ps_order_history` event;
- `cancellationRatio` is deterministic but not fully reconstructible as-of cutoff from present evidence.

This debt is documented, tested, and carried in the manifest rather than hidden.

## 8. Registration-Time Data Quality Guard

The builder now excludes customers when:

- `ps_customer.date_add` is inconsistent across their source rows; or
- an observed order predates `ps_customer.date_add`.

This does not infer or rewrite registration timestamps. The exclusion is deterministic and counted in the manifest so corrupt registration facts do not silently pollute tenure or population semantics.

## 9. Manifest And Artifact

Each dataset contains:

- manifest
- rows

Manifest fields include:

- dataset/policy lineage versions
- cutoff and label window bounds
- `availableDataThrough`
- horizon months
- population/order counts
- zero-future and single-order coverage
- registration-anomaly exclusion counts
- timezone/storage metadata
- temporal limitation notes
- `inputChecksum`
- `featureChecksum`
- `labelChecksum`
- `datasetChecksum`

Serialization is deterministic JSON via `serializeCustomerClvBacktestDataset()`.

CLI:

```text
npm run clv:backtest:dry-run
npm run clv:backtest:dry-run -- --cutoff=2025-01-01T00:00:00.000Z
npm run clv:backtest:dry-run -- --out=artifacts/clv/backtest-2025-07-01.json
```

By default the CLI chooses the latest mature semiannual cutoff available from the extracted source.

## 10. Synthetic Validation

Focused dataset coverage:

- A. pre-cutoff order contributes only to features;
- B. order exactly at cutoff contributes only to labels;
- C. order at `cutoff + 12 months` is excluded;
- D. zero-future-order customers remain with zero labels;
- E. one-order historical customers remain in population;
- F. no historical valid order means exclusion;
- G. operational customers are excluded;
- H. post-cutoff customer registration is excluded;
- I. future orders do not rewrite historical revenue/AOV/recency;
- J. multi-line orders do not multiply order-level revenue/count;
- K. one-order `purchaseFrequencyDays` is `null`;
- L. two-order timing is computed from historical timing only;
- M. incomplete 12-month windows are rejected;
- N. valid positive non-CLP orders are rejected;
- O. input permutation preserves rows and checksums;
- P. exactly one row per `customerId x cutoffTime`;
- mandatory leakage regression;
- explicit temporal-state limitation regression;
- duplicate order-id rejection;
- duplicate per-order product-id rejection;
- seller-service exclusion regression;
- corrupt registration exclusion regression;
- candidate-cutoff generation.

Reader coverage:

- schema verification;
- unsafe table-prefix rejection;
- empty policy rejection;
- order-level vs product-level mapping;
- seller-service / operational-account / non-product SQL policy.

## 11. Real-Data Dry Run

Run date: **2026-08-30**.

Command:

```text
npm run clv:backtest:dry-run
```

Observed output:

- `cutoffTime`: `2025-07-01T00:00:00.000Z`
- `availableDataThrough`: `2026-08-30T16:13:13.000Z`
- `datasetChecksum`: `4d3292ded14fe2e0a818931e51337c6af308d9f957d84b98d25b8704c6ecdd0b`
- `artifact.bytes`: `31,019,456`
- `population`: `32,277`
- `historyOrderCount`: `45,679`
- `labelOrderCount`: `4,386`
- `zeroFutureOrderRate`: `0.909316`
- `singleHistoricalOrderCoverage`: `0.785668`

Future revenue distribution:

- `min`: `0.000000`
- `median`: `0.000000`
- `p75`: `0.000000`
- `p90`: `0.000000`
- `p95`: `74103.000000`
- `p99`: `699983.000000`
- `max`: `44579241.000000`
- `mean`: `30094.824342`

Future order distribution:

- `median`: `0`
- `p95`: `1`
- `p99`: `2`
- `max`: `17`
- `mean`: `0.136`

Historical order distribution:

- `median`: `1`
- `p90`: `2`
- `p95`: `3`
- `p99`: `7`
- `max`: `28`
- `mean`: `1.415`

Candidate mature cutoffs:

- `2023-01-01T00:00:00.000Z`
- `2023-07-01T00:00:00.000Z`
- `2024-01-01T00:00:00.000Z`
- `2024-07-01T00:00:00.000Z`
- `2025-01-01T00:00:00.000Z`
- `2025-07-01T00:00:00.000Z`

## 12. Data Quality Summary

Observed on the 2026-08-30 dry run:

- read-only grant check passed;
- total orders read: `66,802`;
- total product rows read: `140,149`;
- source rows read: `206,951`;
- duplicate order ids: `0`;
- missing timestamps reaching the reader: `0`;
- negative totals: `0`;
- eligible non-CLP orders: `0`;
- eligible missing-currency orders: `0`;
- orders with refund evidence from `order_detail`: `0`;
- historical cancelled orders observed by current state: `597`;
- excluded operational customers: `4`;
- excluded operational orders: `14,809`;
- excluded inconsistent customer-created-at customers: `0`;
- excluded order-before-customer-created-at customers: `1`.

## 13. Performance

Observed on the 2026-08-30 dry run:

- duration: `14,204 ms`
- heap-used delta: `226.505 MB`
- artifact size in memory: about `31.0 MB`

This is plausible for offline backtesting work and avoids customer-level N+1 reads.

## 14. Files

Primary CLV-A02 additions:

- `src/domain/customer-clv/dataset.ts`
- `src/infrastructure/prestashop/mysql-customer-clv-historical-reader.ts`
- `scripts/clv/backtest-dry-run.ts`
- `tests/unit/customer-clv-backtest-dataset.test.ts`
- `tests/unit/mysql-customer-clv-historical-reader.test.ts`
- `docs/releases/CUSTOMER-INTELLIGENCE-CLV-A02-historical-dataset-backtest-builder.md`

Updated exports/scripts:

- `src/domain/customer-clv/index.ts`
- `src/infrastructure/prestashop/index.ts`
- `package.json`
