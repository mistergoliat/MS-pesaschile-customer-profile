// CP-R1-T10A extension (section 10): design-only. RFM_IDENTITY_MODE=prestashop_customer
// explicitly must not query master_customer (see ./identity-mode.ts), and master_customer
// migration/population is not complete yet (see docs/audits/rfm-population/
// CP-R1-T10A-rfm-population-audit.md Facts). This module has no DB dependency — it is a
// static plan of what the future 1:1 validation must measure and the thresholds a
// migration must clear before ps_customer-based scores can be replaced by
// master_customer-based scores.
export function buildMasterMigrationComparisonPlan(): Record<string, unknown> {
  return {
    status: 'design_only_not_executable_yet',
    reason: 'master_customer migration/population is not complete; RFM_IDENTITY_MODE=prestashop_customer must not query master_customer',
    prerequisite: 'master_customer fully populated with prestashop_customer_id links for the same PrestaShop instance audited here',
    metricsToCollect: [
      { metric: 'migratedPrestashopCustomerCount', definition: 'COUNT of ps_customer.id_customer rows with a resolved master_customer.prestashop_customer_id link' },
      { metric: 'masterCustomerCount', definition: 'COUNT(*) FROM master_customer' },
      { metric: 'prestashopCustomerIdCoverage', definition: 'migratedPrestashopCustomerCount / totalIdentityCandidates from this provisional run' },
      { metric: 'duplicatePrestashopCustomerIdLinks', definition: 'master_customer rows sharing the same prestashop_customer_id (must be 0 for a clean 1:1)' },
      { metric: 'missingPrestashopCustomerIdLinks', definition: 'ps_customer rows with valid orders that have no master_customer link' },
      { metric: 'mergeCount', definition: 'multiple ps_customer.id_customer values resolving to the same masterCustomerId (identity consolidation)' },
      { metric: 'splitCount', definition: 'a single ps_customer.id_customer resolving to more than one masterCustomerId (should not happen; treat as a data-quality defect if found)' },
      { metric: 'validOrdersCoveredByMigration', definition: 'valid orders whose id_customer resolves to a migrated master_customer, as a share of this run\'s total valid orders' },
      { metric: 'grossMonetaryCoveredByMigration', definition: 'gross grossMonetaryTaxIncl covered by migration, as a share of this run\'s total' },
      { metric: 'rfmDifferencePerIdentity', definition: 'for 1:1 mapped identities, delta between prestashop_customer-mode R/F/M metrics and master_customer-mode R/F/M metrics; expected 0 for clean 1:1 mappings' },
      { metric: 'scoreCodeChangeRate', definition: 'share of customers whose R/F/M score/code changes purely from the identity-mode switch, holding modelVersion and asOfDate fixed' },
      { metric: 'populationChange', definition: 'net change in active/historical_inactive/no_valid_purchases population size caused only by identity resolution (merges/splits), not by new orders' },
    ],
    acceptanceCriteria: [
      { criterion: 'prestashopCustomerIdCoverage >= 99.9%', rationale: 'unconsolidated PrestaShop history must be a negligible, explicitly reported remainder, not silently dropped' },
      { criterion: 'duplicatePrestashopCustomerIdLinks == 0', rationale: 'a duplicate link means two master_customer rows would double-count the same commercial history' },
      { criterion: 'validOrdersCoveredByMigration delta == 0 for 1:1 mapped identities', rationale: 'a clean 1:1 migration must not lose or duplicate order history for any individually mapped customer' },
      { criterion: 'grossMonetaryCoveredByMigration delta == 0 for 1:1 mapped identities', rationale: 'same order-count guarantee, applied to monetary value' },
      { criterion: 'scoreCodeChangeRate == 0 except for explicit merges', rationale: 'the identity layer must not silently change a customer\'s R/F/M score; any change must be traceable to a documented merge, not to migration noise' },
    ],
    methodology:
      'Run this same audit twice for the same modelVersion/asOfDate/window — once with RFM_IDENTITY_MODE=prestashop_customer and once with RFM_IDENTITY_MODE=master_customer — then diff totalIdentityCandidates, population buckets, and per-identity R/F/M outputs. Only aggregate diffs are published; no individual identity pairs are recorded.',
    outOfScopeForThisRun: [
      'querying master_customer',
      'computing any of the metrics above with real numbers',
      'freezing rfm-v1 thresholds against master_customer identity',
    ],
  };
}
