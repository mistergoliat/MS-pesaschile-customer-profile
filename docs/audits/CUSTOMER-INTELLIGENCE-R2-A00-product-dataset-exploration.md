# CUSTOMER-INTELLIGENCE-R2-A00 Product Dataset Exploration

## Status

Implementation status: complete in this repository (`MS-pesaschile-customer-profile`).

Extraction status: completed against PrestaShop shop `1`, selected because the primary Catalog Service at `C:\Users\Goli\Pesas Chile\MS\MS-Stock\services` enforces `PRESTASHOP_SHOP_ID=1` in `src/shared/config.ts`.

Generated product universe:

- Total exploration products: 2011
- Current `ps_product` catalog rows: 1550
- Historical valid-order-only products missing from current `ps_product`: 461
- Active current products: 889
- Inactive current products: 661
- Products with unknown active status because they are historical-only: 461
- Products without valid-order sales: 274
- Products with combinations: 134
- Products with relationship evidence: 847

No ontology, Home Gym, CrossFit, Powerlifting, classifier, LLM tagging, customer affinity, T03 affinity fields, or Audience Engine work was performed.

## Source Systems

Primary source of truth: PrestaShop RDS, read-only, using configured `PRESTASHOP_DB_*` credentials and detected/validated table prefix.

Catalog Service reuse audit: completed at `C:\Users\Goli\Pesas Chile\MS\MS-Stock\services`.

Reviewed components:

- `src/infrastructure/catalog/mysqlCatalogExploreDataReader.ts`
- `src/infrastructure/catalog/mysqlCatalogCommercialDataReader.ts`
- `src/infrastructure/recommendation/fileProductRelationshipSnapshotStore.ts`
- `src/domain/recommendation/relationship-engine/publication/contracts.ts`
- `src/domain/recommendation/relationship-engine/contracts.ts`

Reuse decision:

- Do not use `MySqlCatalogExploreDataReader` as the A00 source reader because it is a runtime/discovery reader: it strips HTML, uses `description_short`, applies discovery exclusions, is scoped to explore/search behavior, and does not preserve the full raw one-to-many evidence required here.
- Reuse its observed shop/language policy as evidence: Catalog Service fixes PrestaShop shop `1` and language `1`.
- Reuse the relationship snapshot file contract by allowing `PRODUCT_RELATIONSHIP_SNAPSHOT_DIR` to point at the Catalog Service snapshot store.

Relationship enrichment was populated from:

```text
C:\Users\Goli\Pesas Chile\MS\MS-Stock\services\data\relationship-snapshots
```

Active snapshot:

```text
sha256:e844509c4059b8bc434fd3ecd505979e39ee8c549946f56197e57177ae5b22d7
```

Relationship rows read: 5770.

Customer Profile reuse: the existing valid-order policy is reused conceptually: commercial aggregates are derived only from `ps_orders.valid = 1`. No cross-service runtime dependency is introduced.

## Extraction Design

Command:

```bash
npm run product:exploration:export -- --output-dir=<artifact-dir>
```

Default artifact directory:

```text
scripts/audits/product-intelligence-exploration/outputs/product-intelligence-exploration/
```

The directory is git-ignored. The CLI is standalone and not wired into HTTP runtime.

Safety controls:

- Static SQL guard rejects write/DDL keywords, `SELECT *`, and direct PII columns.
- Runtime grant guard requires `SELECT`/`USAGE` only.
- Runtime load guard aborts if the database is already busy.
- All SQL reads are bounded by `PRODUCT_EXPLORATION_QUERY_TIMEOUT_MS` or the default 60000 ms timeout.
- No DDL/DML statements are generated.
- Customer data is used only as `COUNT(DISTINCT o.id_customer)`.

## Required Environment

Required:

- `PRESTASHOP_DB_HOST`
- `PRESTASHOP_DB_USER`
- `PRESTASHOP_DB_PASSWORD`
- `PRESTASHOP_PRODUCT_LANG_ID` or `PRESTASHOP_ORDER_STATE_LANG_ID`

Required for multishop catalogs:

- `PRESTASHOP_CATALOG_SHOP_ID`

Optional:

- `PRESTASHOP_DB_PORT`
- `PRESTASHOP_DB_NAME`
- `PRESTASHOP_DB_PREFIX`
- `PRODUCT_EXPLORATION_QUERY_TIMEOUT_MS`
- `PRODUCT_EXPLORATION_MANY_CATEGORY_THRESHOLD`
- `PRODUCT_RELATIONSHIP_SNAPSHOT_PATH`
- `PRODUCT_RELATIONSHIP_SNAPSHOT_DIR`

