import type { ExecuteValues } from 'mysql2';
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
import { calculateEligibleCustomerPopulationChecksum } from '../../application/customer-commercial-affinity-population/index.js';
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

  async function writePopulation(snapshotId: string, eligibleCustomerIds: readonly number[]): Promise<void> {
    const numericSnapshotId = toPositiveInteger(snapshotId, 'snapshotId');
    const normalizedIds = normalizeEligibleCustomerIds(eligibleCustomerIds);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await insertPopulationRows(connection, numericSnapshotId, normalizedIds);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw mapPersistenceError(error);
    } finally {
      connection.release();
    }
  }

  async function markValidated(snapshotId: string): Promise<void> {
    const numericSnapshotId = toPositiveInteger(snapshotId, 'snapshotId');
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await assertPersistedSnapshotComplete(connection, numericSnapshotId);
      await connection.execute(
        "UPDATE customer_commercial_affinity_snapshot SET status = 'validated', validated_at = generated_at, manifest_json = JSON_SET(manifest_json, '$.status', 'validated') WHERE id = ? AND status = 'building'",
        [numericSnapshotId],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw mapPersistenceError(error);
    } finally {
      connection.release();
    }
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
          `SELECT id, status, dataset_checksum AS datasetChecksum, affinity_dataset_checksum AS affinityDatasetChecksum,
                  eligible_population_checksum AS eligiblePopulationChecksum
             FROM customer_commercial_affinity_snapshot WHERE snapshot_key = ? LIMIT 1`,
          [snapshotKey],
        );
        const row = rows[0];
        return row ? {
          snapshotId: String(row.id),
          status: String(row.status) as CustomerCommercialAffinitySnapshotStatus,
          datasetChecksum: String(row.datasetChecksum),
          affinityDatasetChecksum: String(row.affinityDatasetChecksum),
          eligiblePopulationChecksum: row.eligiblePopulationChecksum === null || row.eligiblePopulationChecksum === undefined ? null : String(row.eligiblePopulationChecksum),
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
      const persistenceStartedAt = performance.now();
      try {
        await connection.beginTransaction();
        snapshotId = await insertBuildingSnapshot(connection, input.header);
        const populationInsertStartedAt = performance.now();
        await insertPopulationRows(connection, snapshotId, normalizeEligibleCustomerIds(input.eligibleCustomerIds));
        const populationInsertDurationMs = roundDuration(performance.now() - populationInsertStartedAt);
        const populationChecksumStartedAt = performance.now();
        await assertPersistedPopulationChecksum(connection, snapshotId, input.header);
        const populationChecksumDurationMs = roundDuration(performance.now() - populationChecksumStartedAt);
        await insertRows(connection, snapshotId, input.rows);
        await assertPersistedAffinityCoverage(connection, snapshotId, input.header.customersWithAffinity);
        await assertPersistedRowSubset(connection, snapshotId);
        const persistedRowCount = await countRows(connection, snapshotId);
        if (persistedRowCount !== input.rows.length) throw new Error('Affinity snapshot persisted row count mismatch');
        const persistedChecksum = await calculatePersistedChecksum(connection, snapshotId, input.header);
        if (persistedChecksum !== input.header.affinityDatasetChecksum) throw new Error('Affinity snapshot persisted checksum mismatch');
        const persistedHeader = {
          ...input.header,
          snapshotId: String(snapshotId),
          status: 'validated' as const,
          performanceMetadata: {
            ...input.header.performanceMetadata,
            populationInsertDurationMs,
            populationChecksumDurationMs,
            persistenceDurationMs: roundDuration(performance.now() - persistenceStartedAt),
          },
        };
        await connection.execute(
          'UPDATE customer_commercial_affinity_snapshot SET manifest_json = ?, status = \'validated\', validated_at = generated_at WHERE id = ? AND status = \'building\'',
          [JSON.stringify(persistedHeader), snapshotId],
        );
        await supersedePreviousPublishedSnapshots(connection, snapshotId, input.header.calculationVersion, input.header.populationPolicyVersion, input.header.orderEligibilityPolicyVersion);
        await connection.execute("UPDATE customer_commercial_affinity_snapshot SET status = 'published', published_at = generated_at, manifest_json = JSON_SET(manifest_json, '$.status', 'published') WHERE id = ? AND status = 'validated'", [snapshotId]);
        await connection.commit();
        return {
          snapshotId: String(snapshotId),
          persistedRowCount,
          populationRowCount: input.eligibleCustomerIds.length,
          affinityDatasetChecksum: persistedChecksum,
          populationInsertDurationMs,
          populationChecksumDurationMs,
          persistenceDurationMs: roundDuration(performance.now() - persistenceStartedAt),
        };
      } catch (error) {
        await connection.rollback();
        if (snapshotId !== null) await recordFailure(pool, snapshotId, error instanceof Error ? error.message : String(error));
        throw mapPersistenceError(error);
      } finally {
        connection.release();
      }
    },

    createBuilding,
    writePopulation,
    writeRows,
    markValidated,
    publish,
    markFailed,

    async getActiveSnapshotMetadata() {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(
          "SELECT id, status, eligible_population_checksum AS eligiblePopulationChecksum, manifest_json FROM customer_commercial_affinity_snapshot WHERE status = 'published' ORDER BY published_at DESC, id DESC LIMIT 1",
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

    async isCustomerInAffinityPopulation(snapshotId, customerId) {
      assertCustomerId(customerId);
      const numericSnapshotId = toPositiveInteger(snapshotId, 'snapshotId');
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(
          `SELECT 1 AS present
             FROM customer_commercial_affinity_snapshot_population p
             INNER JOIN customer_commercial_affinity_snapshot s ON s.id = p.snapshot_id
            WHERE s.status = 'published' AND p.snapshot_id = ? AND p.customer_id = ?
            LIMIT 1`,
          [numericSnapshotId, customerId],
        );
        return rows.length > 0;
      } catch (error) {
        throw mapAnalyticsReadError(error);
      }
    },

    async getAffinityPopulationMembershipBatch(snapshotId, customerIds) {
      if (customerIds.length > 5000) throw new Error('Affinity population batch lookup is bounded to 5000 customers');
      if (customerIds.length === 0) return [];
      customerIds.forEach(assertCustomerId);
      const numericSnapshotId = toPositiveInteger(snapshotId, 'snapshotId');
      try {
        const uniqueCustomerIds = [...new Set(customerIds)].sort((left, right) => left - right);
        const placeholders = uniqueCustomerIds.map(() => '?').join(', ');
        const [rows] = await pool.execute<RowDataPacket[]>(
          `SELECT p.customer_id AS customerId
             FROM customer_commercial_affinity_snapshot_population p
             INNER JOIN customer_commercial_affinity_snapshot s ON s.id = p.snapshot_id
            WHERE s.status = 'published' AND p.snapshot_id = ? AND p.customer_id IN (${placeholders})
            ORDER BY p.customer_id ASC`,
          [numericSnapshotId, ...uniqueCustomerIds],
        );
        return rows.map((row) => Number(row.customerId));
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
   WHERE s.status = 'published'
     AND s.id = (
       SELECT active.id
         FROM customer_commercial_affinity_snapshot active
        WHERE active.status = 'published'
        ORDER BY active.published_at DESC, active.id DESC
        LIMIT 1
     )`;

async function insertBuildingSnapshot(connection: PoolConnection, header: CustomerCommercialAffinitySnapshotHeader): Promise<number> {
  const statement = buildBuildingSnapshotInsertStatement(header);
  const [result] = await connection.execute<ResultSetHeader>(statement.sql, statement.values);
  return result.insertId;
}

const buildingSnapshotColumns = [
  'snapshot_key', 'status', 'calculation_version', 'reference_time', 'generated_at',
  'population_policy_version', 'order_eligibility_policy_version', 'product_semantic_snapshot_id',
  'product_semantic_schema_version', 'ontology_version', 'ontology_hash', 'source_semantic_checksum',
  'consumer_semantic_checksum', 'source_customer_count', 'eligible_customer_count', 'eligible_order_count',
  'eligible_order_line_count', 'customers_with_affinity', 'customers_without_affinity', 'affinity_row_count',
  'dataset_checksum', 'affinity_dataset_checksum', 'eligible_population_checksum', 'identity_authority', 'source_watermark_order_id',
  'performance_metadata_json', 'manifest_json',
] as const;

export function buildBuildingSnapshotInsertStatement(header: CustomerCommercialAffinitySnapshotHeader): {
  readonly sql: string;
  readonly values: ExecuteValues[];
  readonly columnCount: number;
} {
  const values: ExecuteValues[] = [
    header.snapshotKey, header.calculationVersion, toMysqlDateTime6(header.referenceTime), toMysqlDateTime6(header.generatedAt),
    header.populationPolicyVersion, header.orderEligibilityPolicyVersion, header.productSemanticSnapshotId,
    header.productSemanticSchemaVersion, header.ontologyVersion, header.ontologyHash, header.sourceSemanticChecksum,
    header.consumerSemanticChecksum, header.sourceCustomerCount, header.eligibleCustomerCount, header.eligibleOrderCount,
    header.eligibleOrderLineCount, header.customersWithAffinity, header.customersWithoutAffinity, header.affinityRowCount,
    header.datasetChecksum, header.affinityDatasetChecksum, header.eligiblePopulationChecksum ?? null, header.identityAuthority, header.sourceWatermarkOrderId,
    header.performanceMetadata === undefined ? null : JSON.stringify(header.performanceMetadata), JSON.stringify(header),
  ];
  const valueExpressions = buildingSnapshotColumns.map((column) => column === 'status' ? "'building'" : '?');
  return {
    sql: `INSERT INTO customer_commercial_affinity_snapshot (\n      ${buildingSnapshotColumns.join(', ')}\n    ) VALUES (${valueExpressions.join(', ')})`,
    values,
    columnCount: buildingSnapshotColumns.length,
  };
}

function normalizeEligibleCustomerIds(values: readonly number[]): readonly number[] {
  const sorted = [...values].sort((left, right) => left - right);
  const seen = new Set<number>();
  for (const customerId of sorted) {
    assertCustomerId(customerId);
    if (seen.has(customerId)) throw new Error(`Duplicate eligible customer id: ${customerId}`);
    seen.add(customerId);
  }
  return sorted;
}

async function insertPopulationRows(connection: PoolConnection, snapshotId: number, customerIds: readonly number[]): Promise<void> {
  for (let offset = 0; offset < customerIds.length; offset += ROW_BATCH_SIZE) {
    const batch = customerIds.slice(offset, offset + ROW_BATCH_SIZE);
    if (batch.length === 0) continue;
    const placeholders = batch.map(() => '(?, ?)').join(', ');
    await connection.execute(
      `INSERT INTO customer_commercial_affinity_snapshot_population (snapshot_id, customer_id) VALUES ${placeholders}`,
      batch.flatMap((customerId) => [snapshotId, customerId]),
    );
  }
}

type PersistedPopulationHeader = Pick<CustomerCommercialAffinitySnapshotHeader, 'eligibleCustomerCount' | 'eligiblePopulationChecksum'>;

async function assertPersistedPopulationChecksum(connection: PoolConnection, snapshotId: number, header: PersistedPopulationHeader): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT customer_id AS customerId
       FROM customer_commercial_affinity_snapshot_population
      WHERE snapshot_id = ? ORDER BY customer_id ASC FOR UPDATE`,
    [snapshotId],
  );
  const customerIds = rows.map((row) => Number(row.customerId));
  if (customerIds.length !== header.eligibleCustomerCount) throw new Error('Affinity snapshot persisted population row count mismatch');
  const checksum = calculateEligibleCustomerPopulationChecksum(customerIds);
  if (header.eligiblePopulationChecksum === undefined || checksum !== header.eligiblePopulationChecksum) throw new Error('Affinity snapshot persisted population checksum mismatch');
}

async function assertPersistedRowSubset(connection: PoolConnection, snapshotId: number): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS missingCount
       FROM customer_commercial_affinity_snapshot_row r
       LEFT JOIN customer_commercial_affinity_snapshot_population p
         ON p.snapshot_id = r.snapshot_id AND p.customer_id = r.customer_id
      WHERE r.snapshot_id = ? AND p.customer_id IS NULL`,
    [snapshotId],
  );
  if (Number(rows[0]?.missingCount ?? 0) !== 0) throw new Error('Affinity snapshot row exists outside persisted population');
}

async function assertPersistedSnapshotComplete(connection: PoolConnection, snapshotId: number): Promise<void> {
  const [headers] = await connection.execute<RowDataPacket[]>(
    `SELECT id, status, manifest_json,
            eligible_customer_count AS eligibleCustomerCount,
            eligible_population_checksum AS eligiblePopulationChecksum,
            affinity_row_count AS affinityRowCount,
            customers_with_affinity AS customersWithAffinity,
            customers_without_affinity AS customersWithoutAffinity
       FROM customer_commercial_affinity_snapshot
      WHERE id = ? AND status = 'building' FOR UPDATE`,
    [snapshotId],
  );
  const header = headers[0];
  if (!header) throw new Error(`Affinity snapshot ${snapshotId} is not building`);
  const populationCount = await countPopulation(connection, snapshotId);
  const rowCount = await countRows(connection, snapshotId);
  if (populationCount !== Number(header.eligibleCustomerCount)) throw new Error('Affinity snapshot population is incomplete');
  if (rowCount !== Number(header.affinityRowCount)) throw new Error('Affinity snapshot rows are incomplete');
  if (Number(header.customersWithAffinity) + Number(header.customersWithoutAffinity) !== populationCount) throw new Error('Affinity customer coverage counts do not reconcile');
  await assertPersistedAffinityCoverage(connection, snapshotId, Number(header.customersWithAffinity));
  await assertPersistedPopulationChecksum(connection, snapshotId, {
    eligibleCustomerCount: Number(header.eligibleCustomerCount),
    eligiblePopulationChecksum: header.eligiblePopulationChecksum === null || header.eligiblePopulationChecksum === undefined
      ? undefined
      : String(header.eligiblePopulationChecksum),
  });
  const persistedHeader = parseHeader(header);
  const persistedChecksum = await calculatePersistedChecksum(connection, snapshotId, persistedHeader);
  if (persistedChecksum !== persistedHeader.affinityDatasetChecksum) throw new Error('Affinity snapshot persisted checksum mismatch');
  await assertPersistedRowSubset(connection, snapshotId);
}

async function countPopulation(connection: PoolConnection, snapshotId: number): Promise<number> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS populationCount FROM customer_commercial_affinity_snapshot_population WHERE snapshot_id = ?',
    [snapshotId],
  );
  return Number(rows[0]?.populationCount ?? 0);
}

async function assertPersistedAffinityCoverage(connection: PoolConnection, snapshotId: number, expectedCustomerCount: number): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    'SELECT COUNT(DISTINCT customer_id) AS customerCount FROM customer_commercial_affinity_snapshot_row WHERE snapshot_id = ?',
    [snapshotId],
  );
  if (Number(rows[0]?.customerCount ?? 0) !== expectedCustomerCount) throw new Error('Affinity customer coverage does not match persisted rows');
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
  return {
    ...(raw as CustomerCommercialAffinitySnapshotHeader),
    ...(row.eligiblePopulationChecksum === null || row.eligiblePopulationChecksum === undefined
      ? {}
      : { eligiblePopulationChecksum: String(row.eligiblePopulationChecksum) }),
    snapshotId: String(row.id),
    status: String(row.status) as CustomerCommercialAffinitySnapshotStatus,
  };
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

function roundDuration(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function mapPersistenceError(error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
  if (code === 'ER_DUP_ENTRY') return new CustomerCommercialAffinitySnapshotKeyConflictError();
  return error instanceof Error ? error : new Error('Unknown affinity snapshot persistence error', { cause: error });
}
