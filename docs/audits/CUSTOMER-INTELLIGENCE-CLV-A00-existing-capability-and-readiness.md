# CUSTOMER-INTELLIGENCE-CLV-A00 Existing CLV Capability & Data Readiness Audit

Date: 2026-08-29.

Status: **AUDIT_ONLY_NO_RUNTIME_CHANGE**.

Decision: **CLV_TRACK_READY_WITH_PREREQUISITES**.

This audit determines whether `MS-pesaschile-customer-profile` already contains CLV logic or reusable CLV-adjacent analytical assets, and defines the smallest defensible CLV v1 that adds predictive economic value beyond RFM and behavioral clustering.

No CLV model was implemented. No DB migration was added. RFM, clustering, and Customer Commercial Affinity were not modified.

## 1. Search Scope And Existing CLV Capability

Searched across `src/`, `scripts/`, `tests/`, `docs/`, and `migrations/` for:

```text
CLV, LTV, customer lifetime value, lifetime value, expected value, future value,
customer value, predicted spend, expected spend, expected orders, survival,
retention, churn, BG/NBD, Pareto/NBD, Gamma-Gamma
```

Findings:

| Finding | Location | Classification | Notes |
|---|---|---|---|
| No CLV/LTV model, contract, table, migration, endpoint, command, or test | Full searched tree | ACTIVE_RUNTIME: none | There is no production CLV capability today. |
| RFM runtime and snapshots | `src/domain/customer-rfm/*`, `src/infrastructure/prestashop/mysql-rfm-population-reader.ts`, `src/infrastructure/rfm/*`, migrations `002`-`004` | REUSABLE_COMPONENT | Provides recency, frequency, monetary, AOV, versioned snapshots, checksums, lifecycle, and population exclusions. It is not CLV. |
| Customer Analytics Data Layer | `src/domain/customer-analytics/*`, `src/infrastructure/prestashop/mysql-customer-feature-reader.ts`, `src/infrastructure/customer-analytics/*`, migrations `008`-`009` | REUSABLE_COMPONENT | Provides customer-level feature snapshots over Population B (`>=1` valid order), including tenure, recency, frequency, AOV, product diversity, repeat behavior, discount/share signals, and checksums. |
| Customer Intelligence read model | `src/domain/customer-intelligence/contracts.ts`, `src/infrastructure/customer-intelligence/mysql-customer-intelligence-reader.ts` | REUSABLE_COMPONENT | Composes feature + RFM + cluster snapshots with nullable RFM/cluster blocks. This is the right future integration pattern for CLV. |
| Canonical analytical order contract | `src/domain/customer-orders/analytical-order.ts`, `scripts/snapshots/rfm-canonical-analytical-order.ts`, `docs/releases/CP-R1-T11A3.3-canonical-analytical-order-contract.md` | EXPERIMENTAL / REUSABLE_COMPONENT | Pure order/order-line contract and audit script exist. They demonstrate richer historical order-line data can be read and normalized, but there is no production historical analytical-order reader yet. |
| RFM analytical use-case validation | `docs/releases/CP-R1-T11A3-rfm-analytical-use-case-validation.md`, `src/domain/customer-rfm/use-case-analysis.ts` | EXPERIMENTAL | Evaluates historical and operational cohorts, second-purchase timing, and high-gross/inactive cohorts. It is analysis, not CLV. |
| Behavioral clustering experiment and productionization | `docs/experiments/CP-R2-T01-behavioral-clustering-v1-controlled-experiment.md`, `src/domain/customer-clustering/*`, `src/infrastructure/prestashop/mysql-cluster-population-reader.ts` | REUSABLE_COMPONENT | Provides behavioral shape features and cluster snapshot patterns. It is unsupervised segmentation, not expected future value. |
| Customer Commercial Affinity | `src/domain/customer-commercial-affinity/*`, `docs/design/CUSTOMER-INTELLIGENCE-R2-A01-customer-commercial-affinity-design.md` | UNRELATED / FUTURE_DOWNSTREAM_CONTEXT | Product-semantic historical affinity. It explicitly is not a forecast or profitability model and should not be a required CLV input in v1. |
| Mentions of "future analytical value", "retention", "churn", "cost" in docs | Various audit/release docs | UNRELATED | These refer to snapshot retention, operational cost, future consumers, or text in product/export artifacts, not CLV logic. |
| Deprecated CLV capability | Full searched tree | DEPRECATED: none | No retired CLV implementation was found. |

