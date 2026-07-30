# CP-R1-T10A Master Migration Plan

## Facts

Output: `master-migration-comparison-plan.json`. This is a **design-only** document — it has no database dependency and executes no query. `RFM_IDENTITY_MODE=prestashop_customer` must not query `master_customer` (`CP-R1-T10A-identity-mode.md`), and `master_customer` migration/population is not complete yet, so there is nothing to measure yet either way.

The plan defines the metrics a future 1:1 validation must collect (migrated customer count, `master_customer` count, `prestashop_customer_id` coverage, duplicate links, missing links, merges, splits, orders/spend covered by migration, per-identity R/F/M deltas, score-code change rate, population change) and the acceptance criteria a migration must clear:

- `prestashopCustomerIdCoverage >= 99.9%`;
- `duplicatePrestashopCustomerIdLinks == 0`;
- `validOrdersCoveredByMigration` delta `== 0` for 1:1 mapped identities;
- `grossMonetaryCoveredByMigration` delta `== 0` for 1:1 mapped identities;
- `scoreCodeChangeRate == 0` except for explicit, documented merges.

Methodology: run this same audit twice for the same `modelVersion`/`asOfDate`/window — once per identity mode — and diff `totalIdentityCandidates`, population buckets, and per-identity R/F/M outputs. Only aggregate diffs would be published; no individual identity pairs.

## Interpretations

These thresholds are deliberately strict (near-zero tolerance) because identity resolution errors compound silently: a duplicate link double-counts a customer's history across two `master_customer` rows, and a missed link silently drops a customer's order history from scoring — both are the kind of defect that would not be caught by looking at aggregate population size alone (a duplicate and a drop can offset each other's effect on `totalIdentityCandidates`). Requiring the *order and spend deltas* to be exactly zero for cleanly-mapped 1:1 identities, not just "close", is what makes this validation actually catch that class of bug instead of averaging it away.

`scoreCodeChangeRate == 0 except for explicit merges` is the criterion that protects downstream consumers (Sales Agent, CRM, Campaign Engine): a customer's RFM code should never change just because the identity layer changed underneath them, only because their actual purchasing behavior did, or because a documented merge combined two identities.

## Decisions

1. This document defines metrics and acceptance criteria only; it computes nothing.
2. The comparison methodology is "run twice, diff the outputs" — no new endpoint or persistence layer is proposed here.
3. All five acceptance criteria must pass before `ps_customer`-keyed provisional outputs are replaced by `master_customer`-keyed canonical ones in any downstream consumer.
4. Merges are the only accepted reason for a customer's score to change purely from an identity-mode switch; any other change is treated as a migration defect, not noise to average away.

## Follow-up

- Execute this plan once `master_customer` is fully populated with `prestashop_customer_id` links for this same PrestaShop instance.
- Feed any acceptance-criteria failure back into `CP-R1-T10A-prestashop-identity-quality.md`'s duplicate/shared-account findings — they are likely to explain a meaningful share of coverage gaps or duplicate links.
