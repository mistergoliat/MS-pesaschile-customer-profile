// CP-R1-T10A extension (section 3): investigates the single highest window-frequency
// PrestaShop customer in aggregate. The identifying id_customer value is only ever used
// inside a scalar subquery predicate (`o.id_customer = (SELECT ...)`) — it is never
// selected as an output column at any nesting level, so no query in this file can leak
// which customer it is, only aggregate facts about their order history.
import type { RfmPrestashopTables } from './sql.js';

// Locates the outlier implicitly (highest COUNT(*) of valid orders inside the window) and
// reports lifetime + window aggregates about it in one row. Bind params, in order:
// [windowStart, windowEnd] x4 (three CASE/COUNT window filters + one for the locating
// subquery), matching this audit's existing convention of repeating window bounds per use.
export function frequencyOutlierProfileSql(t: RfmPrestashopTables): string {
  return `
    SELECT
      COUNT(*) AS lifetimeValidOrders,
      COUNT(DISTINCT o.id_shop) AS lifetimeShopCount,
      MIN(o.date_add) AS firstValidOrderAt,
      MAX(o.date_add) AS lastValidOrderAt,
      COUNT(DISTINCT DATE(o.date_add)) AS lifetimeDistinctDays,
      COALESCE(SUM(o.total_paid_tax_incl), 0) AS lifetimeGrossMonetaryTaxIncl,
      COALESCE(SUM(CASE WHEN o.date_add >= ? AND o.date_add < ? THEN 1 ELSE 0 END), 0) AS windowValidOrders,
      COALESCE(SUM(CASE WHEN o.date_add >= ? AND o.date_add < ? THEN o.total_paid_tax_incl ELSE 0 END), 0) AS windowGrossMonetaryTaxIncl,
      COUNT(DISTINCT CASE WHEN o.date_add >= ? AND o.date_add < ? THEN DATE(o.date_add) ELSE NULL END) AS windowDistinctDays
    FROM ${t.orders} o
    WHERE o.valid = 1
      AND o.id_customer = (
        SELECT id_customer
        FROM ${t.orders}
        WHERE valid = 1 AND date_add >= ? AND date_add < ?
        GROUP BY id_customer
        ORDER BY COUNT(*) DESC
        LIMIT 1
      )
  `;
}

// Non-identifying account-state flags for the same implicitly-located outlier. Bind params:
// [windowStart, windowEnd].
export function frequencyOutlierAccountFlagsSql(t: RfmPrestashopTables): string {
  return `
    SELECT
      c.is_guest AS isGuest,
      c.active AS isActive,
      c.deleted AS isDeleted,
      (c.company IS NOT NULL AND TRIM(c.company) <> '') AS hasCompanyName,
      c.date_add AS customerCreatedAt
    FROM ${t.customer} c
    WHERE c.id_customer = (
      SELECT id_customer
      FROM ${t.orders}
      WHERE valid = 1 AND date_add >= ? AND date_add < ?
      GROUP BY id_customer
      ORDER BY COUNT(*) DESC
      LIMIT 1
    )
  `;
}

// Per-shop lifetime order split for the same implicitly-located outlier. Bind params:
// [windowStart, windowEnd].
export function frequencyOutlierShopBreakdownSql(t: RfmPrestashopTables): string {
  return `
    SELECT
      o.id_shop AS shopId,
      COUNT(*) AS lifetimeOrders
    FROM ${t.orders} o
    WHERE o.valid = 1
      AND o.id_customer = (
        SELECT id_customer
        FROM ${t.orders}
        WHERE valid = 1 AND date_add >= ? AND date_add < ?
        GROUP BY id_customer
        ORDER BY COUNT(*) DESC
        LIMIT 1
      )
    GROUP BY o.id_shop
  `;
}