## 2. Existing Customer Value Signals

Customer-level signals already available:

| Signal | Source/contract | Current semantics | CLV readiness |
|---|---|---|---|
| Lifetime total spend | `CustomerCommercialSummary.totalSpentTaxIncl`; `CustomerFeatureRow.totalSpentTaxIncl` | `SUM(ps_orders.total_paid_tax_incl)` over valid orders. Feature snapshot excludes known operational accounts and zero-value valid orders; commercial summary is per-customer runtime and simpler. | Ready as revenue input, not margin. Prefer feature snapshots or a CLV-specific cutoff dataset over runtime summary. |
| Valid order count | `CustomerCommercialSummary.totalOrders`; `CustomerFeatureRow.validOrders`; `RfmSnapshotRow.frequencyOrders` | Count of valid orders; RFM is windowed and has seller-service monetary adjustment. | Ready. Must distinguish lifetime vs windowed. |
| Average order value | `averageOrderValueTaxIncl` in commercial summary, RFM, and feature rows | Total spend divided by valid order count, decimal string. | Ready. |
| First order date | `firstOrderAt` / `firstValidOrderAt` | Minimum valid order timestamp. | Ready. |
| Last order date | `lastOrderAt` / `lastValidOrderAt` | Maximum valid order timestamp. | Ready. |
| Customer tenure | `CustomerFeatureRow.customerTenureDays` | Days from `ps_customer.date_add` to snapshot reference time. | Ready in feature snapshot. |
| Recency | `daysSinceLastOrder`, `recencyDays`, purchase-behavior product recency | Days since last valid order/product purchase to reference time. | Ready. |
| Interpurchase timing | `purchaseFrequencyDays` | `(lastOrderAt - firstOrderAt) / (validOrders - 1)`, null for one-order customers. | Ready for `>=2` valid orders; must remain nullable. |
| Repeat behavior | `repeatProductRate`, `repeatedProductCount`, `repeatedVariantCount`, `orders365d` | Product/variant repeat and recent-order counts. | Ready as optional explanatory/predictive features. |
| Purchase frequency | RFM `frequencyOrders`, feature `validOrders`, `orders365d`, `purchaseFrequencyDays` | Raw count and timing features. | Ready. |
| Refunds/cancellations | commercial summary `cancelledOrderCount`, `refundedOrderCount`; feature `cancelledOrderRatio`; RFM diagnostics | Cancellations from `current_state = 6`; refunded from `current_state = 7`; prior audit found `ps_order_slip` empty and line-level refund amounts unused. | Partially ready as activity/quality features; not enough for net-revenue labels. |
| Currency handling | RFM diagnostics and prior commercial-summary audit | Historical audits found valid orders are CLP and conversion rate is 1. RFM enforces one currency. Commercial summary returns `currencyIsoCode: 'CLP'`. | Ready for revenue in CLP; CLV output must still carry currency/policy. |
| Operational/customer exclusions | `excludedOperationalAccountPrestashopCustomerIds`, RFM/feature/cluster readers | Explicit operational-account exclusion policy. RFM also subtracts seller-service monetary value. | Ready; CLV must choose and version one policy. |

Important distinction: historical spend is a feature, not CLV. CLV v1 must estimate future value over a fixed horizon.

## 3. Available Data Grain

| Grain | Existing availability | Current limitation for CLV |
|---|---|---|
| Customer-level aggregates | Strong. `customer_feature_snapshot_row` materializes 18 commercial/behavioral features for `>=1` valid-order customers. RFM snapshots materialize windowed R/F/M fields. | Enough for a first expected-value model if labels can be built out-of-time. |
| Order-level history | Partially available. `mysql-customer-orders-reader.ts` reads recent orders per customer, capped at 50. `scripts/snapshots/rfm-canonical-analytical-order.ts` can read order headers for audit scopes. | No production read-only analytical reader currently exposes complete historical valid orders for model training/backtesting. |
| Order-line history | Partially available. Purchase behavior and purchased-products readers aggregate lines by product/variant. The analytical-order audit script reads lines and discounts. | No reusable production CLV dataset reader yet. Existing code should be adapted, not copied ad hoc. |

