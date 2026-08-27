import type { Pool, RowDataPacket } from 'mysql2/promise';
import type {
  DashboardAnalyticsReader,
  DashboardClusterAggregate,
  DashboardClusterRfmCrossSectionGroup,
  DashboardOverviewCommercialAggregate,
  DashboardRfmSegmentAggregate,
} from '../../application/customer-intelligence-dashboard/ports.js';
import { mapAnalyticsReadError } from '../customer-analytics/analytics-read-error.js';

// Dedicated dashboard reader (task MARKETING-R1-T06.2 Section 8/9) - grouped aggregate SQL only,
// never per-customer rows. Reads the exact same tables customer-intelligence-read-model-v1 does
// (customer_feature_snapshot_row / customer_rfm_snapshot_row / customer_cluster_snapshot_row),
// through the same analytics Pool - no second schema, no PrestaShop access at request time.
// averageOrderValueTaxIncl is always order-weighted (SUM(spend)/NULLIF(SUM(orders),0)) - the
// standard AOV definition, distinct from averageTotalSpentTaxIncl (a simple per-customer mean) -
// both are exposed because the two answer different questions (task Section 4).
export function createMysqlDashboardAnalyticsReader(pool: Pool): DashboardAnalyticsReader {
  return {
    async getOverviewCommercialAggregate(featureSnapshotId): Promise<DashboardOverviewCommercialAggregate> {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(
          `
            SELECT
              SUM(total_spent_tax_incl) AS totalSpentTaxIncl,
              SUM(valid_orders) AS totalValidOrders,
              SUM(total_spent_tax_incl) / NULLIF(SUM(valid_orders), 0) AS averageOrderValueTaxIncl,
              AVG(valid_orders) AS averageValidOrders,
              AVG(orders_365d) AS averageOrders365d,
              AVG(days_since_last_order) AS averageDaysSinceLastOrder,
              AVG(purchase_frequency_days) AS averagePurchaseFrequencyDays,
              COUNT(purchase_frequency_days) AS purchaseFrequencyDaysSampleSize
            FROM customer_feature_snapshot_row
            WHERE snapshot_id = ?
          `,
          [featureSnapshotId],
        );
        const row = rows[0];
        return {
          totalSpentTaxIncl: decimalString(row?.totalSpentTaxIncl) ?? '0.000000',
          totalValidOrders: intOrZero(row?.totalValidOrders),
          averageOrderValueTaxIncl: decimalString(row?.averageOrderValueTaxIncl),
          averageValidOrders: decimalString(row?.averageValidOrders) ?? '0',
          averageOrders365d: decimalString(row?.averageOrders365d) ?? '0',
          averageDaysSinceLastOrder: decimalString(row?.averageDaysSinceLastOrder) ?? '0',
          averagePurchaseFrequencyDays: decimalString(row?.averagePurchaseFrequencyDays),
          purchaseFrequencyDaysSampleSize: intOrZero(row?.purchaseFrequencyDaysSampleSize),
        };
      } catch (error) {
        throw mapAnalyticsReadError(error);
      }
    },

    async getRfmSegmentAggregates(rfmSnapshotId, featureSnapshotId): Promise<readonly DashboardRfmSegmentAggregate[]> {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(
          `
            SELECT
              rr.segment_code AS segmentCode,
              COUNT(*) AS customerCount,
              AVG(rr.recency_score) AS averageRScore,
              AVG(rr.frequency_score) AS averageFScore,
              AVG(rr.monetary_score) AS averageMScore,
              SUM(fr.total_spent_tax_incl) / NULLIF(SUM(fr.valid_orders), 0) AS averageOrderValueTaxIncl,
              AVG(fr.total_spent_tax_incl) AS averageTotalSpentTaxIncl,
              AVG(fr.valid_orders) AS averageValidOrders,
              AVG(fr.days_since_last_order) AS averageDaysSinceLastOrder
            FROM customer_rfm_snapshot_row rr
            INNER JOIN customer_feature_snapshot_row fr
              ON fr.snapshot_id = ? AND fr.prestashop_customer_id = rr.prestashop_customer_id
            WHERE rr.snapshot_id = ?
            GROUP BY rr.segment_code
          `,
          [featureSnapshotId, rfmSnapshotId],
        );
        return rows.map((row) => ({
          segmentCode: row.segmentCode === null ? null : String(row.segmentCode),
          customerCount: intOrZero(row.customerCount),
          averageRScore: decimalString(row.averageRScore) ?? '0',
          averageFScore: decimalString(row.averageFScore) ?? '0',
          averageMScore: decimalString(row.averageMScore) ?? '0',
          averageOrderValueTaxIncl: decimalString(row.averageOrderValueTaxIncl),
          averageTotalSpentTaxIncl: decimalString(row.averageTotalSpentTaxIncl) ?? '0.000000',
          averageValidOrders: decimalString(row.averageValidOrders) ?? '0',
          averageDaysSinceLastOrder: decimalString(row.averageDaysSinceLastOrder) ?? '0',
        }));
      } catch (error) {
        throw mapAnalyticsReadError(error);
      }
    },

    async getClusterAggregates(clusterSnapshotId, featureSnapshotId): Promise<readonly DashboardClusterAggregate[]> {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(
          `
            SELECT
              cr.cluster_id AS clusterId,
              COUNT(*) AS customerCount,
              SUM(fr.total_spent_tax_incl) / NULLIF(SUM(fr.valid_orders), 0) AS averageOrderValueTaxIncl,
              AVG(fr.total_spent_tax_incl) AS averageTotalSpentTaxIncl,
              AVG(fr.valid_orders) AS averageValidOrders,
              AVG(fr.orders_365d) AS averageOrders365d,
              AVG(fr.days_since_last_order) AS averageDaysSinceLastOrder,
              AVG(fr.effective_diversity) AS averageEffectiveDiversity,
              AVG(fr.repeat_product_rate) AS averageRepeatProductRate
            FROM customer_cluster_snapshot_row cr
            INNER JOIN customer_feature_snapshot_row fr
              ON fr.snapshot_id = ? AND fr.prestashop_customer_id = cr.prestashop_customer_id
            WHERE cr.snapshot_id = ?
            GROUP BY cr.cluster_id
          `,
          [featureSnapshotId, clusterSnapshotId],
        );
        return rows.map((row) => ({
          clusterId: intOrZero(row.clusterId),
          customerCount: intOrZero(row.customerCount),
          averageOrderValueTaxIncl: decimalString(row.averageOrderValueTaxIncl),
          averageTotalSpentTaxIncl: decimalString(row.averageTotalSpentTaxIncl) ?? '0.000000',
          averageValidOrders: decimalString(row.averageValidOrders) ?? '0',
          averageOrders365d: decimalString(row.averageOrders365d) ?? '0',
          averageDaysSinceLastOrder: decimalString(row.averageDaysSinceLastOrder) ?? '0',
          averageEffectiveDiversity: decimalString(row.averageEffectiveDiversity) ?? '0',
          averageRepeatProductRate: decimalString(row.averageRepeatProductRate) ?? '0',
        }));
      } catch (error) {
        throw mapAnalyticsReadError(error);
      }
    },

    async getClusterRfmCrossSectionGroups(
      clusterSnapshotId,
      featureSnapshotId,
      rfmSnapshotId,
    ): Promise<readonly DashboardClusterRfmCrossSectionGroup[]> {
      try {
        // Base population is cluster INNER JOIN feature (same as getClusterAggregates above),
        // then LEFT JOIN rfm so a cluster customer absent from the RFM snapshot still counts
        // (as hasRfmRow=false) instead of disappearing silently.
        const [rows] = await pool.execute<RowDataPacket[]>(
          `
            SELECT
              cr.cluster_id AS clusterId,
              (rr.prestashop_customer_id IS NOT NULL) AS hasRfmRow,
              rr.segment_code AS segmentCode,
              COUNT(*) AS customerCount
            FROM customer_cluster_snapshot_row cr
            INNER JOIN customer_feature_snapshot_row fr
              ON fr.snapshot_id = ? AND fr.prestashop_customer_id = cr.prestashop_customer_id
            LEFT JOIN customer_rfm_snapshot_row rr
              ON rr.snapshot_id = ? AND rr.prestashop_customer_id = cr.prestashop_customer_id
            WHERE cr.snapshot_id = ?
            GROUP BY cr.cluster_id, hasRfmRow, rr.segment_code
          `,
          [featureSnapshotId, rfmSnapshotId, clusterSnapshotId],
        );
        return rows.map((row) => ({
          clusterId: intOrZero(row.clusterId),
          hasRfmRow: Number(row.hasRfmRow) === 1,
          segmentCode: row.segmentCode === null ? null : String(row.segmentCode),
          customerCount: intOrZero(row.customerCount),
        }));
      } catch (error) {
        throw mapAnalyticsReadError(error);
      }
    },
  };
}

function decimalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function intOrZero(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
    throw new Error(`Invalid integer aggregate value: ${String(value)}`);
  }
  return numeric;
}
