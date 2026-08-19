import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { checksumVersion } from '../../domain/customer-clustering/index.js';
import { sha256Stable } from '../../domain/customer-rfm/checksum.js';
import type {
  ClusterSnapshotRepository,
  PersistClusterSnapshotInput,
  PersistClusterSnapshotResult,
} from '../../application/customer-clustering/ports.js';

// Mirrors src/infrastructure/rfm/mysql-rfm-snapshot-repository.ts's publish transaction
// exactly: building -> insert rows -> verify row count -> verify checksum -> validated ->
// supersede prior published -> published, single transaction, rollback on any failure —
// never a partial published snapshot (task Section 24).
export type ClusterSnapshotRepositoryFailureStage =
  | 'after_begin'
  | 'after_header_insert'
  | 'during_row_insert'
  | 'after_rows_insert'
  | 'before_row_count'
  | 'after_row_count_before_checksum'
  | 'before_supersede_previous'
  | 'after_supersede_before_publish'
  | 'before_commit';

export type ClusterSnapshotRepositoryTestHooks = {
  readonly failAt?: ClusterSnapshotRepositoryFailureStage;
};

export function createMysqlClusterSnapshotRepository(
  pool: Pool,
  testHooks: ClusterSnapshotRepositoryTestHooks = {},
): ClusterSnapshotRepository {
  return {
    async findPublishedSnapshot(snapshotKey) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `
          SELECT id, assignment_checksum
          FROM customer_cluster_snapshot
          WHERE snapshot_key = ?
            AND status = 'published'
          LIMIT 1
        `,
        [snapshotKey],
      );
      const row = rows[0];
      if (!row) return null;
      return { snapshotId: String(row.id), assignmentChecksum: String(row.assignment_checksum) };
    },

    async publishSnapshot(input) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        maybeFail(testHooks, 'after_begin');
        const snapshotId = await insertBuildingSnapshot(connection, input);
        maybeFail(testHooks, 'after_header_insert');
        await insertRows(connection, snapshotId, input.rows, testHooks);
        maybeFail(testHooks, 'after_rows_insert');
        maybeFail(testHooks, 'before_row_count');
        const persistedRowCount = await countRows(connection, snapshotId);
        if (persistedRowCount !== input.rows.length) {
          throw new Error('Cluster snapshot persisted row count verification failed');
        }
        maybeFail(testHooks, 'after_row_count_before_checksum');
        const persistedAssignmentChecksum = await calculatePersistedAssignmentChecksum(connection, snapshotId, input);
        if (persistedAssignmentChecksum !== input.assignmentChecksum) {
          throw new Error('Cluster snapshot persisted assignment checksum verification failed');
        }
        maybeFail(testHooks, 'before_supersede_previous');
        await supersedePreviousPublishedSnapshots(connection, snapshotId, input);
        maybeFail(testHooks, 'after_supersede_before_publish');
        await markValidated(connection, snapshotId);
        await markPublished(connection, snapshotId);
        maybeFail(testHooks, 'before_commit');
        await connection.commit();
        return {
          snapshotId: String(snapshotId),
          persistedRowCount,
          assignmentChecksum: persistedAssignmentChecksum,
        } satisfies PersistClusterSnapshotResult;
      } catch (error) {
        await connection.rollback();
        throw mapPersistenceError(error);
      } finally {
        connection.release();
      }
    },
  };
}

async function insertBuildingSnapshot(connection: PoolConnection, input: PersistClusterSnapshotInput): Promise<number> {
  const [result] = await connection.execute<ResultSetHeader>(
    `
      INSERT INTO customer_cluster_snapshot (
        snapshot_key, model_id, status, reference_time, population_policy_version,
        population_size, dataset_checksum, assignment_checksum, generated_at, published_at
      )
      VALUES (?, ?, 'building', ?, ?, ?, ?, ?, ?, NULL)
    `,
    [
      input.snapshotKey,
      input.modelId,
      toMysqlDateTime(input.referenceTime),
      input.populationPolicyVersion,
      input.populationSize,
      input.datasetChecksum,
      input.assignmentChecksum,
      toMysqlDateTime(input.generatedAt),
    ],
  );
  return result.insertId;
}

async function insertRows(
  connection: PoolConnection,
  snapshotId: number,
  rows: PersistClusterSnapshotInput['rows'],
  testHooks: ClusterSnapshotRepositoryTestHooks,
): Promise<void> {
  for (const row of rows) {
    maybeFail(testHooks, 'during_row_insert');
    await connection.execute(
      `
        INSERT INTO customer_cluster_snapshot_row (
          snapshot_id, prestashop_customer_id, cluster_id, distance_to_centroid
        )
        VALUES (?, ?, ?, ?)
      `,
      [snapshotId, row.prestashopCustomerId, row.clusterId, row.distanceToCentroid.toFixed(10)],
    );
  }
}

async function countRows(connection: PoolConnection, snapshotId: number): Promise<number> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS rowCount FROM customer_cluster_snapshot_row WHERE snapshot_id = ?',
    [snapshotId],
  );
  return Number(rows[0]?.rowCount ?? 0);
}

async function calculatePersistedAssignmentChecksum(
  connection: PoolConnection,
  snapshotId: number,
  input: PersistClusterSnapshotInput,
): Promise<string> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `
      SELECT prestashop_customer_id AS prestashopCustomerId, cluster_id AS clusterId, distance_to_centroid AS distanceToCentroid
      FROM customer_cluster_snapshot_row
      WHERE snapshot_id = ?
      ORDER BY prestashop_customer_id ASC
      FOR UPDATE
    `,
    [snapshotId],
  );
  return sha256Stable({
    checksumVersion,
    modelVersion: input.manifest.modelVersion,
    rows: rows.map((row) => ({
      prestashopCustomerId: Number(row.prestashopCustomerId),
      clusterId: Number(row.clusterId),
      distanceToCentroid: Number(row.distanceToCentroid).toFixed(10),
    })),
  });
}

async function supersedePreviousPublishedSnapshots(
  connection: PoolConnection,
  snapshotId: number,
  input: PersistClusterSnapshotInput,
): Promise<void> {
  await connection.execute(
    `
      UPDATE customer_cluster_snapshot
      SET status = 'superseded'
      WHERE id <> ?
        AND status = 'published'
        AND model_id = ?
        AND population_policy_version = ?
    `,
    [snapshotId, input.modelId, input.populationPolicyVersion],
  );
}

async function markValidated(connection: PoolConnection, snapshotId: number): Promise<void> {
  await connection.execute(
    "UPDATE customer_cluster_snapshot SET status = 'validated', validated_at = generated_at WHERE id = ? AND status = 'building'",
    [snapshotId],
  );
}

async function markPublished(connection: PoolConnection, snapshotId: number): Promise<void> {
  await connection.execute(
    "UPDATE customer_cluster_snapshot SET status = 'published', published_at = generated_at WHERE id = ? AND status = 'validated'",
    [snapshotId],
  );
}

function maybeFail(testHooks: ClusterSnapshotRepositoryTestHooks, stage: ClusterSnapshotRepositoryFailureStage): void {
  if (testHooks.failAt === stage) {
    throw new Error(`Injected cluster snapshot repository failure: ${stage}`);
  }
}

function mapPersistenceError(error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
  if (code === 'ER_DUP_ENTRY') {
    return new Error('Duplicate cluster snapshot key');
  }
  return error instanceof Error ? error : new Error('Unknown cluster snapshot persistence error', { cause: error });
}

function toMysqlDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}
