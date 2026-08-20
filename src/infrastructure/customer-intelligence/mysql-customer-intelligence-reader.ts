import type { Pool, RowDataPacket } from 'mysql2/promise';
import { CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION, type CustomerIntelligenceCommercialFeatures, type CustomerIntelligenceRow } from '../../domain/customer-intelligence/index.js';
import type { CoverageCounts } from '../../domain/customer-intelligence/coverage.js';
import type {
  CustomerIntelligenceReader,
  ListCustomerIntelligenceRowsOptions,
  ListCustomerIntelligenceRowsResult,
  ResolvedCustomerIntelligenceSnapshotIds,
} from '../../application/customer-intelligence/ports.js';
import { createMysqlClusterAnalyticsReader, type ClusterAnalyticsInterpretation } from '../clustering/mysql-cluster-analytics-reader.js';
import { mapAnalyticsReadError } from '../customer-analytics/analytics-read-error.js';

// task Section 40/41/42: one SQL JOIN across customer_feature_snapshot_row/
// customer_rfm_snapshot_row/customer_cluster_snapshot_row, using a single Pool — justified
// today by all three physically sharing one MariaDB schema (see ANALYTICS_DB_* config note in
// CP-R3-T01's release doc). The CustomerIntelligenceReader interface itself (ports.ts) does
// not encode that assumption; a future deployment with genuinely separate databases would
// need a different implementation of this same interface, not a domain-layer change.
//
// Cluster interpretation label/description is deliberately NOT part of the SQL join — it is
// fetched via clustering's own, already-tested createMysqlClusterAnalyticsReader().
// getInterpretations(modelId) (task Section 48: never re-derive interpretation scoping,
// reuse the existing "latest interpretation_version wins per clusterId" logic verbatim) and
// merged onto rows in application code below.
const ROW_SELECT_COLUMNS = `
  fr.prestashop_customer_id AS prestashopCustomerId,
  fr.valid_orders AS validOrders,
  fr.total_spent_tax_incl AS totalSpentTaxIncl,
  fr.average_order_value_tax_incl AS averageOrderValueTaxIncl,
  fr.first_order_at AS firstOrderAt,
  fr.last_order_at AS lastOrderAt,
  fr.days_since_last_order AS daysSinceLastOrder,
  fr.customer_tenure_days AS customerTenureDays,
  fr.distinct_products AS distinctProducts,
  fr.repeat_product_rate AS repeatProductRate,
  fr.top1_share AS top1Share,
  fr.top3_share AS top3Share,
  fr.effective_diversity AS effectiveDiversity,
  fr.average_units_per_order AS averageUnitsPerOrder,
  fr.purchase_frequency_days AS purchaseFrequencyDays,
  fr.orders_365d AS orders365d,
  fr.cancelled_order_ratio AS cancelledOrderRatio,
  fr.discount_share AS discountShare,
  fr.shipping_share AS shippingShare,
  rr.recency_score AS rScore,
  rr.frequency_score AS fScore,
  rr.monetary_score AS mScore,
  rr.rfm_code AS rfmCode,
  rr.segment_code AS rfmSegmentCode,
  cr.cluster_id AS clusterId,
  cr.distance_to_centroid AS clusterDistanceToCentroid
`;

const ROW_FROM_JOIN = `
  FROM customer_feature_snapshot_row fr
  LEFT JOIN customer_rfm_snapshot_row rr
    ON rr.snapshot_id = ? AND rr.prestashop_customer_id = fr.prestashop_customer_id
  LEFT JOIN customer_cluster_snapshot_row cr
    ON cr.snapshot_id = ? AND cr.prestashop_customer_id = fr.prestashop_customer_id
`;

// customer_*_snapshot.id is BIGINT UNSIGNED AUTO_INCREMENT starting at 1 — 0 never matches a
// real row, so it is a safe "no snapshot selected" sentinel for the LEFT JOIN condition
// without needing two different SQL strings for the present/absent cases.
const NO_SNAPSHOT_SENTINEL = '0';

