import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readMigration('002_create_customer_rfm_snapshot_tables.sql');
const rollback = readMigration('002_create_customer_rfm_snapshot_tables.rollback.sql');

function readMigration(fileName: string): string {
  return readFileSync(path.join(process.cwd(), 'migrations', fileName), 'utf8');
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toUpperCase();
}

describe('customer RFM snapshot migrations', () => {
  it('creates the service-owned snapshot tables with explicit storage defaults', () => {
    const sql = normalizeSql(migration);

    expect(sql).toContain('CREATE TABLE CUSTOMER_RFM_SNAPSHOT');
    expect(sql).toContain('CREATE TABLE CUSTOMER_RFM_SNAPSHOT_ROW');
    expect(sql.match(/ENGINE=INNODB DEFAULT CHARSET=UTF8MB4 COLLATE=UTF8MB4_UNICODE_CI/g)).toHaveLength(2);
  });

  it('declares required keys, constraints and monetary precision', () => {
    const sql = normalizeSql(migration);

    expect(sql).toContain('SNAPSHOT_KEY VARCHAR(512) NOT NULL');
    expect(sql).toContain('UNIQUE KEY UQ_CUSTOMER_RFM_SNAPSHOT_KEY (SNAPSHOT_KEY)');
    expect(sql).toContain('UNIQUE KEY UQ_CUSTOMER_RFM_SNAPSHOT_ROW_CUSTOMER (SNAPSHOT_ID, PRESTASHOP_CUSTOMER_ID)');
    expect(sql).toContain('IDX_CUSTOMER_RFM_SNAPSHOT_PUBLICATION_STREAM');
    expect(sql).toContain('IDX_CUSTOMER_RFM_SNAPSHOT_ROW_SNAPSHOT_SCORES');
    expect(sql).toContain('IDX_CUSTOMER_RFM_SNAPSHOT_ROW_SNAPSHOT_RFM_CODE');
    expect(sql).toContain('GROSS_ORDER_VALUE_TAX_INCL DECIMAL(20,6) NOT NULL');
    expect(sql).toContain('AVERAGE_ORDER_VALUE_TAX_INCL DECIMAL(20,6) NOT NULL');
    expect(sql).toContain('CHECK (RECENCY_SCORE BETWEEN 1 AND 5)');
    expect(sql).toContain('CHECK (FREQUENCY_SCORE BETWEEN 1 AND 5)');
    expect(sql).toContain('CHECK (MONETARY_SCORE BETWEEN 1 AND 5)');
  });

  it('keeps provisional identity isolated from master_customer', () => {
    const sql = normalizeSql(migration);

    expect(sql).toContain('MASTER_CUSTOMER_ID BIGINT UNSIGNED NULL');
    expect(sql).not.toContain('REFERENCES MASTER_CUSTOMER');
  });

  it('rolls back rows before headers so the migration can be reapplied on a disposable DB', () => {
    const sql = normalizeSql(rollback);
    const dropRows = 'DROP TABLE IF EXISTS CUSTOMER_RFM_SNAPSHOT_ROW;';
    const dropHeader = 'DROP TABLE IF EXISTS CUSTOMER_RFM_SNAPSHOT;';

    expect(sql).toContain(dropRows);
    expect(sql).toContain(dropHeader);
    expect(sql.indexOf(dropRows)).toBeLessThan(sql.indexOf(dropHeader));
  });
});