Conclusion: richer historical order data exists in PrestaShop and has already been audited through scripts/domain builders, but the current production analytical read model is customer-aggregate first. CLV should not be built only from current RFM output; the first implementation slice should create a point-in-time historical dataset/backtest builder using the existing order/feature semantics.

## 4. What CLV Should Mean

Candidate targets:

| Target | Assessment |
|---|---|
| Expected future revenue | Best v1 target. Supported by valid-order history, CLP currency, customer aggregate features, and out-of-time labels. |
| Expected future gross margin / contribution margin | Not ready. Tax-exclusive prices and `wholesale_price` appear in product exploration, but there is no reliable historical COGS/margin/customer-profit contract. Existing copilot and RFM docs explicitly reject profitability inference without margin/cost fields. |
| Expected future number of orders | Useful auxiliary output. It is less economically complete than revenue but helps diagnose whether value comes from expected activity or ticket size. |
| Lifetime historical value | Reject as CLV. It is historical spend and already exists as `totalSpentTaxIncl`/RFM monetary. |
| Another value target | Future contribution-value target is defensible only after reliable product/order/customer margin data exists. |

Recommended primary v1 target: **expected future revenue, tax-included CLP, over a fixed 12-month horizon**.

Recommended auxiliary target: **expected future valid order count over the same horizon**, if validation shows it is stable enough.

## 5. Horizon

| Horizon | Assessment |
|---|---|
| 6 months | Operationally responsive but likely too sparse for durable fitness equipment, where normal repurchase cycles can be long. Useful as a secondary diagnostic later. |
| 12 months | Best v1 balance. Long enough to observe repeat/accessory/replacement behavior; short enough for out-of-time validation and business planning. |
| 24 months | More signal for durable goods, but labels mature slowly and are more exposed to assortment, price, channel, and macro drift. |
| Unbounded lifetime | Not recommended. Hard to validate, harder to explain, and unsafe with mutable history and durable-goods purchase cycles. |

Recommendation: **12 months**.

## 6. RFM Overlap

Overlap is expected and legitimate at the raw-feature level:

- Recency: CLV will use days since last valid order; RFM uses `recencyDays`.
- Frequency: CLV will use lifetime/order-window counts and interpurchase timing; RFM uses `frequencyOrders`.
- Monetary: CLV will use historical revenue/AOV; RFM uses gross monetary value in its configured window.

CLV must add information by learning or estimating **future** economic value from past cutoffs, then validating against future realized orders/revenue. It must not be a weighted RFM score, an RFM segment times average spend, or a renamed monetary score.

How v1 adds value beyond RFM:

- Uses explicit prediction horizon and labels: revenue/orders in `T -> T + 12 months`.
- Can include tenure, purchase-frequency-days, orders365d, discount/share, shipping/share, cancellation ratio, product breadth/concentration, and sparse-customer reliability, not just R/F/M scores.
- Produces calibrated currency/order expectations, not ordinal 1-5 scores or segment labels.
- Is judged by out-of-time ranking/calibration/lift against baselines, including RFM-segment baselines.

## 7. Cluster Overlap

Behavioral clustering uses product diversity, repeat rate, concentration, purchase timing, orders365d, tenure, cancellation, discount, and shipping-share signals. These overlap with plausible CLV predictors.

Recommendation: **do not use cluster assignment as a required v1 predictor**.

Use cluster downstream for interpretation, diagnostics, and action planning:

- Compare average predicted CLV and calibration by cluster.
- Explain why two equal-RFM customers differ behaviorally.
- Avoid letting an unsupervised label become a hidden proxy feature whose stability and meaning depend on the current clustering model.

Cluster can be tested later as an optional feature only if out-of-time validation proves incremental value and model-version compatibility is clean.

## 8. Candidate Model Families

