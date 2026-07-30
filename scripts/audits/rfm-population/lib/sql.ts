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

// CP-R1-T10A-3 correction: every "lifetime" column is bounded by `date_add < windowEndExclusive`
// — "lifetime" means cumulative history through asOfDate, never history the live source
// happens to hold at the moment this query executes. Without this bound, re-running the
// same RFM_AS_OF_DATE at a later wall-clock time against a still-accumulating database
// silently changes historical_inactive/no_valid_purchases counts and lifetime totals,
// which breaks the reproducibility guarantee this whole audit is built on (see
// docs/audits/rfm-population/CP-R1-T10A-3-commercial-population-finalization.md Facts).
// `hasFutureOnlyOrderFlag` is diagnostic only — it never feeds eligibility (that is decided
// purely from the now-bounded lifetimeValidOrderCount/windowValidOrderCount) — it exists so
// the caller can count, separately, identities whose only valid order activity falls on or
// after windowEndExclusive (see lib/lifecycle.ts classifyEligibility: with lifetime bounded,
// such an identity already resolves to 'no_valid_purchases' with zero special-casing).
// Bind params: see populationDatasetParams() below — do not hand-write this array.
export function populationDatasetSql(t: RfmPrestashopTables): string {
  return `
    SELECT
      o.id_customer AS prestashopCustomerId,
      MIN(CASE WHEN o.valid = 1 AND o.date_add < ? THEN o.date_add ELSE NULL END) AS firstValidOrderAt,
      MAX(CASE WHEN o.valid = 1 AND o.date_add < ? THEN o.date_add ELSE NULL END) AS lastValidOrderAt,
      COUNT(DISTINCT CASE WHEN o.valid = 1 AND o.date_add < ? THEN o.id_order ELSE NULL END) AS lifetimeValidOrderCount,
      COALESCE(SUM(CASE WHEN o.valid = 1 AND o.date_add < ? THEN o.total_paid_tax_incl ELSE 0 END), 0) AS lifetimeGrossMonetaryTaxIncl,
      COUNT(DISTINCT CASE WHEN o.valid = 1 AND o.date_add >= ? AND o.date_add < ? THEN o.id_order ELSE NULL END) AS windowValidOrderCount,
      COALESCE(SUM(CASE WHEN o.valid = 1 AND o.date_add >= ? AND o.date_add < ? THEN o.total_paid_tax_incl ELSE 0 END), 0) AS windowGrossMonetaryTaxIncl,
      MAX(CASE WHEN o.valid = 1 AND o.date_add >= ? AND o.date_add < ? THEN o.date_add ELSE NULL END) AS lastValidOrderAtInWindow,
      COUNT(DISTINCT CASE WHEN o.valid = 1 AND o.date_add < ? THEN o.id_shop ELSE NULL END) AS lifetimeDistinctShops,
      MAX(CASE WHEN o.valid = 1 AND o.date_add >= ? THEN 1 ELSE 0 END) AS hasFutureOnlyOrderFlag,
      MAX(c.deleted) AS customerDeletedFlag,
      MAX(c.active) AS customerActiveFlag,
      MAX(c.is_guest) AS customerGuestFlag
    FROM ${t.orders} o
    LEFT JOIN ${t.customer} c ON c.id_customer = o.id_customer
    GROUP BY o.id_customer
  `;
}