If `PRESTASHOP_CATALOG_SHOP_ID` is absent, the exporter inspects `product_shop`. It proceeds only when exactly one shop exists; otherwise it aborts with shop candidates.

For this execution, the multishop candidates were:

- shop `1`: 1549 product-shop rows
- shop `3`: 1525 product-shop rows
- shop `2`: 1523 product-shop rows

The final run used shop `1`.

## Source Table Map

| Domain | Database/schema | Table | Columns | Join | Cardinality | Role | PII | Export strategy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Product identity | PrestaShop RDS / configured DB | `<prefix>product` | `id_product`, `reference`, `active`, `visibility`, `id_manufacturer`, `id_category_default`, `price`, `wholesale_price`, `condition`, `weight`, `width`, `height`, `depth`, `available_for_order`, `show_price`, `cache_default_attribute`, `date_add`, `date_upd` | `id_product` | One row per base product | Base product identity and numeric attributes | No | Direct |
| Product shop override | PrestaShop RDS / configured DB | `<prefix>product_shop` | `id_product`, `id_shop`, `active`, `visibility`, `id_category_default`, `price`, `wholesale_price`, `date_add`, `date_upd` | `id_product + configured id_shop` | Zero/one per product for configured shop | Shop-specific storefront/default-category fields | No | Direct |
| Product text | PrestaShop RDS / configured DB | `<prefix>product_lang` | `id_product`, `id_lang`, `id_shop`, `name`, `description_short`, `description`, `link_rewrite` | `id_product + id_lang + id_shop` | Zero/one preferred-language row per product | Localized text/slug | No | Direct |
| Manufacturer | PrestaShop RDS / configured DB | `<prefix>manufacturer` | `id_manufacturer`, `name` | `id_manufacturer` | Zero/one per product | Brand/manufacturer label | No | Direct |
| Category link | PrestaShop RDS / configured DB | `<prefix>category_product` | `id_product`, `id_category`, `position` | `id_product` | Zero/many per product | Raw category membership | No | Structured |
| Category | PrestaShop RDS / configured DB | `<prefix>category` | `id_category`, `id_parent`, `active`, `level_depth`, `date_add`, `date_upd` | `id_category` | One row per category | Category tree/status | No | Direct |
| Category text | PrestaShop RDS / configured DB | `<prefix>category_lang` | `id_category`, `id_lang`, `id_shop`, `name`, `link_rewrite` | `id_category + id_lang + id_shop` | Zero/one preferred-language row per category | Category display text | No | Direct |
| Product feature link | PrestaShop RDS / configured DB | `<prefix>feature_product` | `id_product`, `id_feature`, `id_feature_value` | `id_product` | Zero/many per product | Raw feature assignments | No | Structured |
| Feature label | PrestaShop RDS / configured DB | `<prefix>feature_lang` | `id_feature`, `id_lang`, `name` | `id_feature + id_lang` | Zero/one preferred-language row per feature | Feature name | No | Direct |
| Feature value | PrestaShop RDS / configured DB | `<prefix>feature_value`, `<prefix>feature_value_lang` | `id_feature_value`, `id_feature`, `custom`, `id_lang`, `value` | `id_feature_value + id_lang` | Zero/one preferred-language row per value | Feature value text | No | Direct |
| Attribute combination | PrestaShop RDS / configured DB | `<prefix>product_attribute` | `id_product_attribute`, `id_product`, `reference`, `price`, `weight`, `default_on`, `minimal_quantity`, `available_date` | `id_product_attribute` | Zero/many combinations per product | Combination identity and impacts | No | Structured |
| Attribute labels | PrestaShop RDS / configured DB | `<prefix>product_attribute_combination`, `<prefix>attribute`, `<prefix>attribute_lang`, `<prefix>attribute_group_lang` | `id_product_attribute`, `id_attribute`, `id_attribute_group`, `name` | `id_product_attribute + id_attribute` | Zero/many values per combination | Attribute group/value labels | No | Structured |
| Stock | PrestaShop RDS / configured DB | `<prefix>stock_available` | `id_product`, `id_product_attribute`, `id_shop`, `quantity`, `out_of_stock` | `id_product + id_product_attribute + shop` | Zero/many stock rows | Availability signal | No | Aggregate only |
| Tags | PrestaShop RDS / configured DB | `<prefix>product_tag`, `<prefix>tag` | `id_product`, `id_tag`, `id_lang`, `name` | `id_product + id_tag + id_lang` | Zero/many tags per product | Existing PrestaShop tags | No | Structured |
| Orders | PrestaShop RDS / configured DB | `<prefix>orders` | `id_order`, `id_customer`, `valid`, `date_add` | `id_order` | One row per order | Valid-order policy and sale date/customer aggregate input | Yes | Aggregate only |
| Order lines | PrestaShop RDS / configured DB | `<prefix>order_detail` | `id_order`, `product_id`, `product_attribute_id`, `product_quantity`, `total_price_tax_incl` | `id_order + product_id + product_attribute_id` | Zero/many lines per order | Units/revenue by product | No | Aggregate only |
| Relationships | Catalog Service snapshot / external artifact | Relationship snapshot | `sourceProductId`, `targetProductId`, `score`, `confidence`, `lift`, `support`, `reliability` | `sourceProductId/productId` | Zero/many edges per source product | Behavioral relationship evidence | No | Structured |
| Customer table | PrestaShop RDS / configured DB | `<prefix>customer` | `id_customer`, `firstname`, `lastname`, `email` | `id_customer` | One row per customer | Not needed for product export | Yes | Do not export raw |
| Address table | PrestaShop RDS / configured DB | `<prefix>address` | `id_address`, `firstname`, `lastname`, `address1`, `address2`, `phone`, `phone_mobile` | `id_address` | One row per address | Not needed for product export | Yes | Do not export raw |

