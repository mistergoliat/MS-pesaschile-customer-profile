# Product Semantics — Ownership Moved to catalog-service

Status: **OWNERSHIP TRANSFERRED**

Product Semantics (commercial product ontology + product semantic classification) is no longer
owned or implemented in `customer-profile`. Ownership moved to `MS-pesaschile-catalog-service`.

## What moved

- Commercial product ontology (registry, versioning, hashes)
- Product semantic classifier
- Product semantic provenance (evidence/rule tracking)
- Non-product exclusion policy
- Product semantic CLI/tooling and golden-set regression

`customer-profile` no longer owns any ontology or classification logic, and must not recreate it
locally. Any future customer-affinity work must consume product semantic *facts* from
`catalog-service` (productId, ontology version/hash, classification status, family/discipline/use-context
tags) — never product regexes, category trust rules, or raw classification logic.

## What stays here

`CUSTOMER-INTELLIGENCE-R2-A00` through `A00.1C` originated in this repo as discovery/audit work:
dataset exploration, ontology discovery, golden-set methodology, and the ontology review closure
that produced the `SIMPLIFIED_ONTOLOGY_READY` decision. Those audit reports and their source
fixtures remain here as historical provenance — see `docs/audits/CUSTOMER-INTELLIGENCE-R2-A00*`.

Implementation ownership from `A00.2` onward (registry, classifier, CLI, and their release docs)
moved to `catalog-service`.

## Current state

The current catalog ontology is `commercial-product-ontology-v3`, validated and running exclusively
in `catalog-service`. See `docs/audits/CUSTOMER-PROFILE-ARCHITECTURE-SEPARATION-AUDIT.md` for the
separation audit that preceded this cleanup.
