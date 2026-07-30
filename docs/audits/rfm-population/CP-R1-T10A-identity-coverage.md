# CP-R1-T10A Identity Coverage

## Facts

The canonical path is:

```text
master_customer -> prestashop_customer_id -> ps_customer -> ps_orders.id_customer
```

The audit measures:

- masters with PrestaShop link;
- masters without link;
- duplicate `prestashop_customer_id` links;
- PrestaShop customers with valid orders;
- guest or `id_customer = 0` orders;
- valid orders and gross spend covered by canonical identity;
- valid orders and gross spend excluded because identity is not consolidated.

No document should publish emails, RUT, names, phones, addresses, or individual customer/order IDs.

## Interpretations

RFM scores must be attached to a stable public identity. Scoring raw PrestaShop customers first and resolving later risks duplicate or orphaned customer behavior entering percentiles.

## Decisions

- T10 v1 calculates only for canonical `masterCustomerId` records with exactly one confirmed `prestashop_customer_id`.
- Masters without link are `no_valid_purchases` only if the canonical model has no valid purchase history attached.
- PrestaShop customers with valid orders but no canonical master are excluded from the snapshot and reported as identity coverage pending.
- Duplicate `prestashop_customer_id` links abort snapshot publication until resolved or quarantined.

## Follow-up

- After a live audit run, record aggregate percentages of customers, orders, and gross spend excluded by identity coverage.
- Coordinate identity merge invalidation with the future snapshot pipeline.