Tables explicitly not exported raw: `<prefix>customer`, `<prefix>address`, `<prefix>orders`, and `<prefix>order_detail`. Orders and order lines are used only for product-level aggregates.

## Export Data Model

| Logical table/sheet | Primary key | Grain | Fields | Source tables | Expected rows | Required |
| --- | --- | --- | --- | --- | --- | --- |
| Products | `productId` | One row per base product in the exploration universe | Identity, catalog presence, text, category summaries, feature summaries, combination summaries, aggregate sales, relationship summaries, diagnostics | `product`, `product_shop`, `product_lang`, `manufacturer`, category/feature/attribute/tag/stock/order tables | Current catalog products plus valid-order historical-only products | Yes |
| Categories | `categoryId` | One row per category | `categoryId`, parent, name, active, depth, path, assigned count | `category`, `category_lang`, `category_product` | Category count | Yes |
| ProductCategories | `productId + categoryId` | One row per product/category assignment | Product/category ids, name, path, depth, position, default flag | `category_product`, `category`, `category_lang`, `product`, `product_shop` | Assignment count | Yes |
| Features | `featureId` | One row per feature definition | Feature id/name/position/coverage | `feature`, `feature_lang`, `feature_product` | Feature definition count | Optional |
| ProductFeatures | `productId + featureId + featureValueId` | One row per product feature value | Feature name/value/custom flag | `feature_product`, `feature_lang`, `feature_value`, `feature_value_lang` | Feature assignment count | Optional |
| Combinations | `combinationId` | One row per variant/combination | Combination id, product id, reference, impacts, stock, attributes, valid-order units/count | `product_attribute`, `product_attribute_shop`, `product_attribute_combination`, `attribute*`, `stock_available`, `orders`, `order_detail` | Combination count | Optional |
| SalesAggregates | `productId` | One row per base product with sales | Valid orders, units, unique customers, revenue tax incl., first/last sale, average units/order | `orders`, `order_detail` | Products with valid-order sales | Yes |
| Relationships | `sourceProductId + targetProductId` | One row per relationship edge | Source, target, score/confidence/lift/support/reliability, snapshot id | Catalog relationship snapshot | Zero unless configured | Optional |
| DataQuality | `metric` | One deterministic metric/evidence row | Metric, value, JSON details | Derived from exported logical tables | Dozens | Yes |

The model intentionally does not dump raw database tables. It preserves one-to-many evidence without duplicating the main product row.

## Products Sheet Fields

The Products sheet/CSV includes:

`productId`, `catalogPresence`, `reference`, `name`, `active`, `visibility`, `manufacturerId`, `manufacturerName`, `price`, `wholesalePrice`, `defaultCategoryId`, `defaultCategoryName`, `defaultCategoryPath`, `allCategoryIds`, `allCategoryNames`, `categoryHierarchyPaths`, `categoryDepths`, `categoryCount`, `shortDescription`, `fullDescription`, `tags_json`, `tags_text`, `condition`, `weight`, `width`, `height`, `depth`, `dateAdded`, `dateUpdated`, `availableForOrder`, `showPrice`, `stockQuantity`, `totalStockQuantity`, `slug`, `productUrl`, `features_json`, `features_text`, `featureCount`, `combinationCount`, `attributeGroups`, `attributeValues`, `combinations_json`, `validOrderCount`, `unitsSold`, `uniqueCustomerCount`, `totalRevenueTaxIncl`, `firstSaleAt`, `lastSaleAt`, `averageUnitsPerOrder`, `relationshipCount`, `strongestRelatedProductIds`, `strongestRelationshipScores`, `maxRelationshipScore`, `avgRelationshipScore`, `nameLength`, `shortDescriptionPresent`, `descriptionPresent`, `descriptionLength`, `withoutSales`, `hasCombinations`.

