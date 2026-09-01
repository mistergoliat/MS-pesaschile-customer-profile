import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  calculateAffinityDatasetChecksum,
  CustomerCommercialAffinitySnapshotKeyConflictError,
  type CustomerCommercialAffinityPersistedSnapshotResult,
  type CustomerCommercialAffinitySnapshotHeader,
  type CustomerCommercialAffinitySnapshotLookup,
  type CustomerCommercialAffinitySnapshotStore,
  type CustomerCommercialAffinitySnapshotStatus,
  validateCustomerCommercialAffinitySnapshot,
} from '../../application/customer-commercial-affinity-snapshot/index.js';
import { assertValidAffinityRow, type CustomerCommercialAffinityAxis, type CustomerCommercialAffinityRow } from '../../domain/customer-commercial-affinity/index.js';
import { mapAnalyticsReadError } from '../customer-analytics/analytics-read-error.js';

const ROW_BATCH_SIZE = 500;

export function createMysqlCustomerCommercialAffinitySnapshotStore(pool: Pool): CustomerCommercialAffinitySnapshotStore {
  async function createBuilding(header: CustomerCommercialAffinitySnapshotHeader): Promise<string> {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const id = await insertBuildingSnapshot(connection, header);
      await connection.execute("UPDATE customer_commercial_affinity_snapshot SET manifest_json = JSON_SET(manifest_json, '$.snapshotId', ?, '$.status', 'building') WHERE id = ?", [String(id), id]);
      await connection.commit();
      return String(id);
    } catch (error) {
      await connection.rollback();
      throw mapPersistenceError(error);
    } finally {
      connection.release();
    }
  }

  async function writeRows(snapshotId: string, rows: readonly CustomerCommercialAffinityRow[]): Promise<void> {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await insertRows(connection, toPositiveInteger(snapshotId, 'snapshotId'), rows);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw mapPersistenceError(error);
    } finally {
      connection.release();
    }
  }

  async function markValidated(snapshotId: string): Promise<void> {
    await pool.execute(
      "UPDATE customer_commercial_affinity_snapshot SET status = 'validated', validated_at = generated_at, manifest_json = JSON_SET(manifest_json, '$.status', 'validated') WHERE id = ? AND status = 'building'",
      [toPositiveInteger(snapshotId, 'snapshotId')],
    );
  }

  async function publish(snapshotId: string): Promise<void> {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const numericId = toPositiveInteger(snapshotId, 'snapshotId');
      const [rows] = await connection.execute<RowDataPacket[]>(
        'SELECT calculation_version AS calculationVersion, population_policy_version AS populationPolicyVersion, order_eligibility_policy_version AS orderEligibilityPolicyVersion FROM customer_commercial_affinity_snapshot WHERE id = ? AND status = \'validated\' FOR UPDATE',
        [numericId],
      );
      if (!rows[0]) throw new Error(`Affinity snapshot ${snapshotId} is not validated`);
      await supersedePreviousPublishedSnapshots(connection, numericId, String(rows[0].calculationVersion), String(rows[0].populationPolicyVersion), String(rows[0].orderEligibilityPolicyVersion));
      await connection.execute("UPDATE customer_commercial_affinity_snapshot SET status = 'published', published_at = generated_at, manifest_json = JSON_SET(manifest_json, '$.status', 'published') WHERE id = ? AND status = 'validated'", [numericId]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw mapPersistenceError(error);
    } finally {
      connection.release();
    }
  }

  async function markFailed(snapshotId: string, reason: string): Promise<void> {
    const boundedReason = reason.slice(0, 500);
    await pool.execute(
      "UPDATE customer_commercial_affinity_snapshot SET status = 'failed', failure_reason = ?, manifest_json = JSON_SET(manifest_json, '$.status', 'failed') WHERE id = ? AND status IN ('building', 'validated')",
      [boundedReason, toPositiveInteger(snapshotId, 'snapshotId')],
    );
  }

  return {
    findSnapshotByKey: async (snapshotKey): Promise<CustomerCommercialAffinitySnapshotLookup | null> => {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(
          `SELECT id, status, dataset_checksum AS datasetChecksum, affinity_dataset_checksum AS affinityDatasetChecksum
             FROM customer_commercial_affinity_snapshot WHERE snapshot_key = ? LIMIT 1`,
          [snapshotKey],
        );
        const row = rows[0];
        return row ? {
          snapshotId: String(row.id),
          status: String(row.status) as CustomerCommercialAffinitySnapshotStatus,
          datasetChecksum: String(row.datasetChecksum),
          affinityDatasetChecksum: String(row.affinityDatasetChecksum),
        } : null;
      } catch (error) {
        throw mapAnalyticsReadError(error);
      }
    },

    publishSnapshot: async (input): Promise<CustomerCommercialAffinityPersistedSnapshotResult> => {
      // Repeat the application validation at the persistence boundary so a direct store caller
      // cannot publish malformed rows or a mismatched semantic lineage.
      validateCustomerCommercialAffinitySnapshot(input);
      const connection = await pool.getConnection();
      let snapshotId: number | null = null;
      try {
        await connection.beginTransaction();
        snapshotId = await insertBuildingSnapshot(connection, input.header);
        await insertRows(connection, snapshotId, input.rows);
        const persistedRowCount = await countRows(connection, snapshotId);
        if (persistedRowCount !== input.rows.length) throw new Error('Affinity snapshot persisted row count mismatch');
        const persistedChecksum = await calculatePersistedChecksum(connection, snapshotId, input.header);
        if (persistedChecksum !== input.header.affinityDatasetChecksum) throw new Error('Affinity snapshot persisted checksum mismatch');
        const persistedHeader = { ...input.header, snapshotId: String(snapshotId), status: 'validated' as const };
        await connection.execute(
          'UPDATE customer_commercial_affinity_snapshot SET manifest_json = ?, status = \'validated\', validated_at = generated_at WHERE id = ? AND status = \'building\'',
          [JSON.stringify(persistedHeader), snapshotId],
        );
        await supersedePreviousPublishedSnapshots(connection, snapshotId, input.header.calculationVersion, input.header.populationPolicyVersion, input.header.orderEligibilityPolicyVersion);
        await connection.execute("UPDATE customer_commercial_affinity_snapshot SET status = 'published', published_at = generated_at, manifest_json = JSON_SET(manifest_json, '$.status', 'published') WHERE id = ? AND status = 'validated'", [snapshotId]);
        await connection.commit();
        return { snapshotId: String(snapshotId), persistedRowCount, affinityDatasetChecksum: persistedChecksum };
      } catch (error) {
        await connection.rollback();
        if (snapshotId !== null) await recordFailure(pool, snapshotId, error instanceof Error ? error.message : String(error));
        throw mapPersistenceError(error);
      } finally {
        connection.release();
      }
    },

    createBuilding,
    writeRows,
    markValidated,
    publish,
    markFailed,

    async getActiveSnapshotMetadata() {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(
          "SELECT id, status, manifest_json FROM customer_commercial_affinity_snapshot WHERE status = 'published' ORDER BY published_at DESC, id DESC LIMIT 1",
        );
        return rows[0] ? parseHeader(rows[0]) : null;
      } catch (error) {
        throw mapAnalyticsReadError(error);
      }
    },

    async getCustomerAffinity(customerId) {
      assertCustomerId(customerId);
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(`${SELECT_ACTIVE_ROWS_SQL} AND r.customer_id = ? ORDER BY r.affinity_axis ASC, r.affinity_code ASC`, [customerId]);
        return rows.map(parseRow);
      } catch (error) {
        throw mapAnalyticsReadError(error);
      }
    },

    async getCustomerAffinities(customerIds) {
      if (customerIds.length > 5000) throw new Error('Affinity batch lookup is bounded to 5000 customers');
      if (customerIds.length === 0) return [];
      customerIds.forEach(assertCustomerId);
      try {
        const placeholders = customerIds.map(() => '?').join(', ');
        const [rows] = await pool.execute<RowDataPacket[]>(`${SELECT_ACTIVE_ROWS_SQL} AND r.customer_id IN (${placeholders}) ORDER BY r.customer_id ASC, r.affinity_axis ASC, r.affinity_code ASC`, [...customerIds]);
        return rows.map(parseRow);
      } catch (error) {
        throw mapAnalyticsReadError(error);
      }
    },
  };
}

