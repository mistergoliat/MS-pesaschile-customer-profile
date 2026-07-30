// CP-R1-T10A extension (section 2): PrestaShop identity quality, aggregated only. Every
// query here returns COUNT/SUM aggregates — never a raw email, name, phone or individual
// id_customer. Queries that must reference `email` internally (WHERE/GROUP BY/JOIN key)
// are guarded at call time by assertNoPiiInResult (./pii-guard.ts), which inspects the
// actual returned field names and values instead of the SQL text, because the shared
// assertSafeSql from ./guardrails.ts forbids the `email` token outright (see pii-guard.ts
// header comment for why that guard is not reused here).
import type { RfmPrestashopTables } from './sql.js';

export function identityCoreCountsSql(t: RfmPrestashopTables): string {
  return `
    SELECT
      COUNT(*) AS totalPrestashopCustomers,
      COALESCE(SUM(CASE WHEN vo.id_customer IS NOT NULL THEN 1 ELSE 0 END), 0) AS customersWithValidOrders,
      COALESCE(SUM(CASE WHEN vo.id_customer IS NULL THEN 1 ELSE 0 END), 0) AS customersWithoutValidOrders,
      COALESCE(SUM(CASE WHEN c.deleted = 1 THEN 1 ELSE 0 END), 0) AS deletedAccounts,
      COALESCE(SUM(CASE WHEN c.active = 0 THEN 1 ELSE 0 END), 0) AS inactiveAccounts,
      COALESCE(SUM(CASE WHEN c.is_guest = 1 THEN 1 ELSE 0 END), 0) AS guestAccounts,
      COALESCE(SUM(CASE WHEN c.company IS NOT NULL AND TRIM(c.company) <> '' THEN 1 ELSE 0 END), 0) AS accountsWithCompanyName
    FROM ${t.customer} c
    LEFT JOIN (SELECT DISTINCT id_customer FROM ${t.orders} WHERE valid = 1) vo
      ON vo.id_customer = c.id_customer
  `;
}

// References `email` only inside CASE/REGEXP/LIKE expressions that collapse to a 0/1 flag
// before SUM(); the email value itself is never part of the result set.
export function emailQualitySql(t: RfmPrestashopTables): string {
  return `
    SELECT
      COALESCE(SUM(CASE WHEN email IS NULL OR TRIM(email) = '' THEN 1 ELSE 0 END), 0) AS emptyEmails,
      COALESCE(SUM(CASE
        WHEN (email IS NOT NULL AND TRIM(email) <> '')
         AND email NOT REGEXP '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\\\.[A-Za-z]{2,}$'
        THEN 1 ELSE 0 END), 0) AS invalidEmails,
      COALESCE(SUM(CASE
        WHEN email LIKE '%test%' OR email LIKE '%prueba%' OR email LIKE '%interno%'
          OR email LIKE '%demo%' OR email LIKE '%ejemplo%' OR email LIKE '%noreply%'
          OR email LIKE '%no-reply%' OR email LIKE '%example.com'
        THEN 1 ELSE 0 END), 0) AS testOrInternalPatternEmails
    FROM ${t.customer}
  `;
}

// Normalized-email duplicate groups. The GROUP BY key (LOWER(TRIM(email))) never appears
// in any SELECT list at any nesting level — only COUNT(*) of the grouped rows does.
export function duplicateEmailGroupsSql(t: RfmPrestashopTables): string {
  return `
    SELECT
      COUNT(*) AS duplicateEmailGroups,
      COALESCE(SUM(cnt), 0) AS accountsInDuplicateEmailGroups,
      COALESCE(MAX(cnt), 0) AS maxAccountsSharingOneEmail
    FROM (
      SELECT COUNT(*) AS cnt
      FROM ${t.customer}
      WHERE email IS NOT NULL AND TRIM(email) <> ''
      GROUP BY LOWER(TRIM(email))
      HAVING COUNT(*) > 1
    ) duplicated
  `;
}

// How much valid-order volume and gross spend sits behind accounts sharing a normalized
// email with at least one other account. Joins through a derived table keyed by normalized
// email; the email value is used only as a join predicate, never selected.
export function duplicateEmailOrderImpactSql(t: RfmPrestashopTables): string {
  return `
    SELECT
      COUNT(DISTINCT o.id_order) AS validOrdersFromDuplicateEmailAccounts,
      COALESCE(SUM(o.total_paid_tax_incl), 0) AS validGrossMonetaryTaxInclFromDuplicateEmailAccounts
    FROM ${t.orders} o
    INNER JOIN ${t.customer} c ON c.id_customer = o.id_customer
    INNER JOIN (
      SELECT LOWER(TRIM(email)) AS normalizedEmail
      FROM ${t.customer}
      WHERE email IS NOT NULL AND TRIM(email) <> ''
      GROUP BY LOWER(TRIM(email))
      HAVING COUNT(*) > 1
    ) dup ON dup.normalizedEmail = LOWER(TRIM(c.email))
    WHERE o.valid = 1
  `;
}

// Lifetime order-count thresholds per account (section 2's >10/50/100/500/1000 checks).
// Independent from the window-scoped frequency used for RFM scoring (section 6).
export function lifetimeFrequencyThresholdsSql(t: RfmPrestashopTables): string {
  return `
    SELECT
      COALESCE(SUM(CASE WHEN cnt > 10 THEN 1 ELSE 0 END), 0) AS accountsOver10,
      COALESCE(SUM(CASE WHEN cnt > 50 THEN 1 ELSE 0 END), 0) AS accountsOver50,
      COALESCE(SUM(CASE WHEN cnt > 100 THEN 1 ELSE 0 END), 0) AS accountsOver100,
      COALESCE(SUM(CASE WHEN cnt > 500 THEN 1 ELSE 0 END), 0) AS accountsOver500,
      COALESCE(SUM(CASE WHEN cnt > 1000 THEN 1 ELSE 0 END), 0) AS accountsOver1000
    FROM (
      SELECT COUNT(*) AS cnt
      FROM ${t.orders}
      WHERE valid = 1
      GROUP BY id_customer
    ) lifetime_frequency
  `;
}

// Heuristic-only diagnostic: accounts whose lifetime valid-order cadence (>50 orders and
// averaging more than 2 orders per distinct calendar day) looks operational rather than an
// individual shopper. Explicitly not a determination of fact — see docs Interpretations.
export function potentialSharedAccountsSql(t: RfmPrestashopTables): string {
  return `
    SELECT COUNT(*) AS potentialSharedOrInstitutionalAccounts
    FROM (
      SELECT
        id_customer,
        COUNT(*) AS cnt,
        COUNT(DISTINCT DATE(date_add)) AS distinctDays
      FROM ${t.orders}
      WHERE valid = 1
      GROUP BY id_customer
      HAVING COUNT(*) > 50 AND COUNT(*) > COUNT(DISTINCT DATE(date_add)) * 2
    ) candidate
  `;
}
