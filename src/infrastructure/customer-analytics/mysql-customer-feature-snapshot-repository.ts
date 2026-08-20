import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { checksumVersion } from '../../domain/customer-analytics/model-version.js';
import type { CustomerFeatureRow } from '../../domain/customer-analytics/contracts.js';
import { sha256Stable } from '../../domain/customer-rfm/checksum.js';
import type {
  CustomerFeatureSnapshotRepository,
  PersistCustomerFeatureSnapshotInput,
  PersistCustomerFeatureSnapshotResult,
} from '../../application/customer-analytics/ports.js';

// Mirrors src/infrastructure/clustering/mysql-cluster-snapshot-repository.ts's publish
// transaction exactly: building -> insert rows -> verify row count -> verify checksum ->
// validated -> supersede prior published -> published, single transaction, rollback on any
// failure — never a partial published snapshot (task Section 25).
//
// One deliberate improvement over the clustering repository this mirrors (task Section 55):
// rows are inserted in batches of up to 500 per statement instead of one INSERT per row —
// clustering's row-by-row loop is fine at ~10K rows but this population (44,935 live) makes
// per-row round trips a meaningfully larger, avoidable cost.
const ROW_BATCH_SIZE = 500;

export type CustomerFeatureSnapshotRepositoryFailureStage =
  | 'after_begin'
  | 'after_header_insert'
  | 'during_row_insert'
  | 'after_rows_insert'
  | 'before_row_count'
  | 'after_row_count_before_checksum'
  | 'before_supersede_previous'
  | 'after_supersede_before_publish'
  | 'before_commit';

export type CustomerFeatureSnapshotRepositoryTestHooks = {
  readonly failAt?: CustomerFeatureSnapshotRepositoryFailureStage;
};

export function createMysqlCustomerFeatureSnapshotRepository(
  pool: Pool,
  testHooks: CustomerFeatureSnapshotRepositoryTestHooks = {},
): CustomerFeatureSnapshotRepository {
  return {
    async findPublishedSnapshot(snapshotKey) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `
          SELECT id, source_dataset_checksum, feature_dataset_checksum
          FROM customer_feature_snapshot
          WHERE snapshot_key = ?
            AND status = 'published'
          LIMIT 1
        `,
        [snapshotKey],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        snapshotId: String(row.id),
        sourceDatasetChecksum: String(row.source_dataset_checksum),
        featureDatasetChecksum: String(row.feature_dataset_checksum),
      };
    },

    async publishSnapshot(input) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        maybeFail(testHooks, 'after_begin');
        const snapshotId = await insertBuildingSnapshot(connection, input);
        maybeFail(testHooks, 'after_header_insert');
        await insertRowsInBatches(connection, snapshotId, input.rows, testHooks);
        maybeFail(testHooks, 'after_rows_insert');
        maybeFail(testHooks, 'before_row_count');
        const persistedRowCount = await countRows(connection, snapshotId);
        if (persistedRowCount !== input.rows.length) {
          throw new Error('Customer feature snapshot persisted row count verification failed');
        }
        maybeFail(testHooks, 'after_row_count_before_checksum');
        const persistedFeatureDatasetChecksum = await calculatePersistedFeatureDatasetChecksum(connection, snapshotId, input);
        if (persistedFeatureDatasetChecksum !== input.featureDatasetChecksum) {
          throw new Error('Customer feature snapshot persisted checksum verification failed');
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
          featureDatasetChecksum: persistedFeatureDatasetChecksum,
        } satisfies PersistCustomerFeatureSnapshotResult;
      } catch (error) {
        await connection.rollback();
        throw mapPersistenceError(error);
      } finally {
        connection.release();
      }
    },
  };
}

