import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type {
  CustomerClvProductionSnapshotHeader,
  CustomerClvSnapshotStore,
  CustomerClvPersistedSnapshotResult,
} from '../../application/customer-clv/create-customer-clv-snapshot.js';
import { CustomerClvSnapshotKeyConflictError } from '../../application/customer-clv/create-customer-clv-snapshot.js';
import { assertValidCustomerClvSnapshotRow, type CustomerClvSnapshotRow, type CustomerClvSnapshotStatus } from '../../domain/customer-clv/index.js';
import { sha256Stable } from '../../domain/customer-rfm/checksum.js';

const ROW_BATCH_SIZE = 500;

export function createMysqlCustomerClvSnapshotStore(pool: Pool): CustomerClvSnapshotStore {
  return {
    async findPublishedSnapshot(snapshotKey) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT id, input_checksum, model_checksum, output_checksum
           FROM customer_clv_snapshot
          WHERE snapshot_key = ? AND status = 'published'
          LIMIT 1`,
        [snapshotKey],
      );
      const row = rows[0];
      return row
        ? { snapshotId: String(row.id), inputChecksum: String(row.input_checksum), modelChecksum: String(row.model_checksum), outputChecksum: String(row.output_checksum) }
        : null;
    },

    async publishSnapshot(input) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const snapshotId = await insertHeader(connection, input.header);
        await insertRows(connection, snapshotId, input.rows);
        const rowCount = await countRows(connection, snapshotId);
        if (rowCount !== input.rows.length) throw new Error('CLV snapshot persisted row count mismatch');
        const persistedChecksum = await calculateOutputChecksum(connection, snapshotId, input.header);
        if (persistedChecksum !== input.header.outputChecksum) throw new Error('CLV snapshot persisted output checksum mismatch');
        await connection.execute('UPDATE customer_clv_snapshot SET manifest_json = ? WHERE id = ? AND status = \'building\'', [JSON.stringify({ ...input.header, snapshotId: String(snapshotId) }), snapshotId]);
        await connection.execute(
          `SELECT id FROM customer_clv_snapshot
            WHERE status = 'published' AND id <> ? AND model_version = ?
              AND population_policy_version = ? AND monetary_policy_version = ?
            FOR UPDATE`,
          [snapshotId, input.header.modelVersion, input.header.populationPolicyVersion, input.header.monetaryPolicyVersion],
        );
        await connection.execute(
          `UPDATE customer_clv_snapshot SET status = 'superseded'
            WHERE id <> ? AND status = 'published' AND model_version = ?
              AND population_policy_version = ? AND monetary_policy_version = ?`,
          [snapshotId, input.header.modelVersion, input.header.populationPolicyVersion, input.header.monetaryPolicyVersion],
        );
        await connection.execute("UPDATE customer_clv_snapshot SET status = 'validated', validated_at = generated_at WHERE id = ? AND status = 'building'", [snapshotId]);
        await connection.execute("UPDATE customer_clv_snapshot SET status = 'published', published_at = generated_at WHERE id = ? AND status = 'validated'", [snapshotId]);
        await connection.commit();
        return { snapshotId: String(snapshotId), persistedRowCount: rowCount, outputChecksum: persistedChecksum } satisfies CustomerClvPersistedSnapshotResult;
      } catch (error) {
        await connection.rollback();
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
        if (code === 'ER_DUP_ENTRY') throw new CustomerClvSnapshotKeyConflictError();
        throw error instanceof Error ? error : new Error('Unknown CLV snapshot persistence error', { cause: error });
      } finally {
        connection.release();
      }
    },

    async getActiveSnapshotMetadata() {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM customer_clv_snapshot WHERE status = 'published' ORDER BY published_at DESC, id DESC LIMIT 1`,
      );
      return rows[0] ? parseHeader(rows[0]) : null;
    },

    async getCustomerClv(snapshotId, customerId) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT customer_id AS customerId, expected_revenue_tax_incl AS expectedRevenueTaxIncl,
                expected_orders AS expectedOrders, estimate_support_level AS estimateSupportLevel
           FROM customer_clv_snapshot_row WHERE snapshot_id = ? AND customer_id = ? LIMIT 1`,
        [snapshotId, customerId],
      );
      return rows[0] ? parseRow(rows[0]) : null;
    },

    async hasCustomer(snapshotId, customerId) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        'SELECT 1 AS present FROM customer_clv_snapshot_row WHERE snapshot_id = ? AND customer_id = ? LIMIT 1',
        [snapshotId, customerId],
      );
      return rows.length > 0;
    },

    async getRows(snapshotId, limit, offset) {
      if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 10000 || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid CLV snapshot pagination');
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT customer_id AS customerId, expected_revenue_tax_incl AS expectedRevenueTaxIncl,
                expected_orders AS expectedOrders, estimate_support_level AS estimateSupportLevel
           FROM customer_clv_snapshot_row WHERE snapshot_id = ? ORDER BY customer_id ASC LIMIT ? OFFSET ?`,
        [snapshotId, limit, offset],
      );
      return rows.map(parseRow);
    },
  };
}

