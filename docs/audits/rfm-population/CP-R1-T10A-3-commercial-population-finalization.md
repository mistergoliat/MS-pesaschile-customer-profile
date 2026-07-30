# CP-R1-T10A-3 Commercial Population Finalization

## Facts

This audit closes the commercial population that feeds `rfm-v1-provisional`, building on CP-R1-T10A (population framework) and CP-R1-T10A-2 (identity mode, identity quality, frequency outlier, multishop, temporal stability). It runs under `RFM_IDENTITY_MODE=prestashop_customer` with the same provisional metadata (`identityAuthority: "prestashop_customer_provisional"`, `identityCanonical: false`, `migrationPending: true`) on every output.

Four commercial-population candidates are built and compared in `commercial-population-comparison.json`:

- **P0 — all shops**: every customer/order valid across shops 1, 2 and 3, pooled. Evidence and diagnostic only — never assumed to be the productive population.
- **P1 — main commercial shop**: `id_shop = 1` only, filtered server-side (`lib/sql.ts` `mainShopActivePopulationSql`).
- **P2 — operational shops**: `id_shop IN (2, 3)`, combined per customer.
- **P3 — main shop excluding operational anomalies**: P1 minus accounts flagged by `operational-account-v1` (`CP-R1-T10A-3-operational-account-policy.md`).

Two time horizons stay separated throughout, unchanged from T10A/T10A-2:

- **Lifetime**: `firstValidOrderAt`, `lastValidOrderAt`, `lifetimeValidOrderCount`, `lifetimeGrossMonetaryTaxIncl`, lifecycle, historical-inactive, reactivation context.
- **Rolling 12 months**: `windowStartInclusive`/`windowEndExclusive`, `recencyDays`, `frequencyOrders`, `grossMonetaryTaxIncl`, the active population, RFM scoring.

RFM scores are computed only on the rolling-window population, never on lifetime totals.

**Correction applied after the follow-up audit:** every "lifetime" SQL aggregate (`populationDatasetSql`, `shopScopedLifetimePopulationSql`, `shopLifetimeTotalsSql`, `crossShopCustomerCountSql` — all in `lib/sql.ts`) is now bounded by `date_add < windowEndExclusive`. Before this fix, "lifetime" silently included any order the live database happened to hold at query time, including orders dated after `asOfDate` — re-running the identical `RFM_AS_OF_DATE` at a later wall-clock time produced different `historicalInactive`/`totalIdentityCandidates`/lifetime-total figures, which contradicted the reproducibility principle this whole audit is built on. "Lifetime" now means, unambiguously, cumulative history through `asOfDate` — never history available "as of whenever this query executes." An identity whose only valid order(s) are dated on/after `windowEndExclusive` now classifies as `no_valid_purchases` (not `historical_inactive`) and is counted separately as `futureOnlyCustomersExcluded` in `population-summary.json` and `historical-inactive-analysis.json`.

