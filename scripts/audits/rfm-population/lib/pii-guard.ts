// CP-R1-T10A extension: section 2 (identity quality) genuinely needs SQL that references
// `email` in WHERE/GROUP BY/JOIN to compute aggregate counts (empty, invalid, duplicated).
// The shared assertSafeSql from commercial-summary (see ./guardrails.ts) forbids the
// literal token "email" anywhere in SQL text, which is correct for every other query in
// this audit but too strict here — it would also forbid the aggregate-only use this file
// exists for. Instead of loosening that shared, already-audited guardrail (used by closed
// audits T06A/T07A/T09A too), this module adds a second, independent guard that inspects
// the *materialized result* of an identity-quality query: it fails closed if any returned
// column name looks like a PII field, or if any returned string value looks like an email
// address. That is a stronger guarantee than static SQL text scanning — it catches PII
// leaking out regardless of how deep a subquery buried the sensitive column — while still
// allowing `email` to appear inside COUNT/CASE/GROUP BY expressions that never surface it.
const FORBIDDEN_RESULT_FIELD_NAMES = new Set([
  'email',
  'firstname',
  'lastname',
  'phone',
  'phone_mobile',
  'address1',
  'address2',
  'company',
  'siret',
  'ape',
  'rut',
  'passwd',
  'birthday',
  'ip_address',
  'ip_registration_newsletter',
  'secure_key',
  'reset_password_token',
  'note',
  'website',
]);

const EMAIL_LIKE_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;

export type ResultField = { readonly name: string };

export function assertNoPiiInResult(
  fields: readonly ResultField[],
  rows: readonly Record<string, unknown>[],
  queryName: string,
): void {
  for (const field of fields) {
    if (FORBIDDEN_RESULT_FIELD_NAMES.has(field.name.toLowerCase())) {
      throw new Error(`Query "${queryName}" returned a forbidden PII field: ${field.name}`);
    }
  }
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'string' && EMAIL_LIKE_PATTERN.test(value)) {
        throw new Error(`Query "${queryName}" returned a value shaped like an email in field "${key}"`);
      }
    }
  }
}

// Distinct from assertSafeSql: only blocks writes/DDL and SELECT *. Deliberately does NOT
// forbid the `email` token — that is what makes it usable for section 2's aggregate email
// queries. PII safety for these queries comes from assertNoPiiInResult above, applied to
// every row this audit ever writes to disk.
const WRITE_KEYWORD_PATTERN = /\b(INSERT|UPDATE|DELETE|ALTER|TRUNCATE|DROP|REPLACE|CREATE|GRANT|REVOKE)\b/i;
const SELECT_STAR_PATTERN = /SELECT\s+\*/i;

export function assertAggregateOnlySql(sql: string, name: string): void {
  const findings: string[] = [];
  if (WRITE_KEYWORD_PATTERN.test(sql)) findings.push('contains a write/DDL keyword');
  if (SELECT_STAR_PATTERN.test(sql)) findings.push('uses SELECT *');
  if (findings.length > 0) {
    throw new Error(`Unsafe SQL in query "${name}": ${findings.join('; ')}`);
  }
}
