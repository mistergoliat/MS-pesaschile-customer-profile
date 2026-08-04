-- CP-R1-T11A0 - RFM and Segmentation Source Audit
-- Repository: MS-pesaschile-customer-profile
--
-- Read-only diagnostic SQL. Do not run as a migration.
-- The statements below are diagnostic reads only. They do not modify schema,
-- write rows, remove rows, or use persistent temporary tables.
--
-- Connection model:
-- - Run CRM queries against CRM_DB_NAME, currently main_management.
-- - Run PrestaShop queries against PRESTASHOP_DB_NAME, currently pesas_productiva.
-- - Replace {ps_} with PRESTASHOP_DB_PREFIX if the configured prefix is not ps_.
-- - Replace @as_of_date and @window_days with explicit values if the client
--   does not allow user variables.
--
-- Current live audit execution (2026-08-03) found that CRM master_customer does
-- not yet include prestashop_customer_id. Queries in section 2 that use
-- that column are intentionally marked BLOCKED until the T02 migration is
-- actually applied and populated.

SET @as_of_date = DATE('2026-08-03');
SET @window_days = 365;
SET @window_start_365 = DATE_SUB(@as_of_date, INTERVAL 365 DAY);
SET @window_start_730 = DATE_SUB(@as_of_date, INTERVAL 730 DAY);
SET @window_end_exclusive = DATE_ADD(@as_of_date, INTERVAL 1 DAY);

-- ---------------------------------------------------------------------------
-- 1. Schema presence - PrestaShop source inventory
-- ---------------------------------------------------------------------------

SELECT
  table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    '{ps_}orders',
    '{ps_}customer',
    '{ps_}order_detail',
    '{ps_}currency',
    '{ps_}order_state',
    '{ps_}order_state_lang',
    '{ps_}order_history',
    '{ps_}order_slip',
    '{ps_}order_slip_detail',
    '{ps_}shop',
    '{ps_}product',
    '{ps_}category_product',
    '{ps_}manufacturer'
  )
ORDER BY table_name;

SELECT
  column_name,
  column_type,
  is_nullable,
  column_key
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = '{ps_}orders'
  AND column_name IN (
    'id_order',
    'id_shop',
    'id_customer',
    'id_currency',
    'current_state',
    'conversion_rate',
    'total_discounts',
    'total_paid',
    'total_paid_tax_incl',
    'total_paid_tax_excl',
    'total_products',
    'total_products_wt',
    'total_shipping',
    'valid',
    'date_add',
    'date_upd'
  )
ORDER BY ordinal_position;

SELECT
  column_name,
  column_type,
  is_nullable,
  column_key
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = '{ps_}order_detail'
  AND column_name IN (
    'id_order_detail',
    'id_order',
    'product_id',
    'product_attribute_id',
    'product_name',
    'product_quantity',
    'product_quantity_refunded',
    'total_price_tax_incl',
    'total_price_tax_excl',
    'total_refunded_tax_incl'
  )
ORDER BY ordinal_position;

-- ---------------------------------------------------------------------------
-- 2. Identity coverage - CRM side
-- ---------------------------------------------------------------------------

SELECT
  column_name,
  column_type,
  is_nullable,
  column_key
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'master_customer'
  AND column_name IN (
    'id',
    'platform_origin',
    'prestashop_customer_id'
  )
ORDER BY ordinal_position;

SELECT
  COUNT(*) AS total_master_customer
FROM master_customer;

-- BLOCKED until CRM master_customer.prestashop_customer_id exists.
-- Expected after migration:
-- SELECT
--   COUNT(*) AS total_master_customer,
--   SUM(prestashop_customer_id IS NOT NULL) AS total_with_prestashop_customer_id,
--   SUM(prestashop_customer_id IS NULL) AS total_without_prestashop_customer_id
-- FROM master_customer;

