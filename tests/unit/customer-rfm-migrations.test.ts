import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readMigration('002_create_customer_rfm_snapshot_tables.sql');
const rollback = readMigration('002_create_customer_rfm_snapshot_tables.rollback.sql');
const segmentationMigration = readMigration('003_add_customer_rfm_snapshot_row_segments.sql');
const segmentationRollback = readMigration('003_add_customer_rfm_snapshot_row_segments.rollback.sql');
const runMigration = readMigration('004_create_customer_rfm_snapshot_run_table.sql');
const runRollback = readMigration('004_create_customer_rfm_snapshot_run_table.rollback.sql');

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

  it('adds nullable deterministic segment fields without breaking historical rows', () => {
    const sql = normalizeSql(segmentationMigration);

    expect(sql).toContain('ALTER TABLE CUSTOMER_RFM_SNAPSHOT_ROW');
    expect(sql).toContain('ADD COLUMN SEGMENT_CODE VARCHAR(64) NULL');
    expect(sql).toContain('ADD COLUMN SEGMENT_VERSION VARCHAR(100) NULL');
    expect(sql).toContain('ADD KEY IDX_CUSTOMER_RFM_SNAPSHOT_ROW_SNAPSHOT_SEGMENT (SNAPSHOT_ID, SEGMENT_CODE)');
  });

  it('drops segment fields and their index in rollback', () => {
    const sql = normalizeSql(segmentationRollback);

    expect(sql).toContain('DROP INDEX IDX_CUSTOMER_RFM_SNAPSHOT_ROW_SNAPSHOT_SEGMENT');
    expect(sql).toContain('DROP COLUMN SEGMENT_VERSION');
    expect(sql).toContain('DROP COLUMN SEGMENT_CODE');
  });

  it('creates an operational run log table with status, snapshot linkage and summary persistence', () => {
    const sql = normalizeSql(runMigration);

    expect(sql).toContain('CREATE TABLE CUSTOMER_RFM_SNAPSHOT_RUN');
    expect(sql).toContain("TRIGGER_SOURCE ENUM('MANUAL', 'SCHEDULED') NOT NULL");
    expect(sql).toContain("STATUS ENUM('STARTED', 'SUCCEEDED', 'FAILED', 'SKIPPED') NOT NULL");
    expect(sql).toContain('SNAPSHOT_KEY VARCHAR(512) NOT NULL');
    expect(sql).toContain('SUMMARY_JSON JSON NULL');
    expect(sql).toContain('IDX_CUSTOMER_RFM_SNAPSHOT_RUN_STATUS_STARTED');
    expect(sql).toContain('FOREIGN KEY (SNAPSHOT_ID)');
  });

  it('rolls back the operational run log table cleanly', () => {
    const sql = normalizeSql(runRollback);

    expect(sql).toContain('DROP TABLE IF EXISTS CUSTOMER_RFM_SNAPSHOT_RUN;');
  });
});