| Family | Data requirements | Assumptions | Interpretability | Complexity | Calibration/stability | Durable-goods fit | Out-of-time validation | Verdict |
|---|---|---|---|---|---|---|---|---|
| Deterministic historical projection | Customer aggregates, simple recency/frequency/AOV rules | Past average rate continues | High | Low | Usually weak; can overvalue one-off high-ticket buyers | Weak unless heavily guarded | Easy | Mandatory baseline, not preferred CLV. |
| Cohort-based expected value | Cutoff features plus future 12m labels; cohorts by tenure/order-count/recency/value bands | Similar customers at prior cutoffs have similar future value | High | Low-medium | Stable with shrinkage and minimum-cell rules | Good v1 fit; handles sparse/durable behavior explicitly | Strong | Recommended v1. |
| BG/NBD + Gamma-Gamma | Complete transaction history with non-contractual repeat buying; monetary/frequency assumptions | Stationary purchase process, dropout behavior, monetary independence assumptions | Medium | Medium-high | Needs careful calibration and diagnostics | Risky for durable equipment, infrequent purchases, and high one-off tickets | Possible | Later research candidate, not v1 default. |
| Simple supervised regression | Labeled customer-cutoff dataset with future revenue/orders | Relationship learned from historical features generalizes | Medium-high if linear/GLM; lower if tree/boosted | Medium | Requires feature leakage controls and calibration | Good if enough cutoff windows exist | Strong | Candidate v2 or A04 alternative after A02/A03 labels. |
| Two-stage activity x value model | Future active/order probability plus conditional revenue/AOV | Separates purchase probability from value conditional on activity | High-medium | Medium | Often more stable than direct revenue-only for sparse outcomes | Good durable-goods fit | Strong | Good evolution after cohort v1 or as supervised v1 if data volume supports it. |

Recommended simplest defensible v1: **cohort-based 12-month expected future revenue**, with optional expected-orders output, empirical shrinkage to broader cohorts/global priors, and mandatory out-of-time validation against simple baselines.

## 9. Durable-Goods Considerations

PesasChile sells durable fitness equipment. This affects CLV:

- Purchases can be infrequent; long gaps are not automatically churn.
- High-ticket one-off purchases are normal and should not imply high repeat value without evidence.
- Accessories, replacements, maintenance, and consumables may create repeat behavior that differs from equipment purchases.
- New customers often have sparse history; dropping them would create a coverage problem because the Data Layer documents a large one-order population.
- Standard non-contractual CLV models can misread durable-goods silence as dropout and can overfit high-value single purchases.

Implication: v1 should favor interpretable fixed-horizon expected value with explicit sparse-customer reliability, not unbounded lifetime models or complex probabilistic repeat-purchase assumptions.

## 10. Validation Strategy

Use out-of-time validation, not in-sample fit.

Recommended setup:

1. Choose several training cutoffs `T` far enough in the past to observe `T + 12 months`.
2. Build features using only data strictly before `T`.
3. Label each customer with realized valid-order revenue and valid-order count in `[T, T + 12 months)`.
4. Train/estimate cohort expected value on older cutoffs.
5. Evaluate on later cutoffs, then lock a model version.

Recommended commercial metrics:

- MAE and median absolute error for revenue.
- RMSE only as a secondary sensitivity metric because high-ticket outliers dominate it.
- Spearman/rank correlation for prioritization quality.
- Decile lift: actual future revenue/orders by predicted-value decile versus population average.
- Calibration by predicted-value bands: predicted revenue/order totals versus realized totals.
- Top-N capture: share of future revenue captured by top 5%, 10%, 20% predicted customers.
- Activity metrics for expected orders: observed active rate and order count by predicted band.

Do not judge quality only by R-squared.

## 11. Mandatory Baselines

CLV v1 must beat or materially improve ranking/calibration over:

- Historical 12-month spend projected forward.
- Lifetime average monthly spend times 12.
- Recency-adjusted spend projection.
- AOV times recent order rate.
- RFM segment median future 12-month spend.
- Global/cohort average by tenure and order-count bucket.

If cohort CLV cannot outperform these, publish the baseline as a labeled heuristic and do not call it predictive CLV.

## 12. Population Policy

Recommended v1 coverage:

- Score every customer with `>=1` valid order before reference time, using the existing Population B precedent.
- Keep one-order customers in scope with cohort/shrinkage estimates and a low reliability bucket; do not silently drop them.
- Customers with `>=2` valid orders can receive interpurchase features and higher reliability when validation supports it.
- Historical-only/inactive customers remain in scope; their expected value may be low but is still useful for reactivation ranking.
- Customers with no valid orders should not receive purchase-history CLV v1; if needed, that is a separate prospect/acquisition model.
- Apply the explicit operational-account exclusion policy.
- Labels and features should use valid orders with positive paid value and cutoff-safe timestamps; cancellations/refunds should be features/diagnostics unless a reliable net-revenue policy is later defined.
- Seller-service treatment must be chosen and versioned. For consistency with economic customer value, prefer a CLV-specific monetary policy based on canonical analytical orders / eligible commercial value once the dataset builder exists; do not silently inherit RFM monetary semantics if the target is future revenue.