-- BLOCKED until CRM master_customer.prestashop_customer_id exists.
-- Expected after migration:
-- SELECT
--   prestashop_customer_id,
--   COUNT(*) AS link_count
-- FROM master_customer
-- WHERE prestashop_customer_id IS NOT NULL
-- GROUP BY prestashop_customer_id
-- HAVING COUNT(*) > 1
-- ORDER BY link_count DESC;

-- BLOCKED until CRM master_customer.prestashop_customer_id exists.
-- Run from CRM if it can query the PrestaShop schema, or run by exporting the
-- aggregate counts separately from both connections.
-- Expected orphan-link query:
-- SELECT
--   COUNT(*) AS links_to_missing_prestashop_customer
-- FROM master_customer mc
-- LEFT JOIN prestashop_database.{ps_}customer pc
--   ON pc.id_customer = mc.prestashop_customer_id
-- WHERE mc.prestashop_customer_id IS NOT NULL
--   AND pc.id_customer IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Identity coverage - PrestaShop side
-- ---------------------------------------------------------------------------

SELECT
  COUNT(*) AS total_prestashop_customers,
  SUM(is_guest = 1) AS guest_customers,
  SUM(deleted = 1) AS deleted_customers
FROM {ps_}customer;

SELECT
  COUNT(DISTINCT o.id_customer) AS prestashop_buyers_lifetime
FROM {ps_}orders o
WHERE o.valid = 1
  AND o.id_customer IS NOT NULL
  AND o.id_customer <> 0;

SELECT
  COUNT(*) AS valid_orders_without_usable_customer
FROM {ps_}orders o
WHERE o.valid = 1
  AND (o.id_customer IS NULL OR o.id_customer = 0);

SELECT
  COUNT(*) AS valid_orders_with_missing_prestashop_customer
FROM {ps_}orders o
LEFT JOIN {ps_}customer pc
  ON pc.id_customer = o.id_customer
WHERE o.valid = 1
  AND o.id_customer IS NOT NULL
  AND o.id_customer <> 0
  AND pc.id_customer IS NULL;

-- BLOCKED until CRM master_customer.prestashop_customer_id exists.
-- Expected buyers linked/unlinked coverage:
-- SELECT
--   COUNT(DISTINCT o.id_customer) AS prestashop_buyers,
--   COUNT(DISTINCT mc.prestashop_customer_id) AS linked_buyers,
--   COUNT(DISTINCT o.id_customer) - COUNT(DISTINCT mc.prestashop_customer_id) AS unlinked_buyers,
--   ROUND(100 * COUNT(DISTINCT mc.prestashop_customer_id) / NULLIF(COUNT(DISTINCT o.id_customer), 0), 2)
--     AS linked_buyer_coverage_percent
-- FROM {ps_}orders o
-- LEFT JOIN crm_database.master_customer mc
--   ON mc.prestashop_customer_id = o.id_customer
-- WHERE o.valid = 1
--   AND o.id_customer IS NOT NULL
--   AND o.id_customer <> 0;

-- ---------------------------------------------------------------------------
-- 4. Order universe - historical, 365 days, 730 days
-- ---------------------------------------------------------------------------

SELECT
  'historical' AS window_name,
  COUNT(DISTINCT o.id_customer) AS customers,
  COUNT(DISTINCT o.id_order) AS orders,
  SUM(o.total_paid_tax_incl) AS monetary_value
FROM {ps_}orders o
WHERE o.valid = 1
  AND o.id_customer IS NOT NULL
  AND o.id_customer <> 0
UNION ALL
SELECT
  'last_365_days' AS window_name,
  COUNT(DISTINCT o.id_customer) AS customers,
  COUNT(DISTINCT o.id_order) AS orders,
  SUM(o.total_paid_tax_incl) AS monetary_value
FROM {ps_}orders o
WHERE o.valid = 1
  AND o.id_customer IS NOT NULL
  AND o.id_customer <> 0
  AND o.date_add >= @window_start_365
  AND o.date_add < @window_end_exclusive
