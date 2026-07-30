import { describe, expect, it } from 'vitest';
import { assertAggregateOnlySql, assertNoPiiInResult } from '../../scripts/audits/rfm-population/lib/pii-guard.js';
import { emailQualitySql, duplicateEmailGroupsSql } from '../../scripts/audits/rfm-population/lib/identity-quality-sql.js';
import { buildPrestashopTables } from '../../scripts/audits/rfm-population/lib/sql.js';

const tables = buildPrestashopTables('ps_');

describe('RFM population audit PII guard (section 2)', () => {
  it('allows aggregate SQL that references email internally, unlike the strict shared guardrail', () => {
    expect(() => assertAggregateOnlySql(emailQualitySql(tables), 'email-quality')).not.toThrow();
    expect(() => assertAggregateOnlySql(duplicateEmailGroupsSql(tables), 'duplicate-emails')).not.toThrow();
  });

  it('still rejects writes and SELECT *', () => {
    expect(() => assertAggregateOnlySql('DELETE FROM ps_customer', 'x')).toThrow(/write\/DDL/);
    expect(() => assertAggregateOnlySql('SELECT * FROM ps_customer', 'x')).toThrow(/SELECT \*/);
  });

  it('never selects a raw email column as an outer SELECT item in the real query builders', () => {
    const normalized = (sql: string): string => sql.replace(/\s+/g, ' ').trim().toUpperCase();
    expect(normalized(emailQualitySql(tables))).not.toMatch(/SELECT\s+EMAIL\b/);
    expect(normalized(duplicateEmailGroupsSql(tables))).not.toMatch(/SELECT\s+EMAIL\b/);
  });

  it('rejects a result whose field name looks like PII', () => {
    expect(() =>
      assertNoPiiInResult([{ name: 'email' }], [{ email: 'irrelevant' }], 'bad-query'),
    ).toThrow(/forbidden PII field/);
    expect(() => assertNoPiiInResult([{ name: 'duplicateEmailGroups' }], [{ duplicateEmailGroups: 3 }], 'ok-query')).not.toThrow();
  });

  it('rejects a result row whose value looks like an email address', () => {
    expect(() =>
      assertNoPiiInResult([{ name: 'someCount' }], [{ someCount: 'user@example.com' }], 'leaky-query'),
    ).toThrow(/shaped like an email/);
    expect(() => assertNoPiiInResult([{ name: 'someCount' }], [{ someCount: 42 }], 'safe-query')).not.toThrow();
  });
});
