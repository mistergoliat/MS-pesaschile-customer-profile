import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve('migrations/014_add_customer_commercial_affinity_snapshot_population.sql');
const rollbackPath = resolve('migrations/014_add_customer_commercial_affinity_snapshot_population.rollback.sql');

describe('Customer Commercial Affinity A01.5.1 migration', () => {
  it('adds the nullable legacy-compatible checksum and normalized membership table', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('ADD COLUMN eligible_population_checksum CHAR(64) NULL');
    expect(sql).toContain('CREATE TABLE customer_commercial_affinity_snapshot_population');
    expect(sql).toContain('PRIMARY KEY (snapshot_id, customer_id)');
    expect(sql).toContain('FOREIGN KEY (snapshot_id) REFERENCES customer_commercial_affinity_snapshot (id) ON DELETE CASCADE');
    expect(sql).toContain('CHECK (customer_id > 0)');
    expect(sql).not.toMatch(/metadata|created_at|updated_at/iu);
  });

  it('rolls back membership before removing the header column', () => {
    const sql = readFileSync(rollbackPath, 'utf8');
    expect(sql.indexOf('DROP TABLE')).toBeLessThan(sql.indexOf('DROP COLUMN eligible_population_checksum'));
  });
});