## 13. Output Contract

Minimal conceptual contract:

```ts
type CustomerClvRecord = {
  readonly customerId: number;
  readonly horizonMonths: 12;
  readonly expectedRevenueTaxIncl: string;
  readonly currencyIsoCode: 'CLP';
  readonly modelVersion: string;
  readonly referenceTime: string;
  readonly populationPolicyVersion: string;
  readonly monetaryPolicyVersion: string;
  readonly reliabilityBucket: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly expectedOrders?: string;
};
```

Keep v1 minimal. Add prediction intervals only if the model and validation can support them honestly.

## 14. Uncertainty

Do not invent statistical confidence for a deterministic/cohort heuristic.

For v1, use a **reliability bucket** if defensible:

- LOW: sparse history, immature observation window, small/borrowed cohort, or low validation support.
- MEDIUM: enough history/cohort support but material calibration variance.
- HIGH: repeat history and well-calibrated cohort/model band.

Prediction intervals can be added later only from empirical residual distributions by predicted band/cohort, with coverage measured out of time.

## 15. Snapshot Architecture

CLV should follow the existing snapshot architecture:

- Header table: `customer_clv_snapshot`.
- Row table: `customer_clv_snapshot_row`.
- Status lifecycle: `building`, `validated`, `published`, `failed`, `superseded`.
- Keyed by `customerId` / `prestashop_customer_id`.
- Explicit `referenceTime`, `horizonMonths`, `modelVersion`, `populationPolicyVersion`, `monetaryPolicyVersion`, and validation/training metadata.
- Include `datasetChecksum` over cutoff input data and `outputChecksum` over CLV rows.
- Publish transactionally and supersede prior published snapshots for the same model/population/horizon stream.

This mirrors RFM, clustering, and feature snapshots. No persistence is implemented in A00.

## 16. Customer Intelligence Integration

Future conceptual shape:

```ts
type CustomerIntelligenceRow = {
  readonly prestashopCustomerId: number;
  readonly commercial: CustomerIntelligenceCommercialFeatures;
  readonly rfm: CustomerIntelligenceRfm | null;
  readonly cluster: CustomerIntelligenceCluster | null;
  readonly clv: {
    readonly snapshot: {
      readonly snapshotId: string;
      readonly referenceTime: string;
      readonly modelVersion: string;
      readonly horizonMonths: number;
    };
    readonly expectedRevenueTaxIncl: string;
    readonly currencyIsoCode: 'CLP';
    readonly expectedOrders?: string;
    readonly reliabilityBucket?: string;
  } | null;
};
```

CLV must be nullable when no compatible CLV snapshot exists or a customer is absent from the snapshot. The read model should remain feature-snapshot-anchored, following the current Customer Intelligence compatible-snapshot policy.

## 17. Commercial Budget Policy Boundary

CLV answers:

```text
What future economic value do we expect from this customer?
```

It does not answer:

```text
How much should we spend to acquire, retain, or reactivate this customer?
```

Budget policy belongs later and should be separate, for example:

```text
allowableSpend =
  expectedContributionValue
  * interventionBudgetRate
  * riskAdjustment
```

Do not bake intervention budgets, discounts, incentives, or campaign cost caps into CLV.

## 18. Margin Data Readiness

Revenue CLV is ready with prerequisites. Margin CLV is not ready.

Evidence:

- Existing customer-level and RFM monetary fields are tax-included spend/revenue-like values, not profit.
- Prior RFM and copilot docs explicitly state that spend/AOV must not be equated with margin, profitability, or rentability.
- Product exploration reads `wholesale_price`, but there is no audited historical COGS/margin contract per order line, no margin snapshot, and no policy for time-varying cost, discounts, shipping, refunds, or service/technical lines.
- Canonical analytical order explicitly keeps margin/cost/refund accounting out of scope.

To move to margin-based CLV later, the repo would need:

