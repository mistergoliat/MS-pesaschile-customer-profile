# CP-R1-T09A Product Classification Coverage Audit

## Facts

- Scope: read-only audit of valid purchase lines where `ps_orders.valid = 1`.
- Historical purchase authority: `ps_order_detail`.
- Current catalog enrichment: `ps_product`, `ps_product_shop`, `ps_category`, `ps_category_lang`, `ps_category_product`, `ps_manufacturer`.
- Live aggregate outputs are generated under `scripts/audits/product-classification/outputs/` and ignored by Git.
- Observed universe: 79194 valid orders, 168863 lines, 276152 units, 1705 products, 1944 variants, 44345 customers.
- Observed valid-line gross spend: `10649042653.235700`.
- Deleted products account for 4047 lines, 10232 units, 416 products and `502974620.500000` gross spend.

## Interpretations

- `ps_order_detail` keeps deleted-product history; `LEFT JOIN ps_product` is required so historical spend is not lost.
- `ps_orders.total_paid_tax_incl` and `ps_order_detail.total_price_tax_incl` are intentionally reconciled, not forced to match.
- Category and manufacturer names are public catalog metadata; customer and order identifiers are never written to documentation.
- Category coverage is technically high at 95.28% of valid-line gross spend, but the classified category ranking collapses into one default category: categoryId 2, `CATEGORÍAS`, with `10146068032.735700` spend, 164816 lines and 1289 distinct products.
- Brand coverage is acceptable for T09 observed preferences at 85.05% of valid-line gross spend.

## Recommendations

- T09 runtime can expose raw category evidence.
- Clustering must not use categoryId 2 as the primary feature.
- A curated and versioned commercial taxonomy is required before clustering.
- `preferredProductType` remains outside T09.

## Decisions

1. Product category authority is `ps_product_shop.id_category_default` for the operative catalog shop.
2. The operative catalog shop source is the required `PRESTASHOP_CATALOG_SHOP_ID` environment variable.
3. Catalog names use the configured catalog `id_lang` already used by the audit for `ps_category_lang`.
4. Default category is the only category source for runtime financial aggregates.
5. All categories from `ps_category_product` are not used for spend attribution.
6. Deleted products remain in historical totals and are classified as unclassified for category and brand coverage.
7. Category coverage is accepted for T09 raw category output: 95.28% of valid-line gross spend.
8. Brand coverage is accepted for T09 observed brand output: 85.05% of valid-line gross spend.
9. `spendShare` uses total valid line spend as denominator, including unclassified spend.
10. Unclassified spend is exposed separately and is never redistributed.
11. Top category and brand ordering is gross spend descending, units descending, then id ascending.
12. Future runtime top defaults to 10 items and caps at 20.
13. Runtime direct reads are acceptable for T09; no snapshot or cache is introduced.
14. Product preferences belong in a separate endpoint, not `/profile`.
15. A curated commercial taxonomy is mandatory before clustering.
16. Future clustering features are `rawCategoryId`, `commercialFamilyId`, `manufacturerId`, `spendShare`, `diversity` and `unclassifiedShare`.

## Follow-up

- Re-run the audit after setting `PRESTASHOP_CATALOG_SHOP_ID` in each environment.
- Build the curated commercial taxonomy in a later task.
- Re-check EXPLAIN plans when T09 runtime query limits and route traffic are known.
