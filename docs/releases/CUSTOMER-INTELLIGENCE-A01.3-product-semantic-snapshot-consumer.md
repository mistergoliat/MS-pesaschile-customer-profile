# CUSTOMER-COMMERCIAL-AFFINITY-A01.3 — Product Semantic Snapshot Consumer

## Decision

Implemented a read-only compatibility adapter for the Product Semantic
Snapshot owned by `MS-pesaschile-catalog-service`. Customer Profile does not
calculate affinity, read purchases, persist affinity, or call a product-by-
product endpoint.

## Actual catalog contract

The inspected A00.5/A00.5.1 artifact is a filesystem snapshot with this
materialization:

```text
<snapshot-dir>/active.json
<snapshot-dir>/snapshots/<sha256-without-prefix>.json
```

`active.json` contains `snapshotId` and `schemaVersion`. The active immutable
snapshot envelope is schema `1` and contains `snapshotId`, `builtAt`,
`sourceProductCount`, `recordCount`, `ontologyVersion`, `ontologyHash`,
`classifierVersion`, `semanticChecksum`, `classificationCounts`, and
`records`.

Each record uses a string `productId`, one of the five classification statuses,
role-separated family/discipline/use-context tag arrays, and structured
provenance. Snapshot tags carry `axis`, opaque `code`, `confidence`, and
`ruleId`; confidence is present on tagged facts in the current contract.

The runtime primitive is a full in-memory read:
`getActiveSnapshotMetadata()` plus `getAllProductSemanticFacts()`. No new
per-product HTTP boundary is required.

## Adapter contract

`createProductSemanticSnapshotConsumer()` accepts an external snapshot source
and exposes `refresh()`, atomic `readActiveSnapshot()`, metadata, and all
normalized `ProductSemanticFact` values. The file source resolves the active
pointer once, reads the immutable named file, and checks that the pointer did
not change during the read.

The adapter converts string product IDs to positive safe integers, preserves
primary and secondary family roles separately, preserves disciplines and use
contexts independently, preserves confidence when present, sorts facts by
numeric `productId`, and computes a deterministic normalized consumer
checksum. It reuses the existing `assertValidProductSemanticFact` protections
without importing catalog ontology/classifier code.

## Current compatibility findings

The real active snapshot read on 2026-09-01 succeeded:

| Field | Value |
| --- | --- |
| snapshot ID | `sha256:79cef493e4f3bfdc3dffef8471bcde41bc96cd1a86e7344c85e7113569d84b12` |
| schema | `1` |
| built at | `2026-08-29T20:36:33.148Z` |
| ontology | `commercial-product-ontology-v3` |
| ontology hash | `f2de79fbedaee83202a133de5af1d86395470ddbf349103dfa2b3bd2f6bdb955` |
| classifier | `product-semantic-classifier-v1` |
| source semantic checksum | `dfc5c5b6fe774e20e64f271bace51c3b54dd6ee983cb8e71ce4bd166e993b97e` |
| normalized consumer checksum | `576f3cef473268ad04875e0fdffeee40c48687da2a4a4920500c5d908c46815e` |
| records | `2011` |
| serialized bytes | `2,173,169` |
| load + validation | `121.171 ms` |

Status counts are exactly:

```text
CLASSIFIED             1281
PARTIALLY_CLASSIFIED    400
OTHER                   317
EXCLUDED_NON_PRODUCT     13
NEEDS_REVIEW              0
```

The counts sum to all 2,011 materialized records and match the later A00.5
reporting, rather than the earlier 1,251/397/350 historical result. The
consumer cannot attribute that historical difference to source data versus
classifier/policy changes because those dimensions are not encoded as a
historical comparison; it does establish that the active snapshot is internally
reconciled and its own lineage is authoritative.

Representative current facts:

- `29`: `CLASSIFIED`, primary `BARBELL`.
- `1023`: `OTHER`, no family/discipline/use-context evidence.
- `1619`: `OTHER`, `USE_CONTEXT=COMMERCIAL_GYM` preserved.
- `2134`: `CLASSIFIED`, primary `PLATE_LOADED_MACHINE`, secondary
  `CABLE_MACHINE`, `USE_CONTEXT=HOME_GYM`.
- `332`: `PARTIALLY_CLASSIFIED`, primary `WEIGHT_PLATE`.
- `444`: `EXCLUDED_NON_PRODUCT`, no semantic axes.

Of the 2,011 normalized facts, 1,721 contain at least one confidence-tagged
semantic tag and 290 contain no semantic tags. No tagged current fact was
missing confidence metadata.

## Status and evidence policy

`CLASSIFIED` maps all available axes. `PARTIALLY_CLASSIFIED` maps only the
axes actually present. `OTHER` is preserved as residual product truth and is
never converted into a `PRODUCT_FAMILY/OTHER` affinity code; legitimate
discipline/use-context facts remain present for the future population builder.
`EXCLUDED_NON_PRODUCT` and `NEEDS_REVIEW` remain explicit non-contributing
facts. Unknown statuses fail validation.

Missing confidence is represented as absent/unknown rather than fabricated.
The normalized DTO remains compatible with the existing neutral missing-
confidence behavior.

## Validation and failure modes

The adapter rejects invalid product IDs, unsupported schema/status values,
malformed metadata, duplicate product IDs, duplicate tags, primary/secondary
family collisions, wrong tag axes, and mixed ontology version/hash lineage.

It exposes explicit errors for:

- `NO_ACTIVE_PRODUCT_SEMANTIC_SNAPSHOT`
- `PRODUCT_SEMANTIC_SNAPSHOT_UNAVAILABLE`
- `MALFORMED_PRODUCT_SEMANTIC_SNAPSHOT`
- `UNSUPPORTED_PRODUCT_SEMANTIC_CONTRACT_VERSION`
- `ONTOLOGY_LINEAGE_MISMATCH`

For A01.4, a purchased product absent from this full snapshot means
`NO_SEMANTIC_EVIDENCE`; it does not mean `OTHER`, negative affinity, or a
whole-customer error. A product present as `OTHER` remains distinct from an
absent product.

## Ownership boundary and handoff

Catalog Service remains the owner of product truth. Customer Profile consumes
normalized facts only and does not import catalog ontology registries,
classifier implementations, regexes, raw product parsing, or catalog
transport details into the affinity domain.

No Customer Commercial Profile integration was made; A02's affinity
placeholder remains unchanged. No production runtime wiring, HTTP endpoint,
customer-order read, persistence, or Copilot/Audience change was made.

Next: `CUSTOMER-COMMERCIAL-AFFINITY-A01.4`, the exact-order-grain affinity
population builder.