// Builds the bind array for populationDatasetSql in the exact positional order its `?`
// placeholders appear in the SQL text above — co-located so the query and its params can
// never drift out of sync. windowEndExclusive is repeated once per lifetime CASE (plus once
// for hasFutureOnlyOrderFlag); windowStartInclusive/windowEndExclusive are repeated once per
// window CASE, matching CP-R1-T10A/2's existing convention of repeating window bounds per use.
export function populationDatasetParams(windowStartInclusive: string, windowEndExclusive: string): readonly string[] {
  return [
    windowEndExclusive, // firstValidOrderAt
    windowEndExclusive, // lastValidOrderAt
    windowEndExclusive, // lifetimeValidOrderCount
    windowEndExclusive, // lifetimeGrossMonetaryTaxIncl
    windowStartInclusive,
    windowEndExclusive, // windowValidOrderCount
    windowStartInclusive,
    windowEndExclusive, // windowGrossMonetaryTaxIncl
    windowStartInclusive,
    windowEndExclusive, // lastValidOrderAtInWindow
    windowEndExclusive, // lifetimeDistinctShops
    windowEndExclusive, // hasFutureOnlyOrderFlag
  ];
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

// CP-R1-T10A extension (section 4, multishop). One row per (shop, active customer) pair
// inside the window, mirroring activePopulationSql but shop-scoped so per-shop R/F/M
// distributions can be built in JS without a separate round trip per shop.
export function shopScopedActivePopulationSql(t: RfmPrestashopTables): string {
  return `
    SELECT
      o.id_shop AS shopId,
      o.id_customer AS prestashopCustomerId,
      COUNT(DISTINCT o.id_order) AS frequencyOrders,
      COALESCE(SUM(o.total_paid_tax_incl), 0) AS grossMonetaryTaxIncl,
      MAX(o.date_add) AS lastValidOrderAtInWindow
    FROM ${t.orders} o
    WHERE o.valid = 1
      AND o.date_add >= ?
      AND o.date_add < ?
    GROUP BY o.id_shop, o.id_customer
  `;
}

// Lifetime (not window-scoped) per-shop totals, used for section 4's baseline "clientes por
// shop / órdenes por shop / gasto por shop" facts, independent of the 12-month RFM window.
// CP-R1-T10A-3 correction: bounded by date_add < windowEndExclusive — see populationDatasetSql
// header comment for why "lifetime" must never include orders dated at/after asOfDate's window.
// Bind params: [windowEndExclusive].
export function shopLifetimeTotalsSql(t: RfmPrestashopTables): string {
  return `
    SELECT
      o.id_shop AS shopId,
      COUNT(DISTINCT o.id_customer) AS customers,
      COUNT(*) AS validOrders,
      COALESCE(SUM(o.total_paid_tax_incl), 0) AS grossMonetaryTaxIncl
    FROM ${t.orders} o
    WHERE o.valid = 1
      AND o.date_add < ?
    GROUP BY o.id_shop
  `;
}

// Lifetime cross-shop presence: how many customers have a valid order in more than one shop.
// CP-R1-T10A-3 correction: bounded by date_add < windowEndExclusive, same rationale as above.
// Bind params: [windowEndExclusive].
export function crossShopCustomerCountSql(t: RfmPrestashopTables): string {
  return `
    SELECT
      COUNT(*) AS customersWithValidOrders,
      COALESCE(SUM(CASE WHEN shopCount > 1 THEN 1 ELSE 0 END), 0) AS customersInMultipleShops
    FROM (
      SELECT o.id_customer, COUNT(DISTINCT o.id_shop) AS shopCount
      FROM ${t.orders} o
      WHERE o.valid = 1
        AND o.date_add < ?
      GROUP BY o.id_customer
    ) per_customer_shops
  `;
}

// CP-R1-T10A-3 extension (sections 4/12/17): window-scoped population restricted
// server-side to a single shop — used for the P1 "main commercial shop" population and for
// the 4-date temporal-stability re-runs of that same population, so EXPLAIN on this exact
// query (section 17) reflects real id_shop filtering instead of an all-shops scan filtered
// in application code.
export function mainShopActivePopulationSql(t: RfmPrestashopTables): string {
  return `
    SELECT
      o.id_customer AS prestashopCustomerId,
      COUNT(DISTINCT o.id_order) AS frequencyOrders,
      COALESCE(SUM(o.total_paid_tax_incl), 0) AS grossMonetaryTaxIncl,
      MAX(o.date_add) AS lastValidOrderAtInWindow
    FROM ${t.orders} o
    WHERE o.valid = 1
      AND o.id_shop = ?
      AND o.date_add >= ?
      AND o.date_add < ?
    GROUP BY o.id_customer
  `;
}

// CP-R1-T10A-3 extension (sections 4/7/14): lifetime (not window-scoped) per-(shop,
// customer) aggregate, symmetric with shopScopedActivePopulationSql above. Used to build
// P1/P2 commercial-population policies, the historical-inactive-by-shop breakdown (both
// allShopsHistoricalInactive and commercialShopHistoricalInactive), and the
// operational-account signal inputs (concentration in shop 2/3, order density) without ever
// selecting a raw identity — only aggregate counts per (shop, customer) pair, joined in
// memory, never published individually.
// CP-R1-T10A-3 correction: bounded by date_add < windowEndExclusive, same rationale as
// populationDatasetSql above — "lifetime" here must also mean "through asOfDate", not
// "through whenever this query happens to run". Bind params: [windowEndExclusive].
export function shopScopedLifetimePopulationSql(t: RfmPrestashopTables): string {
  return `
    SELECT
      o.id_shop AS shopId,
      o.id_customer AS prestashopCustomerId,
      MIN(o.date_add) AS firstValidOrderAt,
      MAX(o.date_add) AS lastValidOrderAt,
      COUNT(DISTINCT o.id_order) AS lifetimeOrders,
      COALESCE(SUM(o.total_paid_tax_incl), 0) AS lifetimeGrossMonetaryTaxIncl,
      COUNT(DISTINCT DATE(o.date_add)) AS lifetimeDistinctDays
    FROM ${t.orders} o
    WHERE o.valid = 1
      AND o.date_add < ?
    GROUP BY o.id_shop, o.id_customer
  `;
}

// Optional, non-PII shop label lookup (store name only). ps_shop is not part of the
// required RFM table set — this is probed separately and the caller falls back to bare
// shopId when the table is absent, so discovery of the core population dataset never
// depends on it.
export function shopLabelsSql(shopTableName: string): string {
  if (!SAFE_IDENTIFIER_PATTERN.test(shopTableName)) {
    throw new Error(`Unsafe PrestaShop shop table name: ${shopTableName}`);
  }
  return `SELECT id_shop AS shopId, name AS shopName FROM ${shopTableName}`;
}