- Historical cost-of-goods source by product/variant at order time, not just current catalog wholesale price.
- Policy for shipping cost, discounts, services, logistics artifacts, refunds/returns, tax basis, and cost changes over time.
- Reconciliation against accounting or an accepted business margin source.
- Versioned margin policy and validation outputs.

## 19. Reusable Components

| Component | Classification | Use |
|---|---|---|
| `sha256Stable` / canonical checksum pattern | REUSE_DIRECTLY | Dataset and output checksums. |
| `src/shared/decimal.ts` and existing money decimal conventions | REUSE_DIRECTLY | CLP revenue arithmetic as decimal strings. |
| Snapshot lifecycle/repository patterns from RFM, clustering, feature snapshots | REUSE_DIRECTLY | Transactional publish, validation, supersede, row-count/checksum verification. |
| Operational-account exclusion policy | REUSE_DIRECTLY | Population policy input. |
| Customer Analytics feature snapshot contracts/readers | REUSE_DIRECTLY for serving inputs; REUSE_WITH_ADAPTER for cutoff training datasets | Customer-level feature surface and snapshot-read pattern. |
| Customer Intelligence nullable composition | REUSE_DIRECTLY | Future read-model integration. |
| Canonical analytical order domain | REUSE_WITH_ADAPTER | Build richer CLV labels/monetary policies from order/order-line history. |
| `scripts/snapshots/rfm-canonical-analytical-order.ts` SQL approach | REUSE_WITH_ADAPTER | Starting point for a real historical dataset/backtest reader; do not leave it as an ad hoc script dependency. |
| RFM population reader | REUSE_WITH_ADAPTER | Useful policy reference; do not couple CLV to RFM output or window-only aggregate. |
| Purchase behavior product aggregates | REUSE_WITH_ADAPTER | Product diversity, concentration, repeat behavior; not sufficient for labels alone. |
| RFM scores/segments | DO_NOT_REUSE as CLV model | May be a baseline or downstream explanation only. |
| Cluster assignment | DO_NOT_REUSE as required v1 predictor | Use downstream for interpretation/calibration diagnostics. |
| Customer Commercial Affinity scoring | DO_NOT_REUSE for CLV v1 | Historical affinity, not future value; future explanatory dimension. |
| Product `wholesale_price` | DO_NOT_REUSE as margin | Current/catalog field is not reliable historical margin evidence. |
| Runtime per-customer commercial summary endpoint | DO_NOT_REUSE for model training | It is single-customer runtime aggregation, not a cutoff-safe full-population training dataset. |

## 20. Recommended CLV Track

Minimum subsequent slices:

| Slice | Scope |
|---|---|
| CLV-A01 Domain Contracts | Define `CustomerClvRecord`, snapshot manifest, population/monetary/model version constants, no persistence. |
| CLV-A02 Historical Dataset + Backtest Builder | Build cutoff-safe customer features and future 12m labels from historical valid orders, adapting the analytical-order/feature-reader patterns. |
| CLV-A03 Baselines | Implement mandatory baselines and out-of-time evaluation harness. |
| CLV-A04 Cohort Expected-Value Model v1 | Empirical cohort model with shrinkage, expected revenue, optional expected orders, reliability bucket. |
| CLV-A05 Out-Of-Time Validation | Evaluate calibration, decile lift, rank correlation, MAE/median AE, top-N capture; compare against baselines. |
| CLV-A06 Snapshot Persistence | Add CLV snapshot tables/repository only after A05 shows value. |
| CLV-A07 Read Model/API Integration | Add nullable CLV block to Customer Intelligence read model and any API surface required by a concrete consumer. |
| CLV-A08 Optional Model Upgrade | Consider two-stage supervised model or BG/NBD-style research only if v1 baselines and data volume justify it. |

## 21. Final Report

STATUS:
Audit document created. No production runtime code changed.

DECISION:
CLV_TRACK_READY_WITH_PREREQUISITES

EXISTING_CLV_CAPABILITY:
No active, experimental, placeholder, or deprecated CLV/LTV model was found. Existing RFM, Customer Analytics, Customer Intelligence, purchase behavior, and analytical-order assets are reusable but are not CLV.

AVAILABLE_INPUTS:
Customer-level spend, valid orders, AOV, first/last order, recency, tenure, purchase-frequency-days, orders365d, product diversity/concentration/repeat behavior, cancellations, discounts, shipping share, CLP currency evidence, and operational exclusions are available. Reliable margin/profit fields are not.

