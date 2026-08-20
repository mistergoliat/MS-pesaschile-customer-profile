import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { CustomerFeatureRow } from '../../domain/customer-analytics/contracts.js';
import type { CustomerFeatureSnapshotReader, StoredCustomerFeatureSnapshot } from '../../application/customer-analytics/ports.js';
import { mapAnalyticsReadError } from './analytics-read-error.js';

const SNAPSHOT_COLUMNS = `
  id, feature_version AS featureVersion, population_policy_version AS populationPolicyVersion,
  reference_time AS referenceTime, generated_at AS generatedAt, published_at AS publishedAt,
  population_size AS populationSize, source_dataset_checksum AS sourceDatasetChecksum,
  feature_dataset_checksum AS featureDatasetChecksum, status
`;

const SELECT_LATEST_PUBLISHED_SQL = `
  SELECT ${SNAPSHOT_COLUMNS}
  FROM customer_feature_snapshot
  WHERE status = 'published'
  ORDER BY published_at DESC, id DESC
  LIMIT 1
`;

// Deliberately not restricted to status='published' (task Section 44/51): a snapshot that
// was published and later superseded by a newer one must stay readable by explicit id for
// historical/backtesting reads. building/validated/failed snapshots ARE excluded — those
// never represent a complete, checked dataset.
const SELECT_BY_ID_SQL = `
  SELECT ${SNAPSHOT_COLUMNS}
  FROM customer_feature_snapshot
  WHERE id = ?
    AND status IN ('published', 'superseded')
  LIMIT 1
`;

const SELECT_ROW_SQL = `
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
    AND prestashop_customer_id = ?
  LIMIT 1
`;

export function createMysqlCustomerFeatureSnapshotReader(pool: Pool): CustomerFeatureSnapshotReader {
  return {
    async getLatestPublishedSnapshot() {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(SELECT_LATEST_PUBLISHED_SQL, []);
        const row = rows[0];
        return row ? toStoredSnapshot(row) : null;
      } catch (error) {
        throw mapAnalyticsReadError(error);
      }
    },

    async getSnapshotById(snapshotId) {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(SELECT_BY_ID_SQL, [snapshotId]);
        const row = rows[0];
        return row ? toStoredSnapshot(row) : null;
      } catch (error) {
        throw mapAnalyticsReadError(error);
      }
    },

    async getRow(snapshotId, prestashopCustomerId) {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(SELECT_ROW_SQL, [snapshotId, prestashopCustomerId]);
        const row = rows[0];
        if (!row) return null;
        return toRow(row);
      } catch (error) {
        throw mapAnalyticsReadError(error);
      }
    },
  };
}

function toStoredSnapshot(row: RowDataPacket): StoredCustomerFeatureSnapshot {
  return {
    snapshotId: String(row.id),
    featureVersion: String(row.featureVersion),
    populationPolicyVersion: String(row.populationPolicyVersion),
    referenceTime: parseRequiredUtcDateTime(row.referenceTime, 'referenceTime'),
    generatedAt: parseRequiredUtcDateTime(row.generatedAt, 'generatedAt'),
    publishedAt: parseRequiredUtcDateTime(row.publishedAt, 'publishedAt'),
    populationSize: coerceNonNegativeInt(row.populationSize, 'populationSize'),
    sourceDatasetChecksum: String(row.sourceDatasetChecksum),
    featureDatasetChecksum: String(row.featureDatasetChecksum),
    status: row.status as StoredCustomerFeatureSnapshot['status'],
  };
}

function toRow(row: RowDataPacket): CustomerFeatureRow {
  return {
    prestashopCustomerId: coerceNonNegativeInt(row.prestashopCustomerId, 'prestashopCustomerId'),
    validOrders: coerceNonNegativeInt(row.validOrders, 'validOrders'),
    totalSpentTaxIncl: String(row.totalSpentTaxIncl),
    averageOrderValueTaxIncl: String(row.averageOrderValueTaxIncl),
    firstOrderAt: parseRequiredUtcDateTime(row.firstOrderAt, 'firstOrderAt').toISOString(),
    lastOrderAt: parseRequiredUtcDateTime(row.lastOrderAt, 'lastOrderAt').toISOString(),
    daysSinceLastOrder: coerceNonNegativeInt(row.daysSinceLastOrder, 'daysSinceLastOrder'),
    customerTenureDays: coerceNonNegativeInt(row.customerTenureDays, 'customerTenureDays'),
    distinctProducts: coerceNonNegativeInt(row.distinctProducts, 'distinctProducts'),
    repeatProductRate: String(row.repeatProductRate),
    top1Share: String(row.top1Share),
    top3Share: String(row.top3Share),
    effectiveDiversity: String(row.effectiveDiversity),
    averageUnitsPerOrder: String(row.averageUnitsPerOrder),
    purchaseFrequencyDays: row.purchaseFrequencyDays === null ? null : String(row.purchaseFrequencyDays),
    orders365d: coerceNonNegativeInt(row.orders365d, 'orders365d'),
    cancelledOrderRatio: String(row.cancelledOrderRatio),
    discountShare: String(row.discountShare),
    shippingShare: String(row.shippingShare),
  };
}

function coerceNonNegativeInt(value: unknown, field: string): number {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return numeric;
}

function parseRequiredUtcDateTime(value: unknown, field: string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`Invalid ${field}`);
    return value;
  }
  if (typeof value !== 'string') throw new Error(`Invalid ${field}`);
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${field}`);
  return parsed;
}
