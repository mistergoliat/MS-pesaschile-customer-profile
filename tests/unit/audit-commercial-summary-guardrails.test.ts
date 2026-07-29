import { describe, expect, it } from 'vitest';
import { assessGrants, evaluateLoad } from '../../scripts/audits/commercial-summary/lib/guardrails.js';

// CP-R1-T07A section 3: guardrails are reused verbatim from CP-R1-T06A (see
// scripts/audits/commercial-summary/lib/guardrails.ts, a re-export). Exhaustive branch
// coverage already exists in tests/unit/audit-order-state-guardrails.test.ts — this file
// only confirms the T07A import path resolves to the same, correctly behaving functions,
// so it is deliberately small rather than a duplicate of that suite.
describe('commercial-summary guardrails re-export', () => {
  it('assessGrants is safe for SELECT/USAGE only', () => {
    const result = assessGrants(["GRANT USAGE ON *.* TO 'audit'@'%'", "GRANT SELECT ON `pesas_productiva`.* TO 'audit'@'%'"]);

    expect(result.safe).toBe(true);
  });

  it('assessGrants is unsafe when a write privilege is granted', () => {
    const result = assessGrants(["GRANT SELECT, DELETE ON `pesas_productiva`.* TO 'audit'@'%'"]);

    expect(result.safe).toBe(false);
    expect(result.disallowedPrivileges).toEqual(['DELETE']);
  });

  it('evaluateLoad is safe under both thresholds', () => {
    expect(evaluateLoad(5, 100).safe).toBe(true);
  });

  it('evaluateLoad is unsafe at the absolute Threads_running limit', () => {
    expect(evaluateLoad(50, 1000).safe).toBe(false);
  });
});
