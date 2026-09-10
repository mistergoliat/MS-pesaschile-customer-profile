# CUSTOMER-PROFILE-COMMERCIAL-AFFINITY-A01.2 — Commercial Evidence Quantity

Status: implementation complete; operational validation required.

## Decision

`CUSTOMER_COMMERCIAL_AFFINITY_A01_2_QUANTITY_EVIDENCE_READY`

This slice carries gross purchased units from the read-only PrestaShop order-detail source into
the commercial-affinity population and published read models. It does not add refund or return
semantics; historical quantity is the gross sum of eligible `product_quantity` values.

`QUANTITY_SEMANTICS = GROSS_HISTORICAL_PURCHASED_UNITS`

## Quantity semantics

The source reader selects `od.product_quantity AS productQuantity`, accepts only positive safe
integers, and rejects null, zero, negative, fractional, non-finite, or unsafe values. Every
successful source read reports eligible-line count, min/max, and invalid-value counters. The
population builder sums quantities by customer/product and derives `quantityShare` against the
customer's total purchased units. `supportingUnits` is the sum of contributing product quantities
for each customer/axis/code row.

Repeated detail lines and repeated orders are additive for units. They remain distinct-product and
distinct-order semantics for their existing fields. Semantic statuses and `PRODUCT_FAMILY/OTHER`
exclusion policy are unchanged.

## Scoring and lineage invariants

The scoring formula, scoring policy version, affinity membership, score ordering, spend, recency,
product support, and exact order support are unchanged by quantity. Quantity is observability and
evidence only; it is not a score input, repeat/frequency proxy, or diversity signal.

The population dataset checksum includes source `productQuantity`; the affinity dataset checksum
includes row `supportingUnits`. Therefore quantity changes produce a new immutable dataset/snapshot
lineage while preserving the existing checksum canonicalization and fixed reference-time rules.

The before/after quantity fixture comparison reports `scoresChanged=0`, `membershipChanged=0`,
and `populationChanged=0`; only quantity evidence and the checksums changed.

## Persistence and consumers

Migration `015_add_customer_commercial_affinity_supporting_units.sql` adds nullable
`BIGINT UNSIGNED supporting_units` with a positive-value check. New snapshots require a non-null
positive value. Legacy rows remain readable as `supportingUnits: null` and are not backfilled.
The runtime affinity response, Customer Commercial Profile read model, HTTP affinity endpoint, and
audience preview affinity rows expose the field. Audience qualifiers and existing profile behavior
are unchanged.

## Operational validation required

Run the read-only production validation with one fixed UTC `AFFINITY_REFERENCE_TIME`, confirm the
quantity quality report has `invalidCount=0`, verify the complete eligible-line count against the
approved baseline, apply migration 015 only to the analytics database, build a dry-run snapshot,
and confirm score/membership/population invariants and batch-size determinism before publication.

Historical source query-plan/filesort debt and refund/return treatment remain separate follow-up
items; this implementation does not silently reinterpret them.
