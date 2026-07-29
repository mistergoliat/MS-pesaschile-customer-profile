const REQUIRED_TABLE_SUFFIXES = [
  'orders',
  'order_detail',
  'product',
  'product_shop',
  'category',
  'category_lang',
  'category_product',
  'manufacturer',
] as const;

const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;

export type ProductClassificationTables = Record<(typeof REQUIRED_TABLE_SUFFIXES)[number], string>;

export function requiredProductClassificationSuffixes(): readonly string[] {
  return REQUIRED_TABLE_SUFFIXES;
}

export function buildTables(prefix: string): ProductClassificationTables {
  if (!SAFE_IDENTIFIER_PATTERN.test(prefix)) {
    throw new Error(`Unsafe PrestaShop table prefix: ${prefix}`);
  }
  return Object.fromEntries(REQUIRED_TABLE_SUFFIXES.map((suffix) => [suffix, `${prefix}${suffix}`])) as ProductClassificationTables;
}

export function universeSummarySql(t: ProductClassificationTables): string {
  return `
    SELECT
      COUNT(DISTINCT o.id_order) AS validOrderCount,
      COUNT(*) AS orderLineCount,
      COALESCE(SUM(od.product_quantity), 0) AS unitCount,
      COALESCE(SUM(od.total_price_tax_incl), 0) AS spentTaxIncl,
      COUNT(DISTINCT od.product_id) AS distinctProducts,
      COUNT(DISTINCT CONCAT(od.product_id, '#', od.product_attribute_id)) AS distinctVariants,
      COUNT(DISTINCT o.id_customer) AS distinctCustomers
    FROM ${t.orders} o
    INNER JOIN ${t.order_detail} od
      ON od.id_order = o.id_order
    WHERE o.valid = 1
  `;
}

export function productCoverageSql(t: ProductClassificationTables): string {
  return `
    SELECT
      CASE WHEN p.id_product IS NULL THEN 'deleted_or_unavailable' ELSE 'linked' END AS catalogStatus,
      COUNT(*) AS lineCount,
      COALESCE(SUM(od.product_quantity), 0) AS unitCount,
      COALESCE(SUM(od.total_price_tax_incl), 0) AS spentTaxIncl,
      COUNT(DISTINCT od.product_id) AS productCount,
      COUNT(DISTINCT o.id_order) AS orderCount,
      COUNT(DISTINCT o.id_customer) AS customerCount
    FROM ${t.orders} o
    INNER JOIN ${t.order_detail} od
      ON od.id_order = o.id_order
    LEFT JOIN ${t.product} p
      ON p.id_product = od.product_id
    WHERE o.valid = 1
    GROUP BY catalogStatus
  `;
}

export function productShopDivergenceSql(t: ProductClassificationTables): string {
  return `
    SELECT
      COUNT(*) AS observedProducts,
      COALESCE(SUM(CASE WHEN ps.productShopRows > 1 THEN 1 ELSE 0 END), 0) AS productsWithMultipleShopRows,
      COALESCE(SUM(CASE WHEN ps.minShopDefault <> ps.maxShopDefault THEN 1 ELSE 0 END), 0) AS productsWithDivergentShopDefaults,
      COALESCE(SUM(CASE WHEN p.id_category_default <> ps.configuredShopDefault THEN 1 ELSE 0 END), 0) AS productsDivergingFromConfiguredShop
    FROM (
      SELECT DISTINCT od.product_id
      FROM ${t.orders} o
      INNER JOIN ${t.order_detail} od
        ON od.id_order = o.id_order
      WHERE o.valid = 1
    ) observed
    LEFT JOIN ${t.product} p
      ON p.id_product = observed.product_id
    LEFT JOIN (
      SELECT
        id_product,
        COUNT(*) AS productShopRows,
        MIN(id_category_default) AS minShopDefault,
        MAX(id_category_default) AS maxShopDefault,
        MAX(CASE WHEN id_shop = ? THEN id_category_default ELSE NULL END) AS configuredShopDefault
      FROM ${t.product_shop}
      GROUP BY id_product
    ) ps
      ON ps.id_product = observed.product_id
  `;
}

export function catalogShopExistsSql(t: ProductClassificationTables): string {
  return `
    SELECT
      COUNT(DISTINCT id_shop) AS shopCount
    FROM ${t.product_shop}
    WHERE id_shop = ?
  `;
}

