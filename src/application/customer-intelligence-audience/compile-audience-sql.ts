import type { AudienceConditionV1, AudienceEvaluationContextV1, AudienceFilterV1 } from '../../domain/customer-intelligence-audience/index.js';
import { getAudienceFieldDefinition } from '../../domain/customer-intelligence-audience/index.js';
import type { CompiledAudienceSql } from './ports.js';

const FIELD_SQL: Readonly<Record<string, string>> = {
  'commercial.validOrders': 'fr.valid_orders', 'commercial.totalSpentTaxIncl': 'fr.total_spent_tax_incl', 'commercial.averageOrderValueTaxIncl': 'fr.average_order_value_tax_incl',
  'commercial.firstOrderAt': 'fr.first_order_at', 'commercial.lastOrderAt': 'fr.last_order_at', 'commercial.daysSinceLastOrder': 'fr.days_since_last_order', 'commercial.customerTenureDays': 'fr.customer_tenure_days',
  'commercial.distinctProducts': 'fr.distinct_products', 'commercial.repeatProductRate': 'fr.repeat_product_rate', 'commercial.top1Share': 'fr.top1_share', 'commercial.top3Share': 'fr.top3_share',
  'commercial.effectiveDiversity': 'fr.effective_diversity', 'commercial.averageUnitsPerOrder': 'fr.average_units_per_order', 'commercial.purchaseFrequencyDays': 'fr.purchase_frequency_days', 'commercial.orders365d': 'fr.orders_365d',
  'commercial.cancelledOrderRatio': 'fr.cancelled_order_ratio', 'commercial.discountShare': 'fr.discount_share', 'commercial.shippingShare': 'fr.shipping_share',
  'rfm.segmentCode': 'rr.segment_code', 'rfm.segmentVersion': 'rr.segment_version', 'rfm.rfmCode': 'rr.rfm_code', 'rfm.recencyDays': 'rr.recency_days', 'rfm.frequencyOrders': 'rr.frequency_orders',
  'rfm.grossOrderValueTaxIncl': 'rr.gross_order_value_tax_incl', 'rfm.recencyScore': 'rr.recency_score', 'rfm.frequencyScore': 'rr.frequency_score', 'rfm.monetaryScore': 'rr.monetary_score',
  'cluster.clusterId': 'cr.cluster_id', 'cluster.modelVersion': '?', 'clv.expectedRevenueTaxIncl': 'cv.expected_revenue_tax_incl', 'clv.expectedOrders': 'cv.expected_orders', 'clv.estimateSupportLevel': 'cv.estimate_support_level',
};

