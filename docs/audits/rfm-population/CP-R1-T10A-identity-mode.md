# CP-R1-T10A Identity Mode

## Facts

`ps_customer.id_customer` is not the canonical customer identity today. `master_customer.prestashop_customer_id` is intended to become that identity through a future 1:1 mirror migration, which is not complete yet (see `docs/audits/rfm-population/CP-R1-T10A-master-migration-plan.md`).

The audit script requires an explicit, valid identity mode:

```text
RFM_IDENTITY_MODE=prestashop_customer
RFM_IDENTITY_MODE=master_customer
```

There is no default. A missing or unrecognized value aborts the run before any query executes, the same way a missing `RFM_AS_OF_DATE` already does.

In `prestashop_customer` mode the script:

- does not require CRM credentials;
- does not connect to the CRM database;
- does not query `master_customer`;
- uses `ps_customer.id_customer` directly as the population key;
- marks every output with provisional identity metadata;
- writes only ignored, non-productive aggregate files under `outputs/`.

In `master_customer` mode the script behaves as the original T10A audit did: it requires CRM credentials, connects to CRM, and scores only `masterCustomerId` records with one confirmed `prestashop_customer_id`.

Every output produced by this script now carries:

```json
{
  "identityMode": "prestashop_customer",
  "identityAuthority": "prestashop_customer_provisional",
  "identityCanonical": false,
  "migrationPending": true
}
```

(or the `master_customer` / `master_customer_canonical` / `true` / `false` equivalents in the other mode).

`population-summary.json`'s population-count field was renamed from `totalCanonicalCandidates` to `totalIdentityCandidates`, because "canonical" is not an accurate claim while `identityMode=prestashop_customer`.

## Interpretations

Making the identity mode an explicit, required input — rather than an implicit assumption baked into the script — is what makes it possible to run RFM mechanics (distributions, scoring, temporal stability) against `ps_customer` today without any output being mistaken for a canonical, production-ready result. The mode is a statement about *what the population key means*, not about *how good the data is*; `prestashop_customer` mode can still surface real, useful statistical and commercial findings, they are simply attributed to a provisional identity.

Keeping `master_customer` mode's behavior unchanged (rather than merging the two code paths) avoids retroactively changing the semantics of the original, already-reviewed T10A canonical-identity path.

## Decisions

1. Identity mode is explicit and required: `RFM_IDENTITY_MODE=prestashop_customer|master_customer`, no default, no inference from other env vars.
2. `prestashop_customer` mode never opens a CRM connection and never queries `master_customer`, even if CRM credentials happen to be present in the environment.
3. Every JSON output produced by the script carries `identityMode`, `identityAuthority`, `identityCanonical`, `migrationPending`.
4. `totalCanonicalCandidates` is renamed to `totalIdentityCandidates` everywhere in the audit's outputs and decisions text.
5. `master_customer` mode keeps the original T10A canonical-identity behavior unchanged.
6. This run (2026-07-29) uses `RFM_IDENTITY_MODE=prestashop_customer`; nothing it produces is asserted canonical.

## Follow-up

- Once `master_customer` migration/population is complete, re-run this audit with `RFM_IDENTITY_MODE=master_customer` for the same `asOfDate` and diff against this run using the plan in `CP-R1-T10A-master-migration-plan.md`.
- Do not wire a future RFM endpoint to `prestashop_customer` mode outputs without an explicit, separate decision — see that same plan's acceptance criteria.
