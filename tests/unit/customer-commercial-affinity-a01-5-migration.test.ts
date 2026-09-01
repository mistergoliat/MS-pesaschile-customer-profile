import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve('migrations/013_create_customer_commercial_affinity_snapshot_tables.sql');
const rollbackPath = resolve('migrations/013_create_customer_commercial_affinity_snapshot_tables.rollback.sql');

describe('Customer Commercial Affinity A01.5 migration', () => {
  it('creates dedicated immutable header and normalized row tables with required constraints and indexes', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('CREATE TABLE customer_commercial_affinity_snapshot');
    expect(sql).toContain('CREATE TABLE customer_commercial_affinity_snapshot_row');
    expect(sql).toContain('uq_customer_commercial_affinity_snapshot_key');
    expect(sql).toContain('uq_customer_commercial_affinity_snapshot_row_identity');
    expect(sql).toContain('idx_customer_commercial_affinity_snapshot_row_customer');
    expect(sql).toContain("affinity_axis IN ('PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT')");
    expect(sql).toContain('supporting_spend DECIMAL(20,6)');
    expect(sql).toContain('score DECIMAL(12,9)');
    const ddl = sql.replace(/--.*$/gmu, '');
    expect(ddl).not.toMatch(/\b(FLOAT|DOUBLE)\b/iu);
  });

  it('has a rollback that removes rows before headers', () => {
    const sql = readFileSync(rollbackPath, 'utf8');
    expect(sql.indexOf('customer_commercial_affinity_snapshot_row')).toBeLessThan(sql.indexOf('customer_commercial_affinity_snapshot;'));
  });
});