const SELECT_ACTIVE_ROWS_SQL = `
  SELECT r.customer_id AS customerId, r.affinity_axis AS affinityAxis, r.affinity_code AS affinityCode,
         r.score, r.supporting_order_count AS supportingOrderCount,
         r.supporting_product_count AS supportingProductCount, r.supporting_spend AS supportingSpend,
         r.last_evidence_at AS lastEvidenceAt, r.explicit_evidence_coverage AS explicitEvidenceCoverage
    FROM customer_commercial_affinity_snapshot_row r
    INNER JOIN customer_commercial_affinity_snapshot s ON s.id = r.snapshot_id
   WHERE s.status = 'published'`;

async function insertBuildingSnapshot(connection: PoolConnection, header: CustomerCommercialAffinitySnapshotHeader): Promise<number> {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO customer_commercial_affinity_snapshot (
      snapshot_key, status, calculation_version, reference_time, generated_at,
      population_policy_version, order_eligibility_policy_version, product_semantic_snapshot_id,
      product_semantic_schema_version, ontology_version, ontology_hash, source_semantic_checksum,
      consumer_semantic_checksum, source_customer_count, eligible_customer_count, eligible_order_count,
      eligible_order_line_count, customers_with_affinity, customers_without_affinity, affinity_row_count,
      dataset_checksum, affinity_dataset_checksum, identity_authority, source_watermark_order_id,
      performance_metadata_json, manifest_json
    ) VALUES (?, 'building', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      header.snapshotKey, header.calculationVersion, toMysqlDateTime6(header.referenceTime), toMysqlDateTime6(header.generatedAt),
      header.populationPolicyVersion, header.orderEligibilityPolicyVersion, header.productSemanticSnapshotId,
      header.productSemanticSchemaVersion, header.ontologyVersion, header.ontologyHash, header.sourceSemanticChecksum,
      header.consumerSemanticChecksum, header.sourceCustomerCount, header.eligibleCustomerCount, header.eligibleOrderCount,
      header.eligibleOrderLineCount, header.customersWithAffinity, header.customersWithoutAffinity, header.affinityRowCount,
      header.datasetChecksum, header.affinityDatasetChecksum, header.identityAuthority, header.sourceWatermarkOrderId,
      header.performanceMetadata === undefined ? null : JSON.stringify(header.performanceMetadata), JSON.stringify(header),
    ],
  );
  return result.insertId;
}