export function categoryCoverageSql(t: ProductClassificationTables): string {
  return `
    WITH product_shop_rollup AS (
      SELECT
        id_product,
        COUNT(*) AS productShopRows,
        MIN(id_category_default) AS minShopDefault,
        MAX(id_category_default) AS maxShopDefault,
        MAX(CASE WHEN id_shop = ? THEN id_category_default ELSE NULL END) AS configuredShopDefault
      FROM ${t.product_shop}
      GROUP BY id_product
    ),
    resolved_lines AS (
      SELECT
        o.id_order,
        o.id_customer,
        od.product_id,
        od.product_quantity,
        od.total_price_tax_incl,
        p.id_product AS currentProductId,
        COALESCE(
          ps.configuredShopDefault,
          CASE WHEN ps.productShopRows = 1 THEN ps.minShopDefault ELSE NULL END,
          p.id_category_default
        ) AS resolvedCategoryId
      FROM ${t.orders} o
      INNER JOIN ${t.order_detail} od
        ON od.id_order = o.id_order
      LEFT JOIN ${t.product} p
        ON p.id_product = od.product_id
      LEFT JOIN product_shop_rollup ps
        ON ps.id_product = od.product_id
      WHERE o.valid = 1
    )
    SELECT
      CASE
        WHEN currentProductId IS NULL THEN 'product_deleted'
        WHEN resolvedCategoryId IS NULL THEN 'ambiguous_product_shop'
        WHEN resolvedCategoryId = 0 THEN 'category_zero'
        WHEN c.id_category IS NULL THEN 'category_missing'
        WHEN cl.name IS NULL OR TRIM(cl.name) = '' THEN 'category_without_translation'
        ELSE 'classified'
      END AS categoryStatus,
      COUNT(*) AS lineCount,
      COALESCE(SUM(product_quantity), 0) AS unitCount,
      COALESCE(SUM(total_price_tax_incl), 0) AS spentTaxIncl,
      COUNT(DISTINCT product_id) AS productCount,
      COUNT(DISTINCT id_order) AS orderCount,
      COUNT(DISTINCT id_customer) AS customerCount
    FROM resolved_lines rl
    LEFT JOIN ${t.category} c
      ON c.id_category = rl.resolvedCategoryId
    LEFT JOIN ${t.category_lang} cl
      ON cl.id_category = c.id_category
     AND cl.id_lang = ?
     AND cl.id_shop = ?
    GROUP BY categoryStatus
  `;
}

export function categoryRankingSql(t: ProductClassificationTables): string {
  return `
    WITH product_shop_rollup AS (
      SELECT
        id_product,
        COUNT(*) AS productShopRows,
        MIN(id_category_default) AS minShopDefault,
        MAX(id_category_default) AS maxShopDefault,
        MAX(CASE WHEN id_shop = ? THEN id_category_default ELSE NULL END) AS configuredShopDefault
      FROM ${t.product_shop}
      GROUP BY id_product
    ),
    resolved_lines AS (
      SELECT
        o.id_order,
        o.id_customer,
        od.product_id,
        od.product_quantity,
        od.total_price_tax_incl,
        o.date_add,
        COALESCE(
          ps.configuredShopDefault,
          CASE WHEN ps.productShopRows = 1 THEN ps.minShopDefault ELSE NULL END,
          p.id_category_default
        ) AS categoryId
      FROM ${t.orders} o
      INNER JOIN ${t.order_detail} od
        ON od.id_order = o.id_order
      INNER JOIN ${t.product} p
        ON p.id_product = od.product_id
      LEFT JOIN product_shop_rollup ps
        ON ps.id_product = od.product_id
      WHERE o.valid = 1
    )
    SELECT
      rl.categoryId AS categoryId,
      cl.name AS categoryName,
      c.active AS active,
      c.level_depth AS levelDepth,
      c.id_parent AS parentId,
      COUNT(DISTINCT rl.product_id) AS productCount,
      COUNT(*) AS lineCount,
      COALESCE(SUM(rl.product_quantity), 0) AS unitCount,
      COUNT(DISTINCT rl.id_order) AS orderCount,
      COUNT(DISTINCT rl.id_customer) AS customerCount,
      COALESCE(SUM(rl.total_price_tax_incl), 0) AS spentTaxIncl,
      MIN(rl.date_add) AS firstPurchasedAt,
      MAX(rl.date_add) AS lastPurchasedAt
    FROM resolved_lines rl
    INNER JOIN ${t.category} c
      ON c.id_category = rl.categoryId
    INNER JOIN ${t.category_lang} cl
      ON cl.id_category = c.id_category
     AND cl.id_lang = ?
     AND cl.id_shop = ?
    WHERE rl.categoryId IS NOT NULL
      AND rl.categoryId <> 0
      AND TRIM(cl.name) <> ''
    GROUP BY rl.categoryId, cl.name, c.active, c.level_depth, c.id_parent
    ORDER BY spentTaxIncl DESC, unitCount DESC, categoryId ASC
    LIMIT ?
  `;
}

