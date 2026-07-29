# CP-R1-T09A Manufacturer Coverage

## Facts

- Brand authority is `ps_product.id_manufacturer -> ps_manufacturer`.
- `id_manufacturer = 0`, missing manufacturer rows, empty names and deleted products are unclassified.
- Manufacturer rankings are aggregate only and contain no customer/order rows.
- Brand coverage: 143005 classified lines, 215176 classified units, 1183 classified products and `9056564522.210500` classified spend.
- Brand unclassified: 25858 lines, 60976 units, 522 products and `1592478131.025200` spend.
- Brand spend coverage is 85.05% of total valid-line gross spend.

## Interpretations

- Brand coverage is good enough for observed brand preferences in T09.
- Brand remains current-catalog enrichment, while purchase authority stays in `ps_order_detail`.
- Duplicate or generic manufacturer names can still affect clustering quality.

## Recommendations

- Expose raw manufacturer preferences in T09.
- Keep unclassified brand spend separate.
- Use manufacturer features in clustering only alongside taxonomy and unclassified-share signals.

## Decisions

1. Use `ps_product.id_manufacturer -> ps_manufacturer` as brand authority.
2. Accept 85.05% brand spend coverage for T09 observed brand output.
3. Treat `id_manufacturer = 0`, deleted products and missing/empty manufacturer names as unclassified.
4. Keep unclassified brand spend separate.
5. Future clustering features include `manufacturerId`, `spendShare`, `diversity` and `unclassifiedShare`.

## Follow-up

- Review manufacturer aliases and generic/internal names before clustering.
- Add brand alias mapping only in a later taxonomy or clustering preparation task.

