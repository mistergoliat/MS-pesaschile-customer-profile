export const CUSTOMER_RFM_SNAPSHOT_CONTRACT_FIELDS = [
  'masterCustomerId',
  'status',
  'modelVersion',
  'calculatedAt',
  'asOfDate',
  'windowStartInclusive',
  'windowEndExclusive',
  'metrics.recencyDays',
  'metrics.frequencyOrders',
  'metrics.grossMonetaryTaxIncl',
  'scores.recency',
  'scores.frequency',
  'scores.monetary',
  'scores.rfmCode',
  'percentiles.recency',
  'percentiles.frequency',
  'percentiles.monetary',
  'lifecycleStage',
] as const;

export function buildSnapshotProposal(): Record<string, unknown> {
  return {
    modelVersion: 'rfm-v1',
    endpointFields: CUSTOMER_RFM_SNAPSHOT_CONTRACT_FIELDS,
    persistPercentiles: true,
    publishNamedSegment: false,
    pipeline:
      'PrestaShop + master_customer -> population dataset -> versioned scoring -> snapshot by masterCustomerId -> Customer Profile reader -> Sales Agent / CRM / Campaign Engine',
    recommendedFrequency: 'daily',
    recommendedRunTime: 'off-peak local early morning after order ingestion settles',
    idempotency: 'one immutable modelVersion/asOfDate output set, atomically published after validation',
  };
}