async function insertBuildingSnapshot(connection: PoolConnection, input: PersistCustomerFeatureSnapshotInput): Promise<number> {
  const [result] = await connection.execute<ResultSetHeader>(
    `
      INSERT INTO customer_feature_snapshot (
        snapshot_key, status, reference_time, feature_version, population_policy_version,
        operational_exclusion_policy_version, shop_scope, population_size,
        source_dataset_checksum, feature_dataset_checksum, manifest_json, generated_at,
        published_at
      )
      VALUES (?, 'building', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `,
    [
      input.snapshotKey,
      toMysqlDateTime6(input.referenceTime),
      input.featureVersion,
      input.populationPolicyVersion,
      input.operationalExclusionPolicyVersion,
      input.shopScope,
      input.populationSize,
      input.sourceDatasetChecksum,
      input.featureDatasetChecksum,
      JSON.stringify(input.manifest),
      toMysqlDateTime6(input.generatedAt),
    ],
  );
  return result.insertId;
}

async function insertRowsInBatches(
  connection: PoolConnection,
  snapshotId: number,
  rows: PersistCustomerFeatureSnapshotInput['rows'],
  testHooks: CustomerFeatureSnapshotRepositoryTestHooks,
): Promise<void> {
  const columns = 20; // snapshot_id + 19 feature/identity columns
  for (let offset = 0; offset < rows.length; offset += ROW_BATCH_SIZE) {
    maybeFail(testHooks, 'during_row_insert');
    const batch = rows.slice(offset, offset + ROW_BATCH_SIZE);
    const placeholders = batch.map(() => `(${new Array(columns).fill('?').join(', ')})`).join(', ');
    const params = batch.flatMap((row) => rowToInsertParams(snapshotId, row));
    await connection.execute(
      `
        INSERT INTO customer_feature_snapshot_row (
          snapshot_id, prestashop_customer_id, valid_orders, total_spent_tax_incl,
          average_order_value_tax_incl, first_order_at, last_order_at, days_since_last_order,
          customer_tenure_days, distinct_products, repeat_product_rate, top1_share,
          top3_share, effective_diversity, average_units_per_order, purchase_frequency_days,
          orders_365d, cancelled_order_ratio, discount_share, shipping_share
        )
        VALUES ${placeholders}
      `,
      params,
    );
  }
}

function rowToInsertParams(snapshotId: number, row: CustomerFeatureRow): readonly (string | number | null)[] {
  return [
    snapshotId,
    row.prestashopCustomerId,
    row.validOrders,
    row.totalSpentTaxIncl,
    row.averageOrderValueTaxIncl,
    toMysqlDateTime6(row.firstOrderAt),
    toMysqlDateTime6(row.lastOrderAt),
    row.daysSinceLastOrder,
    row.customerTenureDays,
    row.distinctProducts,
    row.repeatProductRate,
    row.top1Share,
    row.top3Share,
    row.effectiveDiversity,
    row.averageUnitsPerOrder,
    row.purchaseFrequencyDays,
    row.orders365d,
    row.cancelledOrderRatio,
    row.discountShare,
    row.shippingShare,
  ];
}

async function countRows(connection: PoolConnection, snapshotId: number): Promise<number> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS rowCount FROM customer_feature_snapshot_row WHERE snapshot_id = ?',
    [snapshotId],
  );
  return Number(rows[0]?.rowCount ?? 0);
}

