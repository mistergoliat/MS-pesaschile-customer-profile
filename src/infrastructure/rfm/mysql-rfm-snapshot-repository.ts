import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  checksumVersion,
  currencyPolicyVersion,
  formatRfmDecimal,
  identityAuthority,
  identityAuthorityVersion,
  monetaryPolicyVersion,
  populationPolicyVersion,
  populationScope,
  refundPolicyVersion,
  sha256Stable,
  scoringPolicyVersion,
  stableStringify,
} from '../../domain/customer-rfm/index.js';
import type {
  PersistRfmSnapshotInput,
  PersistRfmSnapshotResult,
  RfmSnapshotRepository,
} from '../../application/customer-rfm/create-rfm-snapshot.js';

export type RfmSnapshotRepositoryFailureStage =
  | 'after_begin'
  | 'after_header_insert'
  | 'during_row_insert'
  | 'after_rows_insert'
  | 'before_row_count'
  | 'after_row_count_before_checksum'
  | 'before_supersede_previous'
  | 'after_supersede_before_publish'
  | 'before_commit';

export type RfmSnapshotRepositoryTestHooks = {
  readonly failAt?: RfmSnapshotRepositoryFailureStage;
};

export function createMysqlRfmSnapshotRepository(
  pool: Pool,
  testHooks: RfmSnapshotRepositoryTestHooks = {},
): RfmSnapshotRepository {
  return {
    async findPublishedSnapshot(snapshotKey) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `
          SELECT id, dataset_checksum
          FROM customer_rfm_snapshot
          WHERE snapshot_key = ?
            AND status = 'published'
          LIMIT 1
        `,
        [snapshotKey],
      );
      const row = rows[0];
      if (!row) {
        return null;
      }
      return {
        snapshotId: String(row.id),
        datasetChecksum: String(row.dataset_checksum),
      };
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
          throw new Error('RFM persisted row count verification failed');
        }
        maybeFail(testHooks, 'after_row_count_before_checksum');
        const persistedDatasetChecksum = await calculatePersistedDatasetChecksum(connection, snapshotId, input);
        if (persistedDatasetChecksum !== input.datasetChecksum) {
          throw new Error('RFM persisted checksum verification failed');
        }
        await persistManifestWithSnapshotId(connection, snapshotId, input);
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
          datasetChecksum: persistedDatasetChecksum,
        } satisfies PersistRfmSnapshotResult;
      } catch (error) {
        await connection.rollback();
        throw mapPersistenceError(error);
      } finally {
        connection.release();
      }
    },
  };
}

async function insertBuildingSnapshot(connection: PoolConnection, input: PersistRfmSnapshotInput): Promise<number> {
  const manifest = {
    ...input.manifest,
    snapshotId: null,
  };
  const [result] = await connection.execute<ResultSetHeader>(
    `
      INSERT INTO customer_rfm_snapshot (
        snapshot_key,
        status,
        reference_time,
        window_start,
        window_end,
        calculation_version,
        identity_authority,
        identity_authority_version,
        population_policy_version,
        monetary_policy_version,
        refund_policy_version,
        scoring_policy_version,
        currency_code,
        population_size,
        valid_order_count,
        gross_order_value_tax_incl,
        manifest_json,
        dataset_checksum,
        generated_at,
        published_at
      )
      VALUES (?, 'building', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `,
    [
      input.snapshotKey,
      toMysqlDateTime(input.referenceTime),
      toMysqlDateTime(input.windowStartInclusive),
      toMysqlDateTime(input.windowEndExclusive),
      input.calculationVersion,
      identityAuthority,
      identityAuthorityVersion,
      populationPolicyVersion,
      monetaryPolicyVersion,
      refundPolicyVersion,
      scoringPolicyVersion,
      input.currencyCode,
      input.populationSize,
      input.validOrderCount,
      input.grossOrderValueTaxIncl,
      stableStringify(manifest),
      input.datasetChecksum,
      toMysqlDateTime(input.generatedAt),
    ],
  );
  return result.insertId;
}

