# CP-R1-T09A Category Coverage

## Facts

- Category authority is `ps_product_shop.id_category_default` for the shop configured by `PRESTASHOP_CATALOG_SHOP_ID`.
- `ps_category_product` is audited for multiplicity and default-category consistency only.
- `ps_category_product` is not used to attribute spend.
- Category coverage: 164816 classified lines, 265920 classified units, 1289 classified products and `10146068032.735700` classified spend.
- Category unclassified: 4047 lines, 10232 units, 416 products and `502974620.500000` spend.
- Category spend coverage is 95.28% of total valid-line gross spend.
- The only observed classified category in the ranking is categoryId 2, categoryName `CATEGORÍAS`, totalSpentTaxIncl `10146068032.735700`, lines 164816, distinctProducts 1289.

## Interpretations

- The category default presents high technical coverage, but not enough commercial granularity for fine clustering or purchase-family definition.
- categoryId 2 is a catalog container, not a useful commercial preference by itself.
- All-category attribution would create double counting unless spend were split proportionally, so it remains out of T09.

## Recommendations

- T09 runtime can expose raw category evidence.
- Clustering must not use categoryId 2 as the primary feature.
- A curated and versioned commercial taxonomy is required before clustering.
- preferredProductType remains outside T09.

## Decisions

1. Use `ps_product_shop.id_category_default` from the operative catalog shop as category authority.
2. Use `PRESTASHOP_CATALOG_SHOP_ID` as the explicit shop source.
3. Use configured catalog `id_lang` for category labels.
4. Use default category for runtime financial aggregates.
5. Do not use all categories from `ps_category_product` for spend.
6. Treat deleted products as unclassified.
7. Accept 95.28% category spend coverage for raw category output.
8. Keep unclassified category spend separate.
9. Require curated commercial taxonomy before clustering.

## Follow-up

- Build and version the commercial taxonomy in a later task.
- Review category exclusions as taxonomy inputs, not as automatic keyword rules.