async function insertHeader(connection: PoolConnection, header: CustomerClvProductionSnapshotHeader): Promise<number> {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO customer_clv_snapshot (
      snapshot_key, status, reference_time, generated_at, model_version, estimator_policy_version,
      horizon_months, currency_iso_code, population_policy_version, monetary_policy_version,
      dataset_version, activity_model_version, activity_training_window_policy,
      activity_recalibration_version, stale_adjustment_policy_version, conditional_value_policy_version,
      rank_refinement_policy_version, estimate_support_policy_version, training_time_policy_version,
      identity_authority, population_size, source_available_data_through, model_checksum,
      input_checksum, output_checksum, accepted_validation_decision, accepted_validation_artifact_version,
      accepted_validation_artifact_checksum, manifest_json, validated_at, published_at
    ) VALUES (?, 'building', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    [
      header.snapshotKey, toMysqlDateTime6(header.referenceTime), toMysqlDateTime6(header.generatedAt), header.modelVersion,
      header.estimatorPolicyVersion, header.horizonMonths, header.currencyIsoCode, header.populationPolicyVersion,
      header.monetaryPolicyVersion, header.datasetVersion, header.activityModelVersion, header.activityTrainingWindowPolicy,
      header.activityRecalibrationVersion, header.staleAdjustmentPolicyVersion, header.conditionalValuePolicyVersion,
      header.rankRefinementPolicyVersion, header.estimateSupportPolicyVersion, header.trainingTimePolicyVersion,
      header.identityAuthority, header.populationSize, toMysqlDateTime6(header.sourceAvailableDataThrough), header.modelChecksum,
      header.inputChecksum, header.outputChecksum, header.acceptedValidationDecision, header.acceptedValidationArtifactVersion,
      header.acceptedValidationArtifactChecksum, JSON.stringify(header),
    ],
  );
  return result.insertId;
}

async function insertRows(connection: PoolConnection, snapshotId: number, rows: readonly CustomerClvSnapshotRow[]): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += ROW_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + ROW_BATCH_SIZE);
    const placeholders = batch.map(() => '(?, ?, ?, ?, ?)').join(', ');
    await connection.execute(
      `INSERT INTO customer_clv_snapshot_row (snapshot_id, customer_id, expected_revenue_tax_incl, expected_orders, estimate_support_level) VALUES ${placeholders}`,
      batch.flatMap((row) => [snapshotId, row.customerId, row.expectedRevenueTaxIncl, row.expectedOrders ?? null, row.estimateSupportLevel]),
    );
  }
}

async function countRows(connection: PoolConnection, snapshotId: number): Promise<number> {
  const [rows] = await connection.execute<RowDataPacket[]>('SELECT COUNT(*) AS count FROM customer_clv_snapshot_row WHERE snapshot_id = ?', [snapshotId]);
  return Number(rows[0]?.count ?? 0);
}

async function calculateOutputChecksum(connection: PoolConnection, snapshotId: number, header: CustomerClvProductionSnapshotHeader): Promise<string> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT customer_id AS customerId, expected_revenue_tax_incl AS expectedRevenueTaxIncl,
            expected_orders AS expectedOrders, estimate_support_level AS estimateSupportLevel
       FROM customer_clv_snapshot_row WHERE snapshot_id = ? ORDER BY customer_id ASC`,
    [snapshotId],
  );
  return sha256Stable({ snapshotKey: header.snapshotKey, referenceTime: header.referenceTime, rows: rows.map(parseRow) });
}

function parseRow(row: RowDataPacket): CustomerClvSnapshotRow {
  const parsed = { customerId: Number(row.customerId), expectedRevenueTaxIncl: String(row.expectedRevenueTaxIncl), ...(row.expectedOrders === null ? {} : { expectedOrders: String(row.expectedOrders) }), estimateSupportLevel: String(row.estimateSupportLevel) as CustomerClvSnapshotRow['estimateSupportLevel'] };
  assertValidCustomerClvSnapshotRow(parsed);
  return parsed;
}

function parseHeader(row: RowDataPacket): CustomerClvProductionSnapshotHeader {
  const manifest = (typeof row.manifest_json === 'string' ? JSON.parse(row.manifest_json) : row.manifest_json) as CustomerClvProductionSnapshotHeader;
  return { ...manifest, snapshotId: String(row.id), status: String(row.status) as CustomerClvSnapshotStatus };
}

function toMysqlDateTime6(value: string): string {
  return new Date(value).toISOString().slice(0, 23).replace('T', ' ');
}