async function insertRows(
  connection: PoolConnection,
  snapshotId: number,
  rows: PersistRfmSnapshotInput['rows'],
  testHooks: RfmSnapshotRepositoryTestHooks,
): Promise<void> {
  for (const row of rows) {
    maybeFail(testHooks, 'during_row_insert');
    await connection.execute(
      `
        INSERT INTO customer_rfm_snapshot_row (
          snapshot_id,
          prestashop_customer_id,
          master_customer_id,
          identity_resolution_status,
          first_valid_order_at,
          last_valid_order_at,
          recency_days,
          frequency_orders,
          gross_order_value_tax_incl,
          average_order_value_tax_incl,
          distinct_shop_count,
          recency_score,
          frequency_score,
          monetary_score,
          rfm_code,
          segment_code,
          segment_version
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        snapshotId,
        row.prestashopCustomerId,
        row.masterCustomerId,
        row.identityResolutionStatus,
        toMysqlDateTimeFromSource(row.firstValidOrderAt),
        toMysqlDateTimeFromSource(row.lastValidOrderAt),
        row.recencyDays,
        row.frequencyOrders,
        row.grossOrderValueTaxIncl,
        row.averageOrderValueTaxIncl,
        row.distinctShopCount,
        row.recencyScore,
        row.frequencyScore,
        row.monetaryScore,
        row.rfmCode,
        row.segmentCode,
        row.segmentVersion,
      ],
    );
  }
}

async function countRows(connection: PoolConnection, snapshotId: number): Promise<number> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS rowCount FROM customer_rfm_snapshot_row WHERE snapshot_id = ?',
    [snapshotId],
  );
  return Number(rows[0]?.rowCount ?? 0);
}

async function calculatePersistedDatasetChecksum(
  connection: PoolConnection,
  snapshotId: number,
  input: PersistRfmSnapshotInput,
): Promise<string> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `
      SELECT
        prestashop_customer_id AS prestashopCustomerId,
        master_customer_id AS masterCustomerId,
        identity_resolution_status AS identityResolutionStatus,
        first_valid_order_at AS firstValidOrderAt,
        last_valid_order_at AS lastValidOrderAt,
        recency_days AS recencyDays,
        frequency_orders AS frequencyOrders,
        gross_order_value_tax_incl AS grossOrderValueTaxIncl,
        average_order_value_tax_incl AS averageOrderValueTaxIncl,
        distinct_shop_count AS distinctShopCount,
        recency_score AS recencyScore,
        frequency_score AS frequencyScore,
        monetary_score AS monetaryScore,
        rfm_code AS rfmCode,
        segment_code AS segmentCode,
        segment_version AS segmentVersion
      FROM customer_rfm_snapshot_row
      WHERE snapshot_id = ?
      ORDER BY prestashop_customer_id ASC
      FOR UPDATE
    `,
    [snapshotId],
  );
  return sha256Stable({
    calculationVersion: input.calculationVersion,
    identityAuthority,
    identityAuthorityVersion,
    populationPolicyVersion,
    monetaryPolicyVersion,
    refundPolicyVersion,
    currencyPolicyVersion,
    scoringPolicyVersion,
    checksumVersion,
    populationScope,
    rows: rows.map(toPersistedChecksumRow),
  });
}

function toPersistedChecksumRow(row: RowDataPacket): PersistRfmSnapshotInput['rows'][number] {
  return {
    prestashopCustomerId: Number(row.prestashopCustomerId),
    masterCustomerId: row.masterCustomerId === null ? null : String(row.masterCustomerId),
    identityResolutionStatus: 'provisional',
    firstValidOrderAt: normalizePersistedMysqlDateTime(String(row.firstValidOrderAt)),
    lastValidOrderAt: normalizePersistedMysqlDateTime(String(row.lastValidOrderAt)),
    recencyDays: Number(row.recencyDays),
    frequencyOrders: Number(row.frequencyOrders),
    grossOrderValueTaxIncl: formatRfmDecimal(String(row.grossOrderValueTaxIncl)),
    averageOrderValueTaxIncl: formatRfmDecimal(String(row.averageOrderValueTaxIncl)),
    distinctShopCount: Number(row.distinctShopCount),
    recencyScore: Number(row.recencyScore) as PersistRfmSnapshotInput['rows'][number]['recencyScore'],
    frequencyScore: Number(row.frequencyScore) as PersistRfmSnapshotInput['rows'][number]['frequencyScore'],
    monetaryScore: Number(row.monetaryScore) as PersistRfmSnapshotInput['rows'][number]['monetaryScore'],
    rfmCode: String(row.rfmCode),
    segmentCode: requirePersistedString(row.segmentCode, 'segmentCode') as PersistRfmSnapshotInput['rows'][number]['segmentCode'],
    segmentVersion: requirePersistedString(row.segmentVersion, 'segmentVersion'),
  };
}

function requirePersistedString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid persisted ${field}`);
  }
  return value;
}

function normalizePersistedMysqlDateTime(value: string): string {
  return value.replace(/\.000000$/, '');
}

async function persistManifestWithSnapshotId(
  connection: PoolConnection,
  snapshotId: number,
  input: PersistRfmSnapshotInput,
): Promise<void> {
  await connection.execute(
    'UPDATE customer_rfm_snapshot SET manifest_json = ? WHERE id = ? AND status = ?',
    [stableStringify({ ...input.manifest, snapshotId: String(snapshotId) }), snapshotId, 'building'],
  );
}

async function supersedePreviousPublishedSnapshots(
  connection: PoolConnection,
  snapshotId: number,
  input: PersistRfmSnapshotInput,
): Promise<void> {
  await connection.execute(
    `
      UPDATE customer_rfm_snapshot
      SET status = 'superseded'
      WHERE id <> ?
        AND status = 'published'
        AND identity_authority = ?
        AND identity_authority_version = ?
        AND population_policy_version = ?
        AND monetary_policy_version = ?
        AND refund_policy_version = ?
        AND scoring_policy_version = ?
        AND calculation_version = ?
    `,
    [
      snapshotId,
      identityAuthority,
      identityAuthorityVersion,
      populationPolicyVersion,
      monetaryPolicyVersion,
      refundPolicyVersion,
      scoringPolicyVersion,
      input.calculationVersion,
    ],
  );
}

async function markValidated(connection: PoolConnection, snapshotId: number): Promise<void> {
  await connection.execute(
    "UPDATE customer_rfm_snapshot SET status = 'validated' WHERE id = ? AND status = 'building'",
    [snapshotId],
  );
}

async function markPublished(connection: PoolConnection, snapshotId: number): Promise<void> {
  await connection.execute(
    "UPDATE customer_rfm_snapshot SET status = 'published', published_at = generated_at WHERE id = ? AND status = 'validated'",
    [snapshotId],
  );
}

function maybeFail(testHooks: RfmSnapshotRepositoryTestHooks, stage: RfmSnapshotRepositoryFailureStage): void {
  if (testHooks.failAt === stage) {
    throw new Error(`Injected RFM snapshot repository failure: ${stage}`);
  }
}

function mapPersistenceError(error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
  if (code === 'ER_DUP_ENTRY') {
    return new Error('Duplicate RFM snapshot key');
  }
  return error instanceof Error ? error : new Error('Unknown RFM snapshot persistence error', { cause: error });
}

function toMysqlDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

function toMysqlDateTimeFromSource(value: string): string {
  return value.includes('T') ? toMysqlDateTime(value) : value;
}
