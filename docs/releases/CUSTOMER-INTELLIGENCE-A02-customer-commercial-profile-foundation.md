# CUSTOMER-INTELLIGENCE-A02 — Customer Commercial Profile Foundation

## Purpose and decision

`customer-commercial-profile-v1` is a deterministic, read-only composition
layer for the current commercial evidence of one PrestaShop customer. It is a
bounded semantic projection, not a predictive model, synthetic score, budget,
recommendation engine, or replacement for Customer Intelligence.

## Contract

`GET /v1/customers/:customerId/commercial-profile` returns the existing API
status envelope with `contractVersion`, `customerId`, and `profile`.

The profile contains nullable `rfm`, `behavioralCluster`, and `clv` blocks,
plus `commercialAffinity: null`. The affinity placeholder is intentionally
marked `availability.commercialAffinity: NOT_IMPLEMENTED`.

RFM preserves the analytical meaning of recency in days, order frequency, tax-
inclusive monetary value as a decimal string, canonical scores, RFM code, and
the existing segment fields. It does not derive a new label.

The cluster block exposes the persisted cluster id, canonical interpretation
label, and model version. It does not infer labels or reassign customers.

The CLV block exposes expected future tax-inclusive revenue, optional expected
orders, horizon, currency, and `SPARSE | SUPPORTED` estimate support. Internal
cohort diagnostics are excluded. Monetary values remain decimal strings.

## Availability and partial composition

Each block independently reports `AVAILABLE`, `NOT_IN_POPULATION`, or
`UNAVAILABLE`. `NOT_IMPLEMENTED` is reserved for the affinity placeholder.
Missing rows are not converted to zero or negative information. A valid
customer can therefore receive an empty profile, such as when all current
analytical inputs are unavailable, while an unknown customer remains a 404.

The service resolves the customer identity through `prestashop_customer` and
composes the existing RFM, cluster, and CLV application readers in parallel.
One reader failure only makes that block `UNAVAILABLE`; other blocks remain
usable.

## Identity, provenance, and freshness

`customerId` is always the PrestaShop customer id (`prestashop_customer`), not
`master_customer.id`. Each available block retains its own snapshot id,
reference time, and calculation/model version. `generatedAt` is composition
time only. `oldestReferenceTime` and `newestReferenceTime` are metadata and do
not claim one common analytical as-of time.

Customer Intelligence remains the general analytical read model and raw
analytical composition boundary. Customer Commercial Profile is its bounded
commercial consumer projection; it does not create a competing source of
truth or depend on HTTP.

## Batch readiness

The internal service exposes `getByCustomerIds`, deduplicates ids, preserves
first-seen ordering, and enforces a maximum batch of 100 ids. It is intended
for future Audience Engine and Customer Explorer consumers; no unrestricted
population HTTP endpoint or audience rules are introduced here.

## Test-artifact debt

The A05 unit contract test no longer requires the locally generated
`artifacts/clv/a04-3-frozen-candidate.json`. It uses a small committed fixture
for the fields it verifies. Research/acceptance scripts may still consume the
artifact explicitly when those workflows are run.

## Validation and next step

The focused profile contract/composition and HTTP tests cover complete and
partial profiles, unavailable components, independent lineage, identity,
decimal preservation, affinity status, batch bounds, and endpoint validation.

Next: integrate Customer Commercial Affinity when A01.3+ is ready, then expose
the profile to Audience Engine, Customer Explorer, and Copilot consumers.