UNION ALL
SELECT
  'last_730_days' AS window_name,
  COUNT(DISTINCT o.id_customer) AS customers,
  COUNT(DISTINCT o.id_order) AS orders,
  SUM(o.total_paid_tax_incl) AS monetary_value
FROM {ps_}orders o
WHERE o.valid = 1
  AND o.id_customer IS NOT NULL
  AND o.id_customer <> 0
  AND o.date_add >= @window_start_730
  AND o.date_add < @window_end_exclusive;

SELECT
  COUNT(*) AS customers_with_history_but_no_365_day_valid_order
FROM (
  SELECT
    o.id_customer,
    SUM(o.date_add >= @window_start_365 AND o.date_add < @window_end_exclusive) AS orders_in_window
  FROM {ps_}orders o
  WHERE o.valid = 1
    AND o.id_customer IS NOT NULL
    AND o.id_customer <> 0
  GROUP BY o.id_customer
  HAVING orders_in_window = 0
) inactive;

-- ---------------------------------------------------------------------------
-- 5. RFM base population for diagnostics
-- ---------------------------------------------------------------------------

WITH customer_rfm AS (
  SELECT
    o.id_customer AS prestashop_customer_id,
    DATEDIFF(@as_of_date, DATE(MAX(o.date_add))) AS recency_days,
    COUNT(DISTINCT o.id_order) AS frequency_orders,
    SUM(o.total_paid_tax_incl) AS monetary_value
  FROM {ps_}orders o
  WHERE o.valid = 1
    AND o.id_customer IS NOT NULL
    AND o.id_customer <> 0
    AND o.date_add >= @window_start_365
    AND o.date_add < @window_end_exclusive
  GROUP BY o.id_customer
)
SELECT
  COUNT(*) AS population_size,
  MIN(recency_days) AS recency_min,
  AVG(recency_days) AS recency_avg,
  MAX(recency_days) AS recency_max,
  MIN(frequency_orders) AS frequency_min,
  AVG(frequency_orders) AS frequency_avg,
  MAX(frequency_orders) AS frequency_max,
  MIN(monetary_value) AS monetary_min,
  AVG(monetary_value) AS monetary_avg,
  MAX(monetary_value) AS monetary_max,
  COUNT(DISTINCT recency_days) AS recency_unique_values,
  COUNT(DISTINCT frequency_orders) AS frequency_unique_values,
  COUNT(DISTINCT monetary_value) AS monetary_unique_values
FROM customer_rfm;

