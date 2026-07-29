// CP-R1-T07A section 3 (extends T06A's grants/load guardrails with a static content
// check): every SQL string this audit builds is checked against this before it runs.
// Pure string inspection — no DB access — so it is unit-testable independent of a live
// connection, and so a query that would violate the audit's own no-PII/no-writes rules
// never reaches the server in the first place, not just in review.
const WRITE_KEYWORD_PATTERN = /\b(INSERT|UPDATE|DELETE|ALTER|TRUNCATE|DROP|REPLACE|CREATE|GRANT|REVOKE)\b/i;
const SELECT_STAR_PATTERN = /SELECT\s+\*/i;

// Word-boundary patterns: `\b` does not match between two "word" characters (letters,
// digits, underscore), so `\breference\b` matches standalone `reference`/`o.reference`
// but not `id_reference` or `product_reference` (both remain a single token to \b).
const FORBIDDEN_COLUMN_PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'email', pattern: /\bemail\b/i },
  { label: 'firstname', pattern: /\bfirstname\b/i },
  { label: 'lastname', pattern: /\blastname\b/i },
  { label: 'address', pattern: /\baddress\d?\b/i },
  { label: 'phone', pattern: /\bphone\b/i },
  { label: 'order reference', pattern: /\breference\b/i },
];

export function findForbiddenSqlPatterns(sql: string): readonly string[] {
  const findings: string[] = [];

  if (WRITE_KEYWORD_PATTERN.test(sql)) {
    findings.push('contains a write/DDL keyword');
  }
  if (SELECT_STAR_PATTERN.test(sql)) {
    findings.push('uses SELECT *');
  }
  for (const { label, pattern } of FORBIDDEN_COLUMN_PATTERNS) {
    if (pattern.test(sql)) {
      findings.push(`references forbidden column: ${label}`);
    }
  }

  return findings;
}

export function assertSafeSql(sql: string, name: string): void {
  const findings = findForbiddenSqlPatterns(sql);
  if (findings.length > 0) {
    throw new Error(`Unsafe SQL in query "${name}": ${findings.join('; ')}`);
  }
}
