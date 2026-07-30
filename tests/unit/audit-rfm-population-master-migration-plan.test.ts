import { describe, expect, it } from 'vitest';
import { buildMasterMigrationComparisonPlan } from '../../scripts/audits/rfm-population/lib/master-migration-plan.js';

describe('CP-R1-T10A master_customer migration comparison plan (section 10)', () => {
  it('is a design-only plan that never queries master_customer', () => {
    const plan = buildMasterMigrationComparisonPlan();
    expect(plan.status).toBe('design_only_not_executable_yet');
    expect(JSON.stringify(plan)).not.toMatch(/masterCount\s*:\s*\d/);
  });

  it('defines every metric section 10 asks for', () => {
    const plan = buildMasterMigrationComparisonPlan();
    const metricNames = (plan.metricsToCollect as { metric: string }[]).map((entry) => entry.metric);
    expect(metricNames).toEqual(
      expect.arrayContaining([
        'migratedPrestashopCustomerCount',
        'masterCustomerCount',
        'prestashopCustomerIdCoverage',
        'duplicatePrestashopCustomerIdLinks',
        'missingPrestashopCustomerIdLinks',
        'mergeCount',
        'splitCount',
        'validOrdersCoveredByMigration',
        'grossMonetaryCoveredByMigration',
        'rfmDifferencePerIdentity',
        'scoreCodeChangeRate',
        'populationChange',
      ]),
    );
  });

  it('encodes the exact acceptance criteria from the audit brief', () => {
    const plan = buildMasterMigrationComparisonPlan();
    const criteria = (plan.acceptanceCriteria as { criterion: string }[]).map((entry) => entry.criterion);
    expect(criteria).toContainEqual(expect.stringContaining('>= 99.9%'));
    expect(criteria).toContainEqual(expect.stringContaining('duplicatePrestashopCustomerIdLinks == 0'));
    expect(criteria.join(' ')).toMatch(/delta == 0/);
  });
});
