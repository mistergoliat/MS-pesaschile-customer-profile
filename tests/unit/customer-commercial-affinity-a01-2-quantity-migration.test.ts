import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve('migrations/015_add_customer_commercial_affinity_supporting_units.sql');
const rollbackPath = resolve('migrations/015_add_customer_commercial_affinity_supporting_units.rollback.sql');

describe('Customer Commercial Affinity A01.2 quantity migration', () => {
  it('adds nullable BIGINT supporting units with a positive-value check', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('ADD COLUMN supporting_units BIGINT UNSIGNED NULL');
    expect(sql).toContain('supporting_units IS NULL OR supporting_units >= 1');
    expect(sql).not.toMatch(/UPDATE|DELETE|DROP TABLE/iu);
  });

  it('rolls back only the additive constraint and column', () => {
    const sql = readFileSync(rollbackPath, 'utf8');
    expect(sql).toContain('DROP CONSTRAINT chk_customer_commercial_affinity_snapshot_row_supporting_units');
    expect(sql).toContain('DROP COLUMN supporting_units');
  });
});