`catalogPresence` values:

- `current_catalog`: product exists in current `ps_product`.
- `historical_order_detail_only`: product appears in valid-order history but no longer exists in current `ps_product`; unavailable catalog fields are exported as null.

`productUrl` is currently exported as unavailable (`null`) because no canonical storefront base URL is configured.

The XLSX Products sheet additionally includes empty manual-review columns:

`review_primary_family`, `review_discipline`, `review_environment`, `review_objective`, `review_customer_type`, `review_notes`.

## Output Package

When unblocked, the package is:

```text
product-intelligence-exploration/
  products.xlsx
  product_catalog_exploration.csv
  product_catalog_raw.json
  representative_product_sample.csv
  metadata.json
```

Generated package path:

```text
C:\Users\Goli\Pesas Chile\MS\MS-pesaschile-customer-profile\scripts\audits\product-intelligence-exploration\outputs\product-intelligence-exploration
```

Generated artifact sizes:

- `product_catalog_exploration.csv`: 9848030 bytes
- `products.xlsx`: 2984714 bytes
- `product_catalog_raw.json`: 22019263 bytes
- `metadata.json`: 23159 bytes
- `representative_product_sample.csv`: 1022525 bytes

XLSX sheets:

- Products
- Categories
- ProductCategories
- Features
- ProductFeatures
- Combinations
- SalesAggregates
- Relationships
- DataQuality

## Data Quality and Diagnostics

The exporter computes deterministic diagnostics only:

- Total products
- Active/inactive counts
- Products without name
- Products without description
- Products without category
- Products with more than `PRODUCT_EXPLORATION_MANY_CATEGORY_THRESHOLD` categories
- Products without features
- Products without sales
- Products with combinations
- Duplicate normalized product names
- Top categories by assigned product count
- Top manufacturers
- Category depth distribution
- Feature coverage
- Products assigned to unusually many categories
- Highly overlapping category memberships
- Category names with composite text signals such as separators/connectors/long names/numbers
- Orphan or near-empty categories
- Duplicate normalized category names

These diagnostics are evidence for later ontology design. They do not merge, clean, classify, or relabel categories.

## Representative Sample

The exporter writes `representative_product_sample.csv`, targeting 150 products by default. Selection is deterministic and mixes:

- High-sales products
- Products without sales
- Inactive products
- Products with many categories
- Products with few/no features
- Products with high relationship connectivity when relationship data exists
- Products with short or duplicate-normalized names
- Quantile fill across the catalog by product order

The sample is for review only and does not pre-populate classification fields.

## Validation

Validation completed:

- `npm run typecheck`
- `npm test -- product-intelligence-exploration-model.test.ts`
- Export run against PrestaShop shop `1`
- CSV product uniqueness: 2011 rows, 2011 unique `productId`
- XLSX sheet validation:
  - Products: 2012 rows including header
  - Categories: 254 rows including header
  - ProductCategories: 7843 rows including header
  - Features: 76 rows including header
  - ProductFeatures: 14148 rows including header
  - Combinations: 454 rows including header
  - SalesAggregates: 1738 rows including header
  - Relationships: 5771 rows including header
  - DataQuality: 25 rows including header
- Structured no-PII key validation: no disallowed keys found

Performance from the completed run:

- Total duration: 23662 ms
- Extraction duration: 4403 ms
- Output duration: 2969 ms

## Performance Provenance

The exporter records in `metadata.json`:

- `generatedAt`
- source/source environment
- extraction version
- valid-order policy version
- relationship snapshot source/version when supplied
- product counts
- source rows read by query
- extraction/output durations
- output file sizes
- source table map
- export data model
- PII check
- write-safety checks

The completed run records this provenance in `metadata.json`.

## Known Gaps

- Relationship metrics are behavioral co-occurrence evidence from the Catalog Service snapshot; they must not be interpreted as semantic similarity.
- `productUrl` remains unavailable until a canonical storefront base URL policy is supplied.
- Historical-only products preserve latest valid-order line name/reference from `order_detail`; catalog fields that require current `ps_product` remain null.

## Next Step

Rerun with the Catalog Service relationship snapshot directory when updated evidence is needed:

```bash
PRESTASHOP_CATALOG_SHOP_ID=1 PRODUCT_RELATIONSHIP_SNAPSHOT_DIR="<catalog-service>/data/relationship-snapshots" npm run product:exploration:export
```

Then perform commercial ontology discovery using the exported dataset.