async function calculatePersistedFeatureDatasetChecksum(
  connection: PoolConnection,
  snapshotId: number,
  input: PersistCustomerFeatureSnapshotInput,
): Promise<string> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `
      SELECT
        prestashop_customer_id AS prestashopCustomerId, valid_orders AS validOrders,
        total_spent_tax_incl AS totalSpentTaxIncl, average_order_value_tax_incl AS averageOrderValueTaxIncl,
        first_order_at AS firstOrderAt, last_order_at AS lastOrderAt,
        days_since_last_order AS daysSinceLastOrder, customer_tenure_days AS customerTenureDays,
        distinct_products AS distinctProducts, repeat_product_rate AS repeatProductRate,
        top1_share AS top1Share, top3_share AS top3Share, effective_diversity AS effectiveDiversity,
        average_units_per_order AS averageUnitsPerOrder, purchase_frequency_days AS purchaseFrequencyDays,
        orders_365d AS orders365d, cancelled_order_ratio AS cancelledOrderRatio,
        discount_share AS discountShare, shipping_share AS shippingShare
      FROM customer_feature_snapshot_row
      WHERE snapshot_id = ?
      ORDER BY prestashop_customer_id ASC
      FOR UPDATE
    `,
    [snapshotId],
  );
  const reconstructed: CustomerFeatureRow[] = rows.map((row) => ({
    prestashopCustomerId: Number(row.prestashopCustomerId),
    validOrders: Number(row.validOrders),
    totalSpentTaxIncl: String(row.totalSpentTaxIncl),
    averageOrderValueTaxIncl: String(row.averageOrderValueTaxIncl),
    firstOrderAt: toIsoFromDbDateTime(row.firstOrderAt),
    lastOrderAt: toIsoFromDbDateTime(row.lastOrderAt),
    daysSinceLastOrder: Number(row.daysSinceLastOrder),
    customerTenureDays: Number(row.customerTenureDays),
    distinctProducts: Number(row.distinctProducts),
    repeatProductRate: String(row.repeatProductRate),
    top1Share: String(row.top1Share),
    top3Share: String(row.top3Share),
    effectiveDiversity: String(row.effectiveDiversity),
    averageUnitsPerOrder: String(row.averageUnitsPerOrder),
    purchaseFrequencyDays: row.purchaseFrequencyDays === null ? null : String(row.purchaseFrequencyDays),
    orders365d: Number(row.orders365d),
    cancelledOrderRatio: String(row.cancelledOrderRatio),
    discountShare: String(row.discountShare),
    shippingShare: String(row.shippingShare),
  }));
  return sha256Stable({
    checksumVersion,
    featureVersion: input.featureVersion,
    rows: reconstructed,
  });
}

async function supersedePreviousPublishedSnapshots(
  connection: PoolConnection,
  snapshotId: number,
  input: PersistCustomerFeatureSnapshotInput,
): Promise<void> {
  await connection.execute(
    `
      UPDATE customer_feature_snapshot
      SET status = 'superseded'
      WHERE id <> ?
        AND status = 'published'
        AND feature_version = ?
        AND population_policy_version = ?
    `,
    [snapshotId, input.featureVersion, input.populationPolicyVersion],
  );
}

async function markValidated(connection: PoolConnection, snapshotId: number): Promise<void> {
  await connection.execute(
    "UPDATE customer_feature_snapshot SET status = 'validated', validated_at = generated_at WHERE id = ? AND status = 'building'",
    [snapshotId],
  );
}

async function markPublished(connection: PoolConnection, snapshotId: number): Promise<void> {
  await connection.execute(
    "UPDATE customer_feature_snapshot SET status = 'published', published_at = generated_at WHERE id = ? AND status = 'validated'",
    [snapshotId],
  );
}

function maybeFail(testHooks: CustomerFeatureSnapshotRepositoryTestHooks, stage: CustomerFeatureSnapshotRepositoryFailureStage): void {
  if (testHooks.failAt === stage) {
    throw new Error(`Injected customer feature snapshot repository failure: ${stage}`);
  }
}

function mapPersistenceError(error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
  if (code === 'ER_DUP_ENTRY') {
    return new Error('Duplicate customer feature snapshot key');
  }
  return error instanceof Error ? error : new Error('Unknown customer feature snapshot persistence error', { cause: error });
}

function toMysqlDateTime6(iso: string): string {
  return new Date(iso).toISOString().slice(0, 23).replace('T', ' ');
}

// The analytics pool (mirroring the cluster pool) returns DATETIME columns as JS Date objects
// (no dateStrings option) — .toISOString() reproduces the exact millisecond-precision string
// written by toMysqlDateTime6 above, which is what the original featureDatasetChecksum was
// computed over.
function toIsoFromDbDateTime(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('Invalid persisted DATETIME value');
    }
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const parsed = new Date(`${value.replace(' ', 'T')}Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('Invalid persisted DATETIME value');
    }
    return parsed.toISOString();
  }
  throw new Error('Invalid persisted DATETIME value');
}