WITH customer_rfm AS (
  SELECT
    o.id_customer,
    DATEDIFF(@as_of_date, DATE(MAX(o.date_add))) AS recency_days,
    COUNT(DISTINCT o.id_order) AS frequency_orders,
    SUM(o.total_paid_tax_incl) AS monetary_value
  FROM {ps_}orders o
  WHERE o.valid = 1
    AND o.id_customer IS NOT NULL
    AND o.id_customer <> 0
    AND o.date_add >= @window_start_365
    AND o.date_add < @window_end_exclusive
  GROUP BY o.id_customer
),
ranked AS (
  SELECT
    recency_days,
    frequency_orders,
    monetary_value,
    CUME_DIST() OVER (ORDER BY recency_days) AS recency_cume,
    CUME_DIST() OVER (ORDER BY frequency_orders) AS frequency_cume,
    CUME_DIST() OVER (ORDER BY monetary_value) AS monetary_cume
  FROM customer_rfm
)
SELECT
  MIN(CASE WHEN recency_cume >= 0.20 THEN recency_days END) AS recency_p20,
  MIN(CASE WHEN recency_cume >= 0.40 THEN recency_days END) AS recency_p40,
  MIN(CASE WHEN recency_cume >= 0.60 THEN recency_days END) AS recency_p60,
  MIN(CASE WHEN recency_cume >= 0.80 THEN recency_days END) AS recency_p80,
  MIN(CASE WHEN recency_cume >= 0.90 THEN recency_days END) AS recency_p90,
  MIN(CASE WHEN recency_cume >= 0.95 THEN recency_days END) AS recency_p95,
  MIN(CASE WHEN recency_cume >= 0.99 THEN recency_days END) AS recency_p99,
  MIN(CASE WHEN frequency_cume >= 0.20 THEN frequency_orders END) AS frequency_p20,
  MIN(CASE WHEN frequency_cume >= 0.40 THEN frequency_orders END) AS frequency_p40,
  MIN(CASE WHEN frequency_cume >= 0.60 THEN frequency_orders END) AS frequency_p60,
  MIN(CASE WHEN frequency_cume >= 0.80 THEN frequency_orders END) AS frequency_p80,
  MIN(CASE WHEN frequency_cume >= 0.90 THEN frequency_orders END) AS frequency_p90,
  MIN(CASE WHEN frequency_cume >= 0.95 THEN frequency_orders END) AS frequency_p95,
  MIN(CASE WHEN frequency_cume >= 0.99 THEN frequency_orders END) AS frequency_p99,
  MIN(CASE WHEN monetary_cume >= 0.20 THEN monetary_value END) AS monetary_p20,
  MIN(CASE WHEN monetary_cume >= 0.40 THEN monetary_value END) AS monetary_p40,
  MIN(CASE WHEN monetary_cume >= 0.60 THEN monetary_value END) AS monetary_p60,
  MIN(CASE WHEN monetary_cume >= 0.80 THEN monetary_value END) AS monetary_p80,
  MIN(CASE WHEN monetary_cume >= 0.90 THEN monetary_value END) AS monetary_p90,
  MIN(CASE WHEN monetary_cume >= 0.95 THEN monetary_value END) AS monetary_p95,
  MIN(CASE WHEN monetary_cume >= 0.99 THEN monetary_value END) AS monetary_p99
FROM ranked;

-- Tie frequency by dimension.
WITH customer_rfm AS (
  SELECT
    o.id_customer,
    DATEDIFF(@as_of_date, DATE(MAX(o.date_add))) AS recency_days,
    COUNT(DISTINCT o.id_order) AS frequency_orders,
    SUM(o.total_paid_tax_incl) AS monetary_value
  FROM {ps_}orders o
  WHERE o.valid = 1
    AND o.id_customer IS NOT NULL
    AND o.id_customer <> 0
    AND o.date_add >= @window_start_365
    AND o.date_add < @window_end_exclusive
  GROUP BY o.id_customer
)
SELECT 'recency' AS metric, recency_days AS metric_value, COUNT(*) AS customers
FROM customer_rfm
GROUP BY recency_days
HAVING COUNT(*) > 1
UNION ALL
SELECT 'frequency' AS metric, frequency_orders AS metric_value, COUNT(*) AS customers
FROM customer_rfm
GROUP BY frequency_orders
HAVING COUNT(*) > 1
UNION ALL
SELECT 'monetary' AS metric, monetary_value AS metric_value, COUNT(*) AS customers
FROM customer_rfm
GROUP BY monetary_value
HAVING COUNT(*) > 1
ORDER BY metric, customers DESC
LIMIT 100;

-- ---------------------------------------------------------------------------
-- 6. Frequency concentration and outliers
-- ---------------------------------------------------------------------------