export function multicategorySql(t: ProductClassificationTables): string {
  return `
    SELECT
      categoryCount,
      COUNT(*) AS productCount,
      COALESCE(SUM(CASE WHEN defaultInRelation = 1 THEN 1 ELSE 0 END), 0) AS defaultPresentProducts,
      COALESCE(SUM(CASE WHEN defaultInRelation = 0 THEN 1 ELSE 0 END), 0) AS defaultMissingProducts
    FROM (
      SELECT
        observed.product_id,
        COUNT(cp.id_category) AS categoryCount,
        MAX(CASE WHEN cp.id_category = p.id_category_default THEN 1 ELSE 0 END) AS defaultInRelation
      FROM (
        SELECT DISTINCT od.product_id
        FROM ${t.orders} o
        INNER JOIN ${t.order_detail} od
          ON od.id_order = o.id_order
        WHERE o.valid = 1
      ) observed
      LEFT JOIN ${t.product} p
        ON p.id_product = observed.product_id
      LEFT JOIN ${t.category_product} cp
        ON cp.id_product = observed.product_id
      GROUP BY observed.product_id
    ) per_product
    GROUP BY categoryCount
    ORDER BY categoryCount ASC
  `;
}

export function categoryHierarchySql(t: ProductClassificationTables): string {
  return `
    SELECT
      c.id_category AS categoryId,
      c.id_parent AS parentId,
      cl.name AS categoryName,
      c.active AS active,
      c.level_depth AS levelDepth
    FROM ${t.category} c
    LEFT JOIN ${t.category_lang} cl
      ON cl.id_category = c.id_category
     AND cl.id_lang = ?
     AND cl.id_shop = ?
    ORDER BY c.id_category ASC
  `;
}

export function manufacturerCoverageSql(t: ProductClassificationTables): string {
  return `
    SELECT
      CASE
        WHEN p.id_product IS NULL THEN 'product_deleted'
        WHEN p.id_manufacturer = 0 THEN 'manufacturer_zero'
        WHEN m.id_manufacturer IS NULL THEN 'manufacturer_missing'
        WHEN m.name IS NULL OR TRIM(m.name) = '' THEN 'manufacturer_without_name'
        ELSE 'classified'
      END AS manufacturerStatus,
      COUNT(*) AS lineCount,
      COALESCE(SUM(od.product_quantity), 0) AS unitCount,
      COALESCE(SUM(od.total_price_tax_incl), 0) AS spentTaxIncl,
      COUNT(DISTINCT od.product_id) AS productCount,
      COUNT(DISTINCT o.id_order) AS orderCount,
      COUNT(DISTINCT o.id_customer) AS customerCount
    FROM ${t.orders} o
    INNER JOIN ${t.order_detail} od
      ON od.id_order = o.id_order
    LEFT JOIN ${t.product} p
      ON p.id_product = od.product_id
    LEFT JOIN ${t.manufacturer} m
      ON m.id_manufacturer = p.id_manufacturer
    WHERE o.valid = 1
    GROUP BY manufacturerStatus
  `;
}

