import type { RowDataPacket } from 'mysql2/promise';
import type { AudiencePreviewReadRow, AudiencePreviewReader } from '../../application/customer-intelligence-audience/ports.js';
import type { QueryExecutor } from '../shared/query-executor.js';
import { mapAnalyticsReadError } from '../customer-analytics/analytics-read-error.js';

export function createMysqlAudiencePreviewReader(queryExecutor: QueryExecutor): AudiencePreviewReader {
  return {
    async read(context, customerIds) {
      if (customerIds.length === 0) return [];
      const ids = [...new Set(customerIds)];
      const placeholders = ids.map(() => '?').join(', ');
      const sql = [
        'SELECT fr.prestashop_customer_id AS customerId, fr.valid_orders AS validOrders, fr.total_spent_tax_incl AS totalSpentTaxIncl, fr.average_order_value_tax_incl AS averageOrderValueTaxIncl, fr.first_order_at AS firstOrderAt, fr.last_order_at AS lastOrderAt, fr.days_since_last_order AS daysSinceLastOrder, fr.purchase_frequency_days AS purchaseFrequencyDays,',
        'rr.recency_score AS rfmRecencyScore, rr.frequency_score AS rfmFrequencyScore, rr.monetary_score AS rfmMonetaryScore, rr.rfm_code AS rfmCode, rr.segment_code AS segmentCode, rr.segment_version AS segmentVersion, rr.recency_days AS rfmRecencyDays, rr.frequency_orders AS rfmFrequencyOrders, rr.gross_order_value_tax_incl AS rfmGrossOrderValueTaxIncl,',
        'cr.cluster_id AS clusterId, cm.model_version AS clusterModelVersion, (SELECT ci.label FROM customer_cluster_interpretation ci WHERE ci.model_id = cs.model_id AND ci.cluster_id = cr.cluster_id ORDER BY ci.id DESC LIMIT 1) AS clusterLabel,',
        'cv.expected_revenue_tax_incl AS expectedRevenueTaxIncl, cv.expected_orders AS expectedOrders, cv.estimate_support_level AS estimateSupportLevel, ap.customer_id AS affinityPopulationCustomerId,',
        'ar.affinity_axis AS affinityAxis, ar.affinity_code AS affinityCode, ar.score AS affinityScore, ar.supporting_order_count AS supportingOrderCount, ar.supporting_product_count AS supportingProductCount, ar.supporting_spend AS supportingSpend, ar.last_evidence_at AS lastEvidenceAt, ar.explicit_evidence_coverage AS explicitEvidenceCoverage',
        'FROM customer_feature_snapshot_row fr',
        'LEFT JOIN customer_rfm_snapshot_row rr ON rr.snapshot_id = ? AND rr.prestashop_customer_id = fr.prestashop_customer_id',
        'LEFT JOIN customer_cluster_snapshot_row cr ON cr.snapshot_id = ? AND cr.prestashop_customer_id = fr.prestashop_customer_id',
        'LEFT JOIN customer_cluster_snapshot cs ON cs.id = cr.snapshot_id',
        'LEFT JOIN customer_cluster_model cm ON cm.id = cs.model_id',
        'LEFT JOIN customer_clv_snapshot_row cv ON cv.snapshot_id = ? AND cv.customer_id = fr.prestashop_customer_id',
        'LEFT JOIN customer_commercial_affinity_snapshot_population ap ON ap.snapshot_id = ? AND ap.customer_id = fr.prestashop_customer_id',
        'LEFT JOIN customer_commercial_affinity_snapshot_row ar ON ar.snapshot_id = ? AND ar.customer_id = fr.prestashop_customer_id',
        `WHERE fr.snapshot_id = ? AND fr.prestashop_customer_id IN (${placeholders})`,
        'ORDER BY fr.prestashop_customer_id ASC, ar.affinity_axis ASC, ar.affinity_code ASC',
      ].join(' ');
      const params = [context.lineage.rfm?.snapshotId ?? '0', context.lineage.cluster?.snapshotId ?? '0', context.lineage.clv?.snapshotId ?? '0', context.lineage.commercialAffinity?.snapshotId ?? '0', context.lineage.commercialAffinity?.snapshotId ?? '0', context.lineage.feature.snapshotId, ...ids];
      try {
        const rows = await queryExecutor.execute(sql, params);
        return rows.map(toReadRow);
      } catch (error) { throw mapAnalyticsReadError(error); }
    },
  };
}

function toReadRow(row: RowDataPacket): AudiencePreviewReadRow {
  const hasRfm = row.rfmCode !== null && row.rfmCode !== undefined;
  const hasCluster = row.clusterId !== null && row.clusterId !== undefined;
  const hasClv = row.expectedRevenueTaxIncl !== null && row.expectedRevenueTaxIncl !== undefined;
  const hasAffinity = row.affinityCode !== null && row.affinityCode !== undefined;
  return {
    customerId: Number(row.customerId), validOrders: Number(row.validOrders), totalSpentTaxIncl: String(row.totalSpentTaxIncl), averageOrderValueTaxIncl: String(row.averageOrderValueTaxIncl), firstOrderAt: toIso(row.firstOrderAt), lastOrderAt: toIso(row.lastOrderAt), daysSinceLastOrder: Number(row.daysSinceLastOrder), purchaseFrequencyDays: row.purchaseFrequencyDays === null ? null : String(row.purchaseFrequencyDays),
    rfm: hasRfm ? { recencyScore: Number(row.rfmRecencyScore), frequencyScore: Number(row.rfmFrequencyScore), monetaryScore: Number(row.rfmMonetaryScore), rfmCode: String(row.rfmCode), segmentCode: row.segmentCode === null ? null : String(row.segmentCode), segmentVersion: row.segmentVersion === null ? null : String(row.segmentVersion), recencyDays: Number(row.rfmRecencyDays), frequencyOrders: Number(row.rfmFrequencyOrders), grossOrderValueTaxIncl: String(row.rfmGrossOrderValueTaxIncl) } : null,
    cluster: hasCluster ? { clusterId: Number(row.clusterId), modelVersion: String(row.clusterModelVersion), label: row.clusterLabel === null || row.clusterLabel === undefined ? null : String(row.clusterLabel) } : null,
    clv: hasClv ? { expectedRevenueTaxIncl: String(row.expectedRevenueTaxIncl), expectedOrders: row.expectedOrders === null ? null : String(row.expectedOrders), estimateSupportLevel: String(row.estimateSupportLevel) } : null,
    affinityPopulationMember: row.affinityPopulationCustomerId !== null && row.affinityPopulationCustomerId !== undefined,
    ...(hasAffinity ? { affinity: { axis: row.affinityAxis as 'PRODUCT_FAMILY' | 'DISCIPLINE' | 'USE_CONTEXT', code: String(row.affinityCode), score: String(row.affinityScore), supportingOrderCount: Number(row.supportingOrderCount), supportingProductCount: Number(row.supportingProductCount), supportingSpend: String(row.supportingSpend), lastEvidenceAt: toIso(row.lastEvidenceAt), explicitEvidenceCoverage: row.explicitEvidenceCoverage === null ? null : String(row.explicitEvidenceCoverage) } } : {}),
  };
}

function toIso(value: unknown): string {
  const parsed = value instanceof Date ? value : typeof value === 'string' ? new Date(`${value.replace(' ', 'T')}Z`) : new Date(Number.NaN);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid preview timestamp');
  return parsed.toISOString();
}