async function insertRows(connection: PoolConnection, snapshotId: number, rows: readonly CustomerCommercialAffinityRow[]): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += ROW_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + ROW_BATCH_SIZE);
    const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    await connection.execute(
      `INSERT INTO customer_commercial_affinity_snapshot_row (
        snapshot_id, customer_id, affinity_axis, affinity_code, score, supporting_order_count,
        supporting_product_count, supporting_spend, last_evidence_at, explicit_evidence_coverage
      ) VALUES ${placeholders}`,
      batch.flatMap((row) => [snapshotId, row.customerId, row.affinityAxis, row.affinityCode, row.score.toFixed(9), row.supportingOrderCount, row.supportingProductCount, row.supportingSpend, toMysqlDateTime6(row.lastEvidenceAt), row.explicitEvidenceCoverage === null ? null : row.explicitEvidenceCoverage.toFixed(9)]),
    );
  }
}

async function countRows(connection: PoolConnection, snapshotId: number): Promise<number> {
  const [rows] = await connection.execute<RowDataPacket[]>('SELECT COUNT(*) AS rowCount FROM customer_commercial_affinity_snapshot_row WHERE snapshot_id = ?', [snapshotId]);
  return Number(rows[0]?.rowCount ?? 0);
}

async function calculatePersistedChecksum(connection: PoolConnection, snapshotId: number, header: CustomerCommercialAffinitySnapshotHeader): Promise<string> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT customer_id AS customerId, affinity_axis AS affinityAxis, affinity_code AS affinityCode,
            score, supporting_order_count AS supportingOrderCount, supporting_product_count AS supportingProductCount,
            supporting_spend AS supportingSpend, last_evidence_at AS lastEvidenceAt,
            explicit_evidence_coverage AS explicitEvidenceCoverage
       FROM customer_commercial_affinity_snapshot_row
      WHERE snapshot_id = ? ORDER BY customer_id ASC, affinity_axis ASC, affinity_code ASC FOR UPDATE`,
    [snapshotId],
  );
  return calculateAffinityDatasetChecksum(header, rows.map(parseRow));
}

async function supersedePreviousPublishedSnapshots(connection: PoolConnection, snapshotId: number, calculationVersion: string, populationPolicyVersion: string, orderEligibilityPolicyVersion: string): Promise<void> {
  await connection.execute(
    `UPDATE customer_commercial_affinity_snapshot
        SET status = 'superseded'
      WHERE id <> ? AND status = 'published'
        AND calculation_version = ? AND population_policy_version = ?
        AND order_eligibility_policy_version = ?`,
    [snapshotId, calculationVersion, populationPolicyVersion, orderEligibilityPolicyVersion],
  );
}

async function recordFailure(pool: Pool, snapshotId: number, reason: string): Promise<void> {
  try {
    await pool.execute("UPDATE customer_commercial_affinity_snapshot SET status = 'failed', failure_reason = ?, manifest_json = JSON_SET(manifest_json, '$.status', 'failed') WHERE id = ? AND status IN ('building', 'validated')", [reason.slice(0, 500), snapshotId]);
  } catch {
    // Preserve the original transaction failure. Failure recording is best-effort and never
    // masks the root cause or causes a retry to be reported as successful.
  }
}

function parseHeader(row: RowDataPacket): CustomerCommercialAffinitySnapshotHeader {
  const raw = typeof row.manifest_json === 'string' ? JSON.parse(row.manifest_json) : row.manifest_json;
  if (!raw || typeof raw !== 'object') throw new Error('Malformed affinity snapshot manifest');
  return { ...(raw as CustomerCommercialAffinitySnapshotHeader), snapshotId: String(row.id), status: String(row.status) as CustomerCommercialAffinitySnapshotStatus };
}

function parseRow(row: RowDataPacket): CustomerCommercialAffinityRow {
  const parsed: CustomerCommercialAffinityRow = {
    customerId: Number(row.customerId),
    affinityAxis: String(row.affinityAxis) as CustomerCommercialAffinityAxis,
    affinityCode: String(row.affinityCode),
    score: Number(row.score),
    supportingOrderCount: Number(row.supportingOrderCount),
    supportingProductCount: Number(row.supportingProductCount),
    supportingSpend: String(row.supportingSpend),
    lastEvidenceAt: toIsoFromDbDateTime(row.lastEvidenceAt),
    explicitEvidenceCoverage: row.explicitEvidenceCoverage === null ? null : Number(row.explicitEvidenceCoverage),
  };
  assertValidAffinityRow(parsed);
  return parsed;
}

function toIsoFromDbDateTime(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const date = new Date(`${value.replace(' ', 'T')}Z`);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  throw new Error('Invalid persisted affinity timestamp');
}

function toMysqlDateTime6(value: string): string {
  return new Date(value).toISOString().slice(0, 23).replace('T', ' ');
}

function toPositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Invalid ${name}`);
  return parsed;
}

function assertCustomerId(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('customerId must be a positive integer');
}

function mapPersistenceError(error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
  if (code === 'ER_DUP_ENTRY') return new CustomerCommercialAffinitySnapshotKeyConflictError();
  return error instanceof Error ? error : new Error('Unknown affinity snapshot persistence error', { cause: error });
}
