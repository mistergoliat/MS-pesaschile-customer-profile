import { describe, expect, it } from 'vitest';
import { assessGrants, evaluateLoad } from '../../scripts/audits/order-state-semantics/lib/guardrails.js';

describe('assessGrants', () => {
  it('is safe for USAGE only (the baseline "no privileges" grant)', () => {
    const result = assessGrants(["GRANT USAGE ON *.* TO 'audit'@'%'"]);

    expect(result).toEqual({ safe: true, disallowedPrivileges: [], hasGrantOption: false });
  });

  it('is safe for SELECT only', () => {
    const result = assessGrants(["GRANT USAGE ON *.* TO 'audit'@'%'", "GRANT SELECT ON `pesas_productiva`.* TO 'audit'@'%'"]);

    expect(result.safe).toBe(true);
    expect(result.disallowedPrivileges).toEqual([]);
  });

  it('is unsafe when INSERT is granted alongside SELECT', () => {
    const result = assessGrants(["GRANT SELECT, INSERT ON `pesas_productiva`.* TO 'audit'@'%'"]);

    expect(result.safe).toBe(false);
    expect(result.disallowedPrivileges).toEqual(['INSERT']);
  });

  it('is unsafe for ALL PRIVILEGES', () => {
    const result = assessGrants(["GRANT ALL PRIVILEGES ON `pesas_productiva`.* TO 'audit'@'%'"]);

    expect(result.safe).toBe(false);
    expect(result.disallowedPrivileges).toEqual(['ALL PRIVILEGES']);
  });

  it('is unsafe when WITH GRANT OPTION is present, even for SELECT', () => {
    const result = assessGrants(["GRANT SELECT ON `pesas_productiva`.* TO 'audit'@'%' WITH GRANT OPTION"]);

    expect(result.safe).toBe(false);
    expect(result.hasGrantOption).toBe(true);
  });

  it('is unsafe if any one of several GRANT statements is unsafe', () => {
    const result = assessGrants([
      "GRANT USAGE ON *.* TO 'audit'@'%'",
      "GRANT SELECT ON `pesas_productiva`.* TO 'audit'@'%'",
      "GRANT SELECT ON `main_management`.* TO 'audit'@'%'",
      "GRANT DELETE ON `pesas_productiva`.`ps_orders` TO 'audit'@'%'",
    ]);

    expect(result.safe).toBe(false);
    expect(result.disallowedPrivileges).toEqual(['DELETE']);
  });
});

describe('evaluateLoad', () => {
  it('is safe under both thresholds', () => {
    const result = evaluateLoad(10, 100);

    expect(result).toMatchObject({ safe: true, reason: null });
  });

  it('is unsafe at the absolute threads_running limit', () => {
    const result = evaluateLoad(50, 1000);

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Threads_running (50)');
  });

  it('is safe just under the absolute limit', () => {
    const result = evaluateLoad(49, 1000);

    expect(result.safe).toBe(true);
  });

  it('is unsafe at the ratio limit even with low absolute threads', () => {
    const result = evaluateLoad(35, 50); // 0.7 ratio

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('max_connections');
  });

  it('is safe just under the ratio limit', () => {
    const result = evaluateLoad(34, 50); // 0.68 ratio

    expect(result.safe).toBe(true);
  });

  it('does not divide by zero when max_connections is 0', () => {
    const result = evaluateLoad(10, 0);

    expect(result.ratio).toBe(0);
    expect(result.safe).toBe(true);
  });
});
