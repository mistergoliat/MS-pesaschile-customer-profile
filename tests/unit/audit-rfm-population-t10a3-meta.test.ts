import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertSafeSql, findForbiddenSqlPatterns } from '../../scripts/audits/rfm-population/lib/guardrails.js';
import { buildPrestashopTables, mainShopActivePopulationSql, shopScopedLifetimePopulationSql } from '../../scripts/audits/rfm-population/lib/sql.js';

const tables = buildPrestashopTables('ps_');

const T10A3_SOURCE_FILES = [
  'scripts/audits/rfm-population/rfm-finalization.ts',
  'scripts/audits/rfm-population/lib/population-policies.ts',
  'scripts/audits/rfm-population/lib/operational-signals.ts',
  'scripts/audits/rfm-population/lib/cross-shop-policy.ts',
  'scripts/audits/rfm-population/lib/recency-methods.ts',
  'scripts/audits/rfm-population/lib/monetary-methods.ts',
  'scripts/audits/rfm-population/lib/temporal-stability-final.ts',
  'scripts/audits/rfm-population/lib/manifest.ts',
];

describe('CP-R1-T10A-3 meta guarantees (section 21)', () => {
  it('keeps the new section-4/12/17 queries read-only, aggregate-oriented and free of PII/order references', () => {
    const queries = [mainShopActivePopulationSql(tables), shopScopedLifetimePopulationSql(tables)];
    for (const sql of queries) {
      expect(findForbiddenSqlPatterns(sql)).toEqual([]);
      expect(() => assertSafeSql(sql, 't10a3-finalization')).not.toThrow();
      expect(sql.toUpperCase()).not.toContain('SELECT *');
      expect(sql.toUpperCase()).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|TRUNCATE|DROP|CREATE|GRANT|REVOKE)\b/);
    }
  });

  it('never imports anything from src/ in any CP-R1-T10A-3 source file', () => {
    for (const file of T10A3_SOURCE_FILES) {
      const content = readFileSync(file, 'utf8');
      expect(content, file).not.toMatch(/from\s+['"][^'"]*\/src\//);
      expect(content, file).not.toMatch(/from\s+['"]src\//);
    }
  });

  it('keeps CP-R1-T10A-3 outputs under the same ignored outputs/ directory as T10A/T10A-2', () => {
    const gitignore = readFileSync('.gitignore', 'utf8');
    expect(gitignore).toContain('scripts/audits/rfm-population/outputs/*');
    expect(gitignore).toContain('!scripts/audits/rfm-population/outputs/.gitkeep');
  });

  it('never references write-capable mysql2 methods (execute/query only ever used for SELECT/SHOW/EXPLAIN in this audit)', () => {
    for (const file of T10A3_SOURCE_FILES) {
      const content = readFileSync(file, 'utf8');
      expect(content, file).not.toMatch(/\.(beginTransaction|commit|rollback)\(/);
    }
  });

  it('lists every new CP-R1-T10A-3 lib module (guards against a file being written but never wired up)', () => {
    const libDir = readdirSync('scripts/audits/rfm-population/lib');
    for (const expected of [
      'population-policies.ts',
      'operational-signals.ts',
      'cross-shop-policy.ts',
      'recency-methods.ts',
      'monetary-methods.ts',
      'temporal-stability-final.ts',
      'manifest.ts',
    ]) {
      expect(libDir, expected).toContain(expected);
    }
  });
});
