import { describe, expect, it } from 'vitest';
import { assertSafeSql, findForbiddenSqlPatterns } from '../../scripts/audits/commercial-summary/lib/sql-guardrails.js';

describe('findForbiddenSqlPatterns', () => {
  it('is clean for an aggregate-only SELECT', () => {
    const sql = 'SELECT COUNT(*) AS c, SUM(total_paid_tax_incl) AS total FROM ps_orders WHERE valid = 1 GROUP BY id_customer';

    expect(findForbiddenSqlPatterns(sql)).toEqual([]);
  });

  it.each(['INSERT', 'UPDATE', 'DELETE', 'ALTER', 'TRUNCATE', 'DROP', 'REPLACE', 'CREATE', 'GRANT', 'REVOKE'])('flags a %s statement', (keyword) => {
    const findings = findForbiddenSqlPatterns(`${keyword} INTO ps_orders VALUES (1)`);

    expect(findings).toContain('contains a write/DDL keyword');
  });

  it('flags SELECT *', () => {
    const findings = findForbiddenSqlPatterns('SELECT * FROM ps_orders');

    expect(findings).toContain('uses SELECT *');
  });

  it('flags a query selecting email', () => {
    const findings = findForbiddenSqlPatterns('SELECT email FROM ps_customer');

    expect(findings.some((f) => f.includes('email'))).toBe(true);
  });

  it('flags a query selecting the order reference', () => {
    const findings = findForbiddenSqlPatterns('SELECT o.reference FROM ps_orders o');

    expect(findings.some((f) => f.includes('order reference'))).toBe(true);
  });

  it('does not flag id_reference (carrier reference id) as the forbidden order reference column', () => {
    const findings = findForbiddenSqlPatterns('SELECT c.id_reference FROM ps_carrier c');

    expect(findings).toEqual([]);
  });

  it('does not flag information_schema REFERENCED_TABLE_NAME as a reference violation', () => {
    const findings = findForbiddenSqlPatterns('SELECT REFERENCED_TABLE_NAME FROM information_schema.key_column_usage');

    expect(findings).toEqual([]);
  });

  it('flags firstname/lastname/address/phone', () => {
    expect(findForbiddenSqlPatterns('SELECT firstname FROM ps_customer').length).toBeGreaterThan(0);
    expect(findForbiddenSqlPatterns('SELECT lastname FROM ps_customer').length).toBeGreaterThan(0);
    expect(findForbiddenSqlPatterns('SELECT address1 FROM ps_address').length).toBeGreaterThan(0);
    expect(findForbiddenSqlPatterns('SELECT phone FROM ps_customer').length).toBeGreaterThan(0);
  });

  it('collects multiple independent findings for the same query', () => {
    const findings = findForbiddenSqlPatterns('SELECT * , email FROM ps_customer');

    expect(findings.length).toBeGreaterThanOrEqual(2);
  });
});

describe('assertSafeSql', () => {
  it('does not throw for a safe query', () => {
    expect(() => assertSafeSql('SELECT COUNT(*) FROM ps_orders WHERE valid = 1', 'test-query')).not.toThrow();
  });

  it('throws with the query name and findings for an unsafe query', () => {
    expect(() => assertSafeSql('DELETE FROM ps_orders', 'dangerous-query')).toThrow(/dangerous-query/);
  });
});