export function manufacturerRankingSql(t: ProductClassificationTables): string {
  return `
    SELECT
      m.id_manufacturer AS manufacturerId,
      m.name AS manufacturerName,
      COUNT(DISTINCT od.product_id) AS productCount,
      COUNT(*) AS lineCount,
      COALESCE(SUM(od.product_quantity), 0) AS unitCount,
      COUNT(DISTINCT o.id_order) AS orderCount,
      COUNT(DISTINCT o.id_customer) AS customerCount,
      COALESCE(SUM(od.total_price_tax_incl), 0) AS spentTaxIncl,
      MIN(o.date_add) AS firstPurchasedAt,
      MAX(o.date_add) AS lastPurchasedAt
    FROM ${t.orders} o
    INNER JOIN ${t.order_detail} od
      ON od.id_order = o.id_order
    INNER JOIN ${t.product} p
      ON p.id_product = od.product_id
    INNER JOIN ${t.manufacturer} m
      ON m.id_manufacturer = p.id_manufacturer
    WHERE o.valid = 1
      AND p.id_manufacturer <> 0
      AND TRIM(m.name) <> ''
    GROUP BY m.id_manufacturer, m.name
    ORDER BY spentTaxIncl DESC, unitCount DESC, manufacturerId ASC
    LIMIT ?
  `;
}

export function reconciliationSql(t: ProductClassificationTables): string {
  return `
    SELECT
      COUNT(DISTINCT o.id_order) AS validOrderCount,
      COALESCE(SUM(o.total_paid_tax_incl), 0) AS orderPaidTaxIncl,
      COUNT(*) AS orderLineCount,
      COALESCE(SUM(od.product_quantity), 0) AS lineUnits,
      COALESCE(SUM(od.total_price_tax_incl), 0) AS lineSpentTaxIncl,
      COUNT(DISTINCT od.product_id) AS lineProducts
    FROM ${t.orders} o
    INNER JOIN ${t.order_detail} od
      ON od.id_order = o.id_order
    WHERE o.valid = 1
  `;
}

export function customerCategoryPreferenceCandidateSql(t: ProductClassificationTables): string {
  return `${categoryRankingSql(t).replace('WHERE o.valid = 1', 'WHERE o.valid = 1 AND o.id_customer = ?')}`;
}

export function customerManufacturerPreferenceCandidateSql(t: ProductClassificationTables): string {
  return `${manufacturerRankingSql(t).replace('WHERE o.valid = 1', 'WHERE o.valid = 1 AND o.id_customer = ?')}`;
}

export function customerCoverageCandidateSql(t: ProductClassificationTables): string {
  return `${categoryCoverageSql(t).replace('WHERE o.valid = 1', 'WHERE o.valid = 1 AND o.id_customer = ?')}`;
}

export function combinedCustomerPreferenceCandidateSql(t: ProductClassificationTables): string {
  return `
    SELECT
      'category' AS preferenceType,
      resolvedCategoryId AS preferenceId,
      COUNT(*) AS lineCount,
      COALESCE(SUM(product_quantity), 0) AS unitCount,
      COUNT(DISTINCT id_order) AS orderCount,
      COALESCE(SUM(total_price_tax_incl), 0) AS spentTaxIncl
    FROM (
      SELECT
        o.id_order,
        od.product_quantity,
        od.total_price_tax_incl,
        COALESCE(ps.id_category_default, p.id_category_default) AS resolvedCategoryId
      FROM ${t.orders} o
      INNER JOIN ${t.order_detail} od
        ON od.id_order = o.id_order
      INNER JOIN ${t.product} p
        ON p.id_product = od.product_id
      LEFT JOIN ${t.product_shop} ps
        ON ps.id_product = p.id_product
       AND ps.id_shop = ?
      WHERE o.valid = 1
        AND o.id_customer = ?
    ) category_lines
    WHERE resolvedCategoryId IS NOT NULL
      AND resolvedCategoryId <> 0
    GROUP BY preferenceType, preferenceId
    UNION ALL
    SELECT
      'manufacturer' AS preferenceType,
      p.id_manufacturer AS preferenceId,
      COUNT(*) AS lineCount,
      COALESCE(SUM(od.product_quantity), 0) AS unitCount,
      COUNT(DISTINCT o.id_order) AS orderCount,
      COALESCE(SUM(od.total_price_tax_incl), 0) AS spentTaxIncl
    FROM ${t.orders} o
    INNER JOIN ${t.order_detail} od
      ON od.id_order = o.id_order
    INNER JOIN ${t.product} p
      ON p.id_product = od.product_id
    WHERE o.valid = 1
      AND o.id_customer = ?
      AND p.id_manufacturer <> 0
    GROUP BY preferenceType, preferenceId
    ORDER BY spentTaxIncl DESC
    LIMIT ?
  `;
}