export function compileAudienceSql(context: AudienceEvaluationContextV1, filter: AudienceFilterV1): CompiledAudienceSql {
  const params: unknown[] = [];
  const expression = compileFilter(filter);
  const sql = `SELECT fr.prestashop_customer_id AS customerId, CASE ${expression} WHEN 1 THEN 'TRUE' WHEN 0 THEN 'FALSE' ELSE 'UNKNOWN' END AS truth\nFROM customer_feature_snapshot_row fr\nLEFT JOIN customer_rfm_snapshot_row rr ON rr.snapshot_id = ? AND rr.prestashop_customer_id = fr.prestashop_customer_id\nLEFT JOIN customer_cluster_snapshot_row cr ON cr.snapshot_id = ? AND cr.prestashop_customer_id = fr.prestashop_customer_id\nLEFT JOIN customer_clv_snapshot_row cv ON cv.snapshot_id = ? AND cv.customer_id = fr.prestashop_customer_id\nWHERE fr.snapshot_id = ?\nORDER BY fr.prestashop_customer_id ASC`;
  // The filter expression is emitted in SELECT before the JOIN and WHERE clauses, so its
  // placeholders must remain first. Snapshot ids follow in the SQL's actual placeholder order.
  params.push(context.lineage.rfm?.snapshotId ?? '0', context.lineage.cluster?.snapshotId ?? '0', context.lineage.clv?.snapshotId ?? '0', context.lineage.feature.snapshotId);
  return { sql, params };

  function compileFilter(node: AudienceFilterV1): string {
    if (node.kind === 'NOT') return `(CASE WHEN (${compileFilter(node.child)}) = 1 THEN 0 WHEN (${compileFilter(node.child)}) = 0 THEN 1 ELSE NULL END)`;
    if (node.kind === 'AND') return `(${node.children.map((child) => `(${compileFilter(child)})`).join(' AND ')})`;
    if (node.kind === 'OR') return `(${node.children.map((child) => `(${compileFilter(child)})`).join(' OR ')})`;
    if (node.kind === 'HAS_AFFINITY') return compileAffinity(node);
    return compileScalar(node);
  }
  function compileScalar(condition: Extract<AudienceConditionV1, { kind: 'SCALAR' }>): string {
    const meta = getAudienceFieldDefinition(condition.field);
    const column = FIELD_SQL[condition.field];
    if (!meta || !column) throw new Error(`Unsupported Audience field: ${condition.field}`);
    const rowPresent = meta.component === 'rfm' ? 'rr.prestashop_customer_id IS NOT NULL' : meta.component === 'cluster' ? 'cr.prestashop_customer_id IS NOT NULL' : meta.component === 'clv' ? 'cv.customer_id IS NOT NULL' : 'TRUE';
    if (condition.field === 'cluster.modelVersion') params.push(context.lineage.cluster?.modelVersion ?? '');
    const value = condition.value;
    let predicate: string;
    switch (condition.operator) {
      case 'IS_NULL': predicate = `${column} IS NULL`; break; case 'IS_NOT_NULL': predicate = `${column} IS NOT NULL`; break;
      case 'EQ': predicate = `${column} = ?`; params.push(value); break; case 'NEQ': predicate = `${column} <> ?`; params.push(value); break;
      case 'GT': predicate = `${column} > ?`; params.push(value); break; case 'GTE': predicate = `${column} >= ?`; params.push(value); break;
      case 'LT': predicate = `${column} < ?`; params.push(value); break; case 'LTE': predicate = `${column} <= ?`; params.push(value); break;
      case 'IN': predicate = `${column} IN (${placeholders(value)})`; break; case 'NOT_IN': predicate = `${column} NOT IN (${placeholders(value)})`; break;
      case 'BETWEEN': predicate = `${column} BETWEEN ? AND ?`; params.push(...(value as readonly unknown[])); break;
      default: throw new Error(`Unsupported Audience operator: ${condition.operator}`);
    }
    return `(CASE WHEN ${rowPresent} THEN CASE WHEN ${predicate} THEN 1 ELSE 0 END ELSE NULL END)`;
  }
  function placeholders(value: unknown): string {
    if (!Array.isArray(value) || value.length === 0) throw new Error('Audience IN must be non-empty');
    params.push(...value); return value.map(() => '?').join(', ');
  }
  function compileAffinity(condition: Extract<AudienceConditionV1, { kind: 'HAS_AFFINITY' }>): string {
    const snapshotId = context.lineage.commercialAffinity?.snapshotId ?? '0';
    const population = `EXISTS (SELECT 1 FROM customer_commercial_affinity_snapshot_population ap WHERE ap.snapshot_id = ? AND ap.customer_id = fr.prestashop_customer_id)`;
    const rowConditions = ['ar.snapshot_id = ?', 'ar.customer_id = fr.prestashop_customer_id', 'ar.affinity_axis = ?', 'ar.affinity_code = ?'];
    const rowParams: unknown[] = [snapshotId, condition.axis, condition.code.trim()];
    const unknownConditions = ['ar.snapshot_id = ?', 'ar.customer_id = fr.prestashop_customer_id', 'ar.affinity_axis = ?', 'ar.affinity_code = ?'];
    const unknownParams: unknown[] = [snapshotId, condition.axis, condition.code.trim()];
    if (condition.minScore !== undefined) { rowConditions.push('ar.score >= ?'); rowParams.push(condition.minScore); unknownConditions.push('ar.score >= ?'); unknownParams.push(condition.minScore); }
    if (condition.minSupportingOrderCount !== undefined) { rowConditions.push('ar.supporting_order_count >= ?'); rowParams.push(condition.minSupportingOrderCount); unknownConditions.push('ar.supporting_order_count >= ?'); unknownParams.push(condition.minSupportingOrderCount); }
    if (condition.minSupportingProductCount !== undefined) { rowConditions.push('ar.supporting_product_count >= ?'); rowParams.push(condition.minSupportingProductCount); unknownConditions.push('ar.supporting_product_count >= ?'); unknownParams.push(condition.minSupportingProductCount); }
    if (condition.minSupportingSpend !== undefined) { rowConditions.push('ar.supporting_spend >= ?'); rowParams.push(condition.minSupportingSpend); unknownConditions.push('ar.supporting_spend >= ?'); unknownParams.push(condition.minSupportingSpend); }
    if (condition.minExplicitEvidenceCoverage !== undefined) { rowConditions.push('ar.explicit_evidence_coverage >= ?'); rowParams.push(condition.minExplicitEvidenceCoverage); unknownConditions.push('ar.explicit_evidence_coverage IS NULL'); }
    if (condition.lastEvidenceAt !== undefined) { rowConditions.push(`ar.last_evidence_at ${lastEvidenceOperator(condition.lastEvidenceAt.operator)} ?`); rowParams.push(condition.lastEvidenceAt.value); unknownConditions.push(`ar.last_evidence_at ${lastEvidenceOperator(condition.lastEvidenceAt.operator)} ?`); unknownParams.push(condition.lastEvidenceAt.value); }
    params.push(snapshotId, ...rowParams, ...(condition.minExplicitEvidenceCoverage === undefined ? [] : unknownParams));
    const unknown = condition.minExplicitEvidenceCoverage === undefined ? '' : ` WHEN EXISTS (SELECT 1 FROM customer_commercial_affinity_snapshot_row ar WHERE ${unknownConditions.join(' AND ')}) THEN NULL`;
    return `(CASE WHEN ${population} THEN CASE WHEN EXISTS (SELECT 1 FROM customer_commercial_affinity_snapshot_row ar WHERE ${rowConditions.join(' AND ')}) THEN 1${unknown} ELSE 0 END ELSE NULL END)`;
  }
  function lastEvidenceOperator(operator: string): '=' | '>' | '>=' | '<' | '<=' {
    switch (operator) { case 'EQ': return '='; case 'GT': return '>'; case 'GTE': return '>='; case 'LT': return '<'; case 'LTE': return '<='; default: throw new Error('Unsupported affinity lastEvidenceAt operator'); }
  }
}