`historical-inactive-analysis.json` no longer uses an implicit population: it reports `allShopsHistoricalInactive` (`populationScope: "P0_all_shops"`, for lifecycle-global reporting) and `commercialShopHistoricalInactive` (`populationScope: "P1_main_commercial_shop"`, for the reactivation analysis that actually matches `rfm-v1-provisional`'s scored population) side by side, per `reactivationRecommendation`.

## Interpretations

P0 exists to show what "RFM over all customers" would look like — the audit brief this task closes explicitly rejects that as the productive population, because it mixes commercial channels with materially different order cadence and lets a single operational account dominate the tail (see CP-R1-T10A-2's frequency-outlier finding). P1 is the population this audit closes on for `rfm-v1-provisional`; P2 and P3 exist to make that choice falsifiable — if P1 turned out statistically indistinguishable from P0, or if excluding operational anomalies changed nothing, that would undercut the decision. It does not: see `CP-R1-T10A-3-multishop-decision.md` and `CP-R1-T10A-3-operational-account-policy.md` for the evidence.

## Decisions

1. Productive commercial population for `rfm-v1-provisional`: **P1** (shop 1 only).
2. P0 (all shops) is retained as a diagnostic/comparison population, never treated as productive.
3. P2 (shops 2/3) is analyzed separately, not scored under `rfm-v1` B2C rules.
4. P3 (P1 minus operational anomalies) is reported for sensitivity, not adopted as the default population — see `operational-account-sensitivity.json` for whether it differs materially from P1.
5. Lifetime and rolling-12-month horizons remain structurally separate; lifetime never feeds an R/F/M score directly.
6. No named commercial segment is introduced by this closure.

## Follow-up

- Re-run this comparison after `master_customer` is populated (`RFM_IDENTITY_MODE=master_customer`) to confirm P1's shape is stable under canonical identity — see `CP-R1-T10A-3-rfm-v1-provisional-manifest.md`'s `masterMigrationGate`.
- Revisit P2 as the seed population for a dedicated operational/wholesale model, once one is scoped.

## All 24 decisions closed by CP-R1-T10A-3

Mirrors `t10a3-audit-result.json`'s `decisionsClosed`; short answers only, see the referenced docs/outputs for the reasoning.

1. Población comercial principal: P1 (id_shop = 1).
2. Shops incluidos: shop 1 únicamente.
3. Shops excluidos: shops 2 y 3, conservados para lifetime/lifecycle.
4. Tratamiento de clientes multishop: Simulación A — métricas solo con órdenes shop 1 (`CP-R1-T10A-3-multishop-decision.md`).
5. Tratamiento de cuenta operacional extrema: diagnosticada y comparada, ver `operational-account-sensitivity.json`.
6. Política de cuentas operacionales: `operational-account-v1`, tres señales agregadas en AND (`CP-R1-T10A-3-operational-account-policy.md`).
7. Método R: frozen boundaries, recalibración periódica (`CP-R1-T10A-3-rfm-method-finalization.md`).
8. Límites/dinámica R: boundaries fijos calibrados en el asOfDate de esta ejecución, publicados en el manifiesto.
9. Modelo F: Model B, `frequencyThresholdVersion: "rfm-v1-f1"`.
10. Límites F: F1=1, F2=2, F3=3-4, F4=5-9, F5=10+.
11. Método M: frozen boundaries, misma cadencia que R.
12. Límites/dinámica M: boundaries fijos calibrados en el asOfDate de esta ejecución, publicados en el manifiesto.
13. Política de empates: same_value_same_score, sin NTILE, sin cambios.
14. Horizonte rolling 12m: sin cambios respecto a T10A/T10A-2.
15. Uso lifetime: separado del scoring RFM activo, solo lifecycle y contexto.
16. Historical inactive: fuera de percentiles activos, `status="historical_inactive"`, `scores=null`; reportado en dos scopes explícitos, `allShopsHistoricalInactive` (P0) y `commercialShopHistoricalInactive` (P1) — nunca implícito (`historical-inactive-analysis.json`). Identidades cuya única orden es futura respecto a `asOfDate` clasifican `no_valid_purchases` y se cuentan aparte como `futureOnlyCustomersExcluded`.
17. Estabilidad aceptable: ver `stabilityVerdict` en `temporal-stability-final.json` (`CP-R1-T10A-3-temporal-stability.md`).
18. Frecuencia de recalibración: propuesta trimestral para boundaries R/M.
19. Frecuencia de snapshots: diaria para el cálculo de scores; los boundaries no cambian entre recalibraciones.
20. Manifiesto rfm-v1 provisional: publicado (`CP-R1-T10A-3-rfm-v1-provisional-manifest.md`).
21. Gate de master_customer: blocked.
22. Performance: ver `finalization-performance.json` y `query-log.json`.
23. Necesidad de índice futuro: ninguno requerido con el volumen actual.
24. Fuera de T10: segmentos comerciales nombrados, endpoint runtime, snapshot productivo, migraciones/backfill, gate master_customer abierto.