export function createMysqlCustomerIntelligenceReader(pool: Pool): CustomerIntelligenceReader {
  const clusterAnalyticsReader = createMysqlClusterAnalyticsReader(pool);

  async function loadInterpretations(clusterModelId: string | null): Promise<ReadonlyMap<number, ClusterAnalyticsInterpretation>> {
    if (clusterModelId === null) return new Map();
    return clusterAnalyticsReader.getInterpretations(clusterModelId);
  }

  return {
    async getRow(ids, prestashopCustomerId) {
      try {
        const [interpretations, [rows]] = await Promise.all([
          loadInterpretations(ids.clusterModelId),
          pool.execute<RowDataPacket[]>(
            `SELECT ${ROW_SELECT_COLUMNS} ${ROW_FROM_JOIN} WHERE fr.snapshot_id = ? AND fr.prestashop_customer_id = ? LIMIT 1`,
            [ids.rfmSnapshotId ?? NO_SNAPSHOT_SENTINEL, ids.clusterSnapshotId ?? NO_SNAPSHOT_SENTINEL, ids.featureSnapshotId, prestashopCustomerId],
          ),
        ]);
        const row = rows[0];
        if (!row) return null;
        return toCustomerIntelligenceRow(row, ids, interpretations);
      } catch (error) {
        throw mapAnalyticsReadError(error);
      }
    },

    async listRows(ids, options: ListCustomerIntelligenceRowsOptions): Promise<ListCustomerIntelligenceRowsResult> {
      try {
        const params: (string | number)[] = [ids.rfmSnapshotId ?? NO_SNAPSHOT_SENTINEL, ids.clusterSnapshotId ?? NO_SNAPSHOT_SENTINEL, ids.featureSnapshotId];
        let cursorClause = '';
        if (options.afterCustomerId !== null) {
          cursorClause = 'AND fr.prestashop_customer_id > ?';
          params.push(options.afterCustomerId);
        }
        // Fetch one extra row to determine hasMore without a second COUNT query.
        params.push(options.limit + 1);

        const [interpretations, [rows]] = await Promise.all([
          loadInterpretations(ids.clusterModelId),
          pool.execute<RowDataPacket[]>(
            `
              SELECT ${ROW_SELECT_COLUMNS} ${ROW_FROM_JOIN}
              WHERE fr.snapshot_id = ? ${cursorClause}
              ORDER BY fr.prestashop_customer_id ASC
              LIMIT ?
            `,
            params,
          ),
        ]);

        const hasMore = rows.length > options.limit;
        const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
        return {
          rows: pageRows.map((row) => toCustomerIntelligenceRow(row, ids, interpretations)),
          hasMore,
        };
      } catch (error) {
        throw mapAnalyticsReadError(error);
      }
    },

    async getCoverageCounts(ids): Promise<CoverageCounts> {
      try {
        const featurePopulationPromise = countOne(
          pool,
          'SELECT COUNT(*) AS n FROM customer_feature_snapshot_row WHERE snapshot_id = ?',
          [ids.featureSnapshotId],
        );

        const rfmMatchedPromise =
          ids.rfmSnapshotId === null
            ? Promise.resolve(0)
            : countOne(
                pool,
                `
                  SELECT COUNT(*) AS n
                  FROM customer_feature_snapshot_row fr
                  INNER JOIN customer_rfm_snapshot_row rr
                    ON rr.snapshot_id = ? AND rr.prestashop_customer_id = fr.prestashop_customer_id
                  WHERE fr.snapshot_id = ?
                `,
                [ids.rfmSnapshotId, ids.featureSnapshotId],
              );

        const clusterMatchedPromise =
          ids.clusterSnapshotId === null
            ? Promise.resolve(0)
            : countOne(
                pool,
                `
                  SELECT COUNT(*) AS n
                  FROM customer_feature_snapshot_row fr
                  INNER JOIN customer_cluster_snapshot_row cr
                    ON cr.snapshot_id = ? AND cr.prestashop_customer_id = fr.prestashop_customer_id
                  WHERE fr.snapshot_id = ?
                `,
                [ids.clusterSnapshotId, ids.featureSnapshotId],
              );

        const bothMatchedPromise =
          ids.rfmSnapshotId === null || ids.clusterSnapshotId === null
            ? Promise.resolve(0)
            : countOne(
                pool,
                `
                  SELECT COUNT(*) AS n
                  FROM customer_feature_snapshot_row fr
                  INNER JOIN customer_rfm_snapshot_row rr
                    ON rr.snapshot_id = ? AND rr.prestashop_customer_id = fr.prestashop_customer_id
                  INNER JOIN customer_cluster_snapshot_row cr
                    ON cr.snapshot_id = ? AND cr.prestashop_customer_id = fr.prestashop_customer_id
                  WHERE fr.snapshot_id = ?
                `,
                [ids.rfmSnapshotId, ids.clusterSnapshotId, ids.featureSnapshotId],
              );

        const [featurePopulation, rfmMatched, clusterMatched, bothMatched] = await Promise.all([
          featurePopulationPromise,
          rfmMatchedPromise,
          clusterMatchedPromise,
          bothMatchedPromise,
        ]);

        return { featurePopulation, rfmMatched, clusterMatched, bothMatched };
      } catch (error) {
        throw mapAnalyticsReadError(error);
      }
    },
  };
}

