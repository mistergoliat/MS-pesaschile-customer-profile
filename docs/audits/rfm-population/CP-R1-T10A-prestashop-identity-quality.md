# CP-R1-T10A PrestaShop Identity Quality

## Facts

Output: `prestashop-identity-quality.json`. Every field is a `COUNT`/`SUM` aggregate; no email, name, phone, RUT, address, individual account id, or order reference is ever selected, logged, or written to disk. Queries that must reference `email` internally (to compute empty/invalid/duplicate counts) do so only inside `CASE`/`REGEXP`/`GROUP BY`/`JOIN` expressions that collapse to a count before leaving the database — see `lib/pii-guard.ts` for the two independent guards that enforce this (SQL-text guard for writes/`SELECT *`, result-content guard for PII field names and email-shaped values).

The audit measures, in aggregate, over `ps_customer` and `ps_orders`:

- total `ps_customer` rows, customers with/without a valid order;
- empty emails, invalid-format emails, test/internal-pattern emails (`%test%`, `%prueba%`, `%demo%`, `%noreply%`, `example.com`, …);
- normalized (`LOWER(TRIM(email))`) duplicate email groups, accounts inside those groups, and the share of valid orders/gross spend they account for;
- accounts with lifetime valid orders over 10 / 50 / 100 / 500 / 1000;
- deleted, inactive, guest, and company-name-present account counts;
- orders with `id_customer = 0`;
- a diagnostic-only "potential shared/institutional account" heuristic (lifetime valid orders > 50 **and** average orders-per-distinct-order-day > 2).

## Interpretations

Duplicate normalized emails and accounts with implausibly high lifetime order counts are exactly the kind of identity noise that a future `master_customer` mirror migration needs to either resolve (merge) or explicitly exclude — measuring them now, before that migration exists, gives the migration a real baseline to validate coverage against (see `CP-R1-T10A-master-migration-plan.md`).

The "potential shared account" heuristic is a diagnostic signal, not a determination of fact: a high order count with dense same-day activity is *consistent with* a point-of-sale, wholesale, or integration account, but this audit does not have access to session, device, or address-diversity data that would make that a confirmed classification. It exists to flag accounts worth a manual operational review, not to justify excluding them unilaterally from RFM.

Because `company`/`siret` fields are essentially unused in this dataset (see `CP-R1-T10A-commercial-validity.md` answers.shouldB2BB2CBeSeparated), they are not a reliable B2B signal on their own.

## Decisions

1. Identity-quality queries are aggregate-only; the shared strict SQL guardrail (`assertSafeSql`, forbids the literal `email` token anywhere) is deliberately **not** loosened — a second, independent guardrail (`assertAggregateOnlySql` + `assertNoPiiInResult`) is used only for the handful of queries that need to reference `email` to aggregate it.
2. Lifetime order-count thresholds (10/50/100/500/1000) are reported here as identity-quality signals; they are independent from the window-scoped Frequency models used for RFM scoring (`CP-R1-T10A-frequency-threshold-simulation.md`).
3. Duplicate-email accounts and shared-account-heuristic matches are **not** merged, deduplicated, or excluded from the published population by this audit — it has no write capability and makes no such decision unilaterally.
4. `guestOrZeroCustomerOrders` (orders with `id_customer = 0`) is measured but excluded from every population dataset already, consistent with prior T10A behavior.

## Follow-up

- Route confirmed test/internal/duplicate accounts to an operational cleanup process before they influence a frozen `rfm-v1` cut, once one exists.
- Re-evaluate the shared-account heuristic against `master_customer` once available — cross-shop and cross-address identity resolution there may explain some of these accounts without further guessing.
