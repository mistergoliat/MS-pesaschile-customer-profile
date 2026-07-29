# CP-R1-T09A Runtime Recommendation

## Facts

- Candidate `EXPLAIN FORMAT=JSON` outputs are written to `explains.json`.
- The script inventories relevant table indexes in `schema-inventory.json`.
- T09A does not create indexes, snapshots, cache, endpoints or migrations.
- Customer-specific EXPLAIN plans use `ps_orders.id_customer`, `ps_order_detail.id_order`, `ps_product.id_product`, `ps_product_shop` primary key, `ps_category_lang` primary key and `ps_manufacturer` primary key.

## Interpretations

- Customer-specific runtime reads are viable with joins from `ps_orders.id_customer` to `ps_order_detail.id_order`, then current catalog enrichment.
- `ps_category_product` must not participate in financial attribution for runtime preferences.
- Snapshot/cache should be deferred unless production latency proves direct reads unsafe.

## Recommendations

- Implement T09 as a separate endpoint in the future.
- Use two primary runtime queries: top raw categories and top brands.
- Default top limit: 10; maximum: 20.
- Compute `spendShare` over total valid line spend, including unclassified spend in the denominator.

## Decisions

1. Runtime mode is direct read, not snapshot.
2. No cache is introduced for T09.
3. Runtime uses two primary queries.
4. Top result ordering is gross spend descending, units descending, id ascending.
5. Top default is 10 and maximum is 20.
6. T09 uses a separate endpoint and does not expand `/profile`.
7. `spendShare` denominator includes classified and unclassified valid line spend.

## Follow-up

- Revisit indexes only if future endpoint latency or EXPLAIN plans show customer-specific reads are too expensive.
- Evaluate a snapshot only after runtime measurements exist.