async function countOne(pool: Pool, sql: string, params: readonly (string | number)[]): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(sql, [...params]);
  return Number(rows[0]?.n ?? 0);
}

function toCustomerIntelligenceRow(
  row: RowDataPacket,
  ids: ResolvedCustomerIntelligenceSnapshotIds,
  interpretations: ReadonlyMap<number, ClusterAnalyticsInterpretation>,
): CustomerIntelligenceRow {
  const commercial: CustomerIntelligenceCommercialFeatures = {
    validOrders: coerceInt(row.validOrders, 'validOrders'),
    totalSpentTaxIncl: String(row.totalSpentTaxIncl),
    averageOrderValueTaxIncl: String(row.averageOrderValueTaxIncl),
    firstOrderAt: toIso(row.firstOrderAt),
    lastOrderAt: toIso(row.lastOrderAt),
    daysSinceLastOrder: coerceInt(row.daysSinceLastOrder, 'daysSinceLastOrder'),
    customerTenureDays: coerceInt(row.customerTenureDays, 'customerTenureDays'),
    distinctProducts: coerceInt(row.distinctProducts, 'distinctProducts'),
    repeatProductRate: String(row.repeatProductRate),
    top1Share: String(row.top1Share),
    top3Share: String(row.top3Share),
    effectiveDiversity: String(row.effectiveDiversity),
    averageUnitsPerOrder: String(row.averageUnitsPerOrder),
    purchaseFrequencyDays: row.purchaseFrequencyDays === null ? null : String(row.purchaseFrequencyDays),
    orders365d: coerceInt(row.orders365d, 'orders365d'),
    cancelledOrderRatio: String(row.cancelledOrderRatio),
    discountShare: String(row.discountShare),
    shippingShare: String(row.shippingShare),
  };

  const rfm =
    ids.rfmSnapshotId === null || row.rScore === null
      ? null
      : {
          snapshot: { snapshotId: ids.rfmSnapshotId, referenceTime: ids.rfmReferenceTime!, calculationVersion: ids.calculationVersion! },
          rScore: coerceInt(row.rScore, 'rScore'),
          fScore: coerceInt(row.fScore, 'fScore'),
          mScore: coerceInt(row.mScore, 'mScore'),
          rfmCode: String(row.rfmCode),
          segmentCode: row.rfmSegmentCode === null ? null : String(row.rfmSegmentCode),
        };

  const cluster =
    ids.clusterSnapshotId === null || row.clusterId === null
      ? null
      : (() => {
          const clusterId = coerceInt(row.clusterId, 'clusterId');
          const interpretation = interpretations.get(clusterId) ?? null;
          return {
            snapshot: {
              snapshotId: ids.clusterSnapshotId!,
              referenceTime: ids.clusterReferenceTime!,
              modelId: ids.clusterModelId!,
              modelVersion: ids.clusterModelVersion!,
            },
            clusterId,
            distanceToCentroid: Number(row.clusterDistanceToCentroid),
            interpretationVersion: interpretation?.interpretationVersion ?? null,
            label: interpretation?.label ?? null,
            description: interpretation?.description ?? null,
          };
        })();

  return {
    prestashopCustomerId: coerceInt(row.prestashopCustomerId, 'prestashopCustomerId'),
    featureSnapshot: {
      snapshotId: ids.featureSnapshotId,
      referenceTime: ids.featureReferenceTime,
      featureVersion: ids.featureVersion,
      populationPolicyVersion: ids.populationPolicyVersion,
    },
    commercial,
    rfm,
    cluster,
    contractVersion: CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION,
  };
}

function coerceInt(value: unknown, field: string): number {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return numeric;
}

function toIso(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Invalid datetime');
    return value.toISOString();
  }
  if (typeof value !== 'string') throw new Error('Invalid datetime');
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid datetime');
  return parsed.toISOString();
}