WITH customer_frequency AS (
  SELECT
    o.id_customer,
    COUNT(DISTINCT o.id_order) AS frequency_orders
  FROM {ps_}orders o
  WHERE o.valid = 1
    AND o.id_customer IS NOT NULL
    AND o.id_customer <> 0
    AND o.date_add >= @window_start_365
    AND o.date_add < @window_end_exclusive
  GROUP BY o.id_customer
)
SELECT
  frequency_orders,
  COUNT(*) AS customers,
  ROUND(100 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS population_percent
FROM customer_frequency
GROUP BY frequency_orders
ORDER BY customers DESC, frequency_orders ASC
LIMIT 20;

WITH customer_rfm AS (
  SELECT
    o.id_customer,
    COUNT(DISTINCT o.id_order) AS frequency_orders,
    SUM(o.total_paid_tax_incl) AS monetary_value
  FROM {ps_}orders o
  WHERE o.valid = 1
    AND o.id_customer IS NOT NULL
    AND o.id_customer <> 0
    AND o.date_add >= @window_start_365
    AND o.date_add < @window_end_exclusive
  GROUP BY o.id_customer
)
SELECT
  COUNT(*) AS customers,
  SUM(frequency_orders >= 10) AS customers_frequency_ge_10,
  MAX(frequency_orders) AS max_frequency,
  MAX(monetary_value) AS max_monetary,
  SUM(monetary_value = 0) AS zero_monetary_customers
FROM customer_rfm;

-- ---------------------------------------------------------------------------
-- 7. Monetary comparison, currencies, and multishop
-- ---------------------------------------------------------------------------

SELECT
  COUNT(*) AS valid_orders,
  SUM(total_paid) AS sum_total_paid,
  SUM(total_paid_tax_incl) AS sum_total_paid_tax_incl,
  SUM(total_paid_tax_excl) AS sum_total_paid_tax_excl,
  SUM(total_products) AS sum_total_products,
  SUM(total_products_wt) AS sum_total_products_wt,
  SUM(total_discounts) AS sum_total_discounts,
  SUM(total_shipping) AS sum_total_shipping,
  SUM(total_paid_tax_incl = 0) AS zero_total_paid_tax_incl_orders,
  SUM(total_paid_tax_incl < 0) AS negative_total_paid_tax_incl_orders
FROM {ps_}orders
WHERE valid = 1;

SELECT
  o.id_currency,
  COALESCE(c.iso_code, '(missing)') AS iso_code,
  COUNT(*) AS valid_orders,
  COUNT(DISTINCT o.id_customer) AS valid_customers,
  SUM(o.total_paid_tax_incl) AS monetary_value,
  MIN(o.conversion_rate) AS min_conversion_rate,
  MAX(o.conversion_rate) AS max_conversion_rate
FROM {ps_}orders o
LEFT JOIN {ps_}currency c
  ON c.id_currency = o.id_currency
WHERE o.valid = 1
GROUP BY o.id_currency, c.iso_code
ORDER BY valid_orders DESC;

SELECT
  o.id_shop,
  COUNT(*) AS valid_orders,
  COUNT(DISTINCT o.id_customer) AS valid_customers,
  SUM(o.total_paid_tax_incl) AS monetary_value
FROM {ps_}orders o
WHERE o.valid = 1
GROUP BY o.id_shop
ORDER BY valid_orders DESC;

SELECT
  multi_shop_ordering_customers,
  ROUND(100 * multi_shop_ordering_customers / NULLIF(total_ordering_customers, 0), 2)
    AS multi_shop_customer_percent
FROM (
  SELECT
    COUNT(*) AS total_ordering_customers,
    SUM(shop_count > 1) AS multi_shop_ordering_customers
  FROM (
    SELECT
      o.id_customer,
      COUNT(DISTINCT o.id_shop) AS shop_count
    FROM {ps_}orders o
    WHERE o.valid = 1
      AND o.id_customer IS NOT NULL
      AND o.id_customer <> 0
    GROUP BY o.id_customer
  ) by_customer
) totals;

-- ---------------------------------------------------------------------------
-- 8. Returns, cancellations, and order validity
-- ---------------------------------------------------------------------------

SELECT
  valid,
  COUNT(*) AS orders
FROM {ps_}orders
GROUP BY valid
ORDER BY valid;

SELECT
  current_state,
  valid,
  COUNT(*) AS orders
FROM {ps_}orders
GROUP BY current_state, valid
ORDER BY current_state, valid;

SELECT
  current_state,
  SUM(valid = 1) AS valid_orders,
  SUM(valid = 0) AS invalid_orders,
  COUNT(*) AS total_orders
FROM {ps_}orders
WHERE current_state IN (6, 7)
GROUP BY current_state
ORDER BY current_state;

SELECT
  (SELECT COUNT(*) FROM {ps_}order_slip) AS order_slip_rows,
  (SELECT COALESCE(SUM(product_quantity_refunded), 0) FROM {ps_}order_detail) AS refunded_units,
  (SELECT COALESCE(SUM(total_refunded_tax_incl), 0) FROM {ps_}order_detail) AS refunded_tax_incl;

SELECT
  COUNT(DISTINCT o.id_order) AS valid_orders_with_refunded_lines,
  SUM(od.product_quantity_refunded) AS refunded_units_on_valid_orders,
  SUM(od.total_refunded_tax_incl) AS refunded_tax_incl_on_valid_orders
FROM {ps_}orders o
INNER JOIN {ps_}order_detail od
  ON od.id_order = o.id_order
WHERE o.valid = 1
  AND (
    od.product_quantity_refunded > 0
    OR od.total_refunded_tax_incl > 0
  );

-- ---------------------------------------------------------------------------
-- 9. Guests, duplicates, nulls, future dates, and old orders
-- ---------------------------------------------------------------------------

SELECT
  COUNT(*) AS total_orders,
  SUM(id_customer IS NULL OR id_customer = 0) AS orders_without_usable_customer,
  SUM(valid = 1 AND (id_customer IS NULL OR id_customer = 0)) AS valid_orders_without_usable_customer,
  SUM(date_add IS NULL) AS null_date_add_orders,
  SUM(valid = 1 AND date_add IS NULL) AS valid_null_date_add_orders,
  SUM(date_add >= @window_end_exclusive) AS future_orders,
  SUM(valid = 1 AND date_add >= @window_end_exclusive) AS valid_future_orders,
  MIN(date_add) AS oldest_order_at,
  MAX(date_add) AS newest_order_at
FROM {ps_}orders;

SELECT
  YEAR(date_add) AS order_year,
  MONTH(date_add) AS order_month,
  COUNT(*) AS valid_orders,
  COUNT(DISTINCT id_customer) AS valid_customers,
  SUM(total_paid_tax_incl) AS monetary_value
FROM {ps_}orders
WHERE valid = 1
GROUP BY YEAR(date_add), MONTH(date_add)
ORDER BY order_year, order_month;

SELECT
  id_order,
  COUNT(*) AS duplicate_rows
FROM {ps_}orders
GROUP BY id_order
HAVING COUNT(*) > 1
ORDER BY duplicate_rows DESC
LIMIT 100;

-- ---------------------------------------------------------------------------
-- 10. Clustering feature availability probes
-- ---------------------------------------------------------------------------

SELECT
  COUNT(DISTINCT od.product_id) AS distinct_products_in_order_detail,
  COUNT(DISTINCT od.product_attribute_id) AS distinct_variants_in_order_detail,
  COUNT(DISTINCT CASE WHEN p.id_product IS NOT NULL THEN od.product_id END) AS lines_linked_to_product,
  COUNT(DISTINCT cp.id_category) AS categories_reachable_from_product,
  COUNT(DISTINCT p.id_manufacturer) AS manufacturers_reachable_from_product
FROM {ps_}order_detail od
LEFT JOIN {ps_}product p
  ON p.id_product = od.product_id
LEFT JOIN {ps_}category_product cp
  ON cp.id_product = od.product_id;

WITH customer_intervals AS (
  SELECT
    id_customer,
    DATEDIFF(
      date_add,
      LAG(date_add) OVER (PARTITION BY id_customer ORDER BY date_add, id_order)
    ) AS days_since_previous_order
  FROM {ps_}orders
  WHERE valid = 1
    AND id_customer IS NOT NULL
    AND id_customer <> 0
)
SELECT
  COUNT(*) AS repeat_order_intervals,
  AVG(days_since_previous_order) AS avg_days_between_orders,
  MIN(days_since_previous_order) AS min_days_between_orders,
  MAX(days_since_previous_order) AS max_days_between_orders
FROM customer_intervals
WHERE days_since_previous_order IS NOT NULL;