DATA_GRAIN:
Customer-level aggregates are production-ready through feature snapshots. Complete order/order-line history exists in PrestaShop and is proven feasible by audit scripts/domain builders, but no production CLV-ready historical order reader exists yet.

RECOMMENDED_TARGET:
Expected future revenue, tax-included CLP. Expected future order count can be an auxiliary output if validated.

RECOMMENDED_HORIZON:
12 months.

RFM_OVERLAP:
CLV overlaps with recency, frequency, and monetary raw inputs, but must add a future-label, fixed-horizon, calibrated economic estimate. It must not be a weighted RFM score or RFM segment heuristic.

CLUSTER_OVERLAP:
Clustering overlaps through behavioral-shape features. Do not require cluster as a v1 predictor; use it downstream for interpretation and calibration diagnostics.

DURABLE_GOODS_CONSIDERATIONS:
Infrequent purchases, long normal gaps, high one-off equipment orders, accessory/replacement behavior, and sparse new-customer history make unbounded lifetime and standard non-contractual assumptions risky. Fixed-horizon expected value is safer.

MODEL_CANDIDATES:
Deterministic projection is a baseline; cohort expected value is the recommended v1; BG/NBD + Gamma-Gamma is research/later; supervised regression is viable after cutoff labels and baselines exist; two-stage activity x value is a likely future upgrade.

RECOMMENDED_V1_MODEL:
Cohort-based 12-month expected future revenue with empirical shrinkage, expected-orders auxiliary output if stable, and reliability buckets.

VALIDATION_STRATEGY:
Out-of-time cutoff validation: train/estimate on history before T, predict `[T, T + 12 months)`, compare to realized revenue/orders with MAE, median AE, rank correlation, decile lift, calibration by band, and top-N capture.

MANDATORY_BASELINES:
Historical 12m spend, lifetime average monthly spend times 12, recency-adjusted projection, AOV times recent order rate, RFM segment median future spend, and global/cohort averages.

POPULATION_POLICY:
Score `>=1` valid-order customers with explicit operational exclusions. Keep sparse customers with low reliability; use `>=2` history for richer timing features; exclude zero-order customers from purchase-history CLV v1.

MARGIN_DATA_READINESS:
Not ready. Current data supports revenue, not contribution margin. Margin CLV requires reliable historical COGS/margin data and reconciliation policy.

OUTPUT_CONTRACT:
Minimal `CustomerClvRecord` with `customerId`, `horizonMonths`, `expectedRevenueTaxIncl`, `currencyIsoCode`, `modelVersion`, `referenceTime`, `populationPolicyVersion`, `monetaryPolicyVersion`, `reliabilityBucket`, and optional `expectedOrders`.

SNAPSHOT_ARCHITECTURE:
Use immutable versioned CLV snapshots keyed by customer and reference time, with model/population/monetary versions, dataset and output checksums, and published/superseded lifecycle matching RFM/clustering/features.

CUSTOMER_INTELLIGENCE_INTEGRATION:
Add a nullable `clv` block later to `CustomerIntelligenceRow`, feature-snapshot-anchored and compatible-snapshot resolved like RFM/cluster.

COMMERCIAL_BUDGET_BOUNDARY:
Keep CLV separate from acquisition/retention/reactivation spend policy. Budget formulas belong to a later policy layer.

REUSABLE_COMPONENTS:
Reuse decimal/checksum/snapshot patterns, operational exclusions, feature snapshots, Customer Intelligence composition, analytical-order domain, and purchase behavior with adapters. Do not reuse RFM scores, clusters, affinity, or product wholesale price as CLV itself.

PROPOSED_CLV_SLICES:
CLV-A01 contracts; CLV-A02 historical dataset/backtest builder; CLV-A03 baselines; CLV-A04 cohort EV model; CLV-A05 validation; CLV-A06 persistence; CLV-A07 read model/API integration; CLV-A08 optional upgrade.

FILES_CHANGED:
`docs/audits/CUSTOMER-INTELLIGENCE-CLV-A00-existing-capability-and-readiness.md`

PRODUCTION_RUNTIME_CHANGED:
NO

NEXT_STEP:
CLV-A01 Domain Contracts, followed immediately by CLV-A02 Historical Dataset + Backtest Builder before any model or migration work.
