const PRESTASHOP_SUFFIXES = ['orders', 'customer'] as const;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;

export type RfmPrestashopTables = Record<(typeof PRESTASHOP_SUFFIXES)[number], string>;

export function requiredRfmPrestashopSuffixes(): readonly string[] {
  return PRESTASHOP_SUFFIXES;
}

export function buildPrestashopTables(prefix: string): RfmPrestashopTables {
  if (!SAFE_IDENTIFIER_PATTERN.test(prefix)) {
    throw new Error(`Unsafe PrestaShop prefix: ${prefix}`);
  }
  return Object.fromEntries(PRESTASHOP_SUFFIXES.map((suffix) => [suffix, `${prefix}${suffix}`])) as RfmPrestashopTables;
}

export function validOrderEvidenceSql(t: RfmPrestashopTables): string {
  return `
    SELECT
      COUNT(*) AS validOrderCount,
      COUNT(DISTINCT id_customer) AS validOrderCustomerCount,
      COALESCE(SUM(total_paid_tax_incl), 0) AS grossMonetaryTaxIncl,
      COALESCE(SUM(CASE WHEN total_paid_tax_incl = 0 THEN 1 ELSE 0 END), 0) AS zeroAmountOrders,
      COALESCE(SUM(CASE WHEN total_paid_tax_incl < 0 THEN 1 ELSE 0 END), 0) AS negativeAmountOrders,
      COALESCE(SUM(CASE WHEN current_state IN (6, 7) THEN 1 ELSE 0 END), 0) AS cancelledOrRefundedValidOrders,
      COUNT(DISTINCT id_shop) AS shopCount,
      COUNT(DISTINCT id_currency) AS currencyCount,
      COUNT(DISTINCT conversion_rate) AS conversionRateCount
    FROM ${t.orders}
    WHERE valid = 1
  `;
}

export function populationDatasetSql(t: RfmPrestashopTables): string {
  return `
    SELECT
      o.id_customer AS prestashopCustomerId,
      MIN(CASE WHEN o.valid = 1 THEN o.date_add ELSE NULL END) AS firstValidOrderAt,
      MAX(CASE WHEN o.valid = 1 THEN o.date_add ELSE NULL END) AS lastValidOrderAt,
      COUNT(DISTINCT CASE WHEN o.valid = 1 THEN o.id_order ELSE NULL END) AS lifetimeValidOrderCount,
      COALESCE(SUM(CASE WHEN o.valid = 1 THEN o.total_paid_tax_incl ELSE 0 END), 0) AS lifetimeGrossMonetaryTaxIncl,
      COUNT(DISTINCT CASE WHEN o.valid = 1 AND o.date_add >= ? AND o.date_add < ? THEN o.id_order ELSE NULL END) AS windowValidOrderCount,
      COALESCE(SUM(CASE WHEN o.valid = 1 AND o.date_add >= ? AND o.date_add < ? THEN o.total_paid_tax_incl ELSE 0 END), 0) AS windowGrossMonetaryTaxIncl,
      MAX(CASE WHEN o.valid = 1 AND o.date_add >= ? AND o.date_add < ? THEN o.date_add ELSE NULL END) AS lastValidOrderAtInWindow
    FROM ${t.orders} o
    GROUP BY o.id_customer
  `;
}

export function activePopulationSql(t: RfmPrestashopTables): string {
  return `
    SELECT
      o.id_customer AS prestashopCustomerId,
      COUNT(DISTINCT o.id_order) AS frequencyOrders,
      COALESCE(SUM(o.total_paid_tax_incl), 0) AS grossMonetaryTaxIncl,
      MAX(o.date_add) AS lastValidOrderAtInWindow
    FROM ${t.orders} o
    WHERE o.valid = 1
      AND o.date_add >= ?
      AND o.date_add < ?
    GROUP BY o.id_customer
  `;
}

export function identityCoveragePrestashopSql(t: RfmPrestashopTables): string {
  return `
    SELECT
      COUNT(DISTINCT CASE WHEN id_customer > 0 THEN id_customer ELSE NULL END) AS prestashopCustomersWithValidOrders,
      COUNT(DISTINCT id_order) AS validOrders,
      COALESCE(SUM(total_paid_tax_incl), 0) AS validGrossMonetaryTaxIncl,
      COALESCE(SUM(CASE WHEN id_customer = 0 THEN 1 ELSE 0 END), 0) AS guestOrZeroCustomerOrders
    FROM ${t.orders}
    WHERE valid = 1
  `;
}

export function identityCoverageCrmSql(): string {
  return `
    SELECT
      COUNT(*) AS masterCount,
      COALESCE(SUM(CASE WHEN prestashop_customer_id IS NULL THEN 1 ELSE 0 END), 0) AS mastersWithoutPrestashopLink,
      COUNT(DISTINCT prestashop_customer_id) AS distinctPrestashopLinks,
      COALESCE(SUM(CASE WHEN prestashop_customer_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS mastersWithPrestashopLink
    FROM master_customer
  `;
}

export function duplicatePrestashopLinksCrmSql(): string {
  return `
    SELECT
      COUNT(*) AS duplicatePrestashopLinks
    FROM (
      SELECT
        prestashop_customer_id
      FROM master_customer
      WHERE prestashop_customer_id IS NOT NULL
      GROUP BY prestashop_customer_id
      HAVING COUNT(*) > 1
    ) duplicated_links
  `;
}

export function joinedCanonicalCoverageCandidateSql(t: RfmPrestashopTables): string {
  return `
    SELECT
      COUNT(DISTINCT o.id_order) AS validOrdersLinkedCanonically,
      COUNT(DISTINCT o.id_customer) AS prestashopCustomersWithValidOrdersLinkedCanonically,
      COALESCE(SUM(o.total_paid_tax_incl), 0) AS validGrossMonetaryTaxInclLinkedCanonically
    FROM ${t.orders} o
    INNER JOIN master_customer mc
      ON mc.prestashop_customer_id = o.id_customer
    WHERE o.valid = 1
  `;
}

export function explainPopulationExtractionSql(t: RfmPrestashopTables): string {
  return activePopulationSql(t);
}
