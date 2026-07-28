// SQL builders for the order_history audit (CP-R1-T06A section 11). Every variant here
// is a pure SELECT — no CREATE TEMPORARY TABLE, no writes — and every result is an
// aggregate (COUNT/GROUP BY), never a list of individual order ids, per the "no listar
// order IDs individuales" requirement.

// MySQL 8.0+ supports window functions (ROW_NUMBER); 5.7 and earlier do not. Both
// variants answer the same question — for each order, does its latest order_history
// row's id_order_state match orders.current_state? — aggregated into a distribution
// so the caller never sees a raw per-order row.
export function buildLatestHistorySql(prefix: string, supportsWindowFunctions: boolean): string {
  if (supportsWindowFunctions) {
    return `
      WITH latest_history AS (
        SELECT
          oh.id_order,
          oh.id_order_state,
          ROW_NUMBER() OVER (
            PARTITION BY oh.id_order
            ORDER BY oh.date_add DESC, oh.id_order_history DESC
          ) AS rn
        FROM ${prefix}order_history oh
      )
      SELECT
        o.current_state,
        lh.id_order_state AS latest_history_state,
        CASE WHEN lh.id_order_state IS NULL THEN 0 ELSE 1 END AS has_history,
        CASE WHEN lh.id_order_state = o.current_state THEN 1 ELSE 0 END AS matches_current_state,
        COUNT(*) AS order_count
      FROM ${prefix}orders o
      LEFT JOIN latest_history lh
        ON lh.id_order = o.id_order
       AND lh.rn = 1
      GROUP BY o.current_state, lh.id_order_state, has_history, matches_current_state
    `;
  }

  // Fallback for MySQL < 8.0: no window functions AND no `WITH` (CTEs also landed in
  // 8.0.1) — both are avoided here in favor of nested derived tables (subqueries in
  // FROM), which work on every MySQL version this script needs to support. Derives
  // "latest" via MAX(date_add) per order. If two history rows for the same order share
  // the exact max date_add with DIFFERENT id_order_state values, this query surfaces
  // both rather than silently picking one — that ambiguity is exactly what
  // buildLatestHistoryDuplicatesSql() below measures explicitly, so it is never hidden
  // by this query's aggregation.
  return `
    SELECT
      o.current_state,
      lh.id_order_state AS latest_history_state,
      CASE WHEN lh.id_order_state IS NULL THEN 0 ELSE 1 END AS has_history,
      CASE WHEN lh.id_order_state = o.current_state THEN 1 ELSE 0 END AS matches_current_state,
      COUNT(*) AS order_count
    FROM ${prefix}orders o
    LEFT JOIN (
      SELECT DISTINCT oh.id_order, oh.id_order_state
      FROM ${prefix}order_history oh
      INNER JOIN (
        SELECT id_order, MAX(date_add) AS latest_date
        FROM ${prefix}order_history
        GROUP BY id_order
      ) ld
        ON ld.id_order = oh.id_order
       AND ld.latest_date = oh.date_add
    ) lh
      ON lh.id_order = o.id_order
    GROUP BY o.current_state, lh.id_order_state, has_history, matches_current_state
  `;
}

// Orders whose order_history has more than one distinct id_order_state at the exact
// max(date_add) for that order — i.e. "latest" is genuinely ambiguous by timestamp
// alone. Works identically on any MySQL version (no window functions needed), so this
// metric is measured the same way regardless of which buildLatestHistorySql() variant
// is used for the match-rate query above.
export function buildLatestHistoryDuplicatesSql(prefix: string): string {
  return `
    SELECT COUNT(*) AS orders_with_duplicate_latest_history
    FROM (
      SELECT oh.id_order
      FROM ${prefix}order_history oh
      INNER JOIN (
        SELECT id_order, MAX(date_add) AS latest_date
        FROM ${prefix}order_history
        GROUP BY id_order
      ) ld
        ON ld.id_order = oh.id_order
       AND ld.latest_date = oh.date_add
      GROUP BY oh.id_order
      HAVING COUNT(DISTINCT oh.id_order_state) > 1
    ) duplicated
  `;
}

// Total rows, distinct orders represented, and min/avg/max events per order. Percentiles
// are deliberately not computed here: PERCENTILE_CONT requires MySQL 8.0.2+ and this
// script must stay correct on 5.7 — see the audit report's "Open decisions" section.
export function buildHistoryEventsPerOrderSql(prefix: string): string {
  return `
    SELECT
      COUNT(*) AS total_history_rows,
      COUNT(DISTINCT id_order) AS orders_with_history,
      MIN(events_per_order) AS min_events_per_order,
      AVG(events_per_order) AS avg_events_per_order,
      MAX(events_per_order) AS max_events_per_order
    FROM (
      SELECT id_order, COUNT(*) AS events_per_order
      FROM ${prefix}order_history
      GROUP BY id_order
    ) per_order
  `;
}

// order_history rows that reference an id_order missing from orders, or an
// id_order_state missing from order_state — schema-level orphans, not PII.
export function buildOrphanedHistorySql(prefix: string): string {
  return `
    SELECT
      SUM(CASE WHEN o.id_order IS NULL THEN 1 ELSE 0 END) AS rows_with_missing_order,
      SUM(CASE WHEN os.id_order_state IS NULL THEN 1 ELSE 0 END) AS rows_with_missing_state
    FROM ${prefix}order_history oh
    LEFT JOIN ${prefix}orders o ON o.id_order = oh.id_order
    LEFT JOIN ${prefix}order_state os ON os.id_order_state = oh.id_order_state
  `;
}
