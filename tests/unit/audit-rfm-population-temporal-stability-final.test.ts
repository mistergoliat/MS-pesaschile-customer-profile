import { describe, expect, it } from 'vitest';
import { buildFinalSnapshot, compareFinalSnapshots, type FinalSnapshotRow } from '../../scripts/audits/rfm-population/lib/temporal-stability-final.js';
import { classifyFrequencyModelB } from '../../scripts/audits/rfm-population/lib/frequency-models.js';
import type { FrozenRecencyBoundaries } from '../../scripts/audits/rfm-population/lib/recency-methods.js';
import type { FrozenMonetaryBoundaries } from '../../scripts/audits/rfm-population/lib/monetary-methods.js';

const RECENCY_BOUNDARIES: FrozenRecencyBoundaries = [10, 30, 60, 120];
const MONETARY_BOUNDARIES: FrozenMonetaryBoundaries = ['10.000000', '20.000000', '30.000000', '40.000000'];

describe('CP-R1-T10A-3 real temporal stability, Dynamic vs Frozen (section 12)', () => {
  it('builds parallel Dynamic and Frozen scores in one snapshot', () => {
    const rows: FinalSnapshotRow[] = [
      { prestashopCustomerId: 1, frequencyOrders: 1, grossMonetaryTaxIncl: '5.000000', recencyDays: 200 },
      { prestashopCustomerId: 2, frequencyOrders: 10, grossMonetaryTaxIncl: '50.000000', recencyDays: 5 },
    ];
    const snapshot = buildFinalSnapshot(rows, classifyFrequencyModelB, RECENCY_BOUNDARIES, MONETARY_BOUNDARIES);
    const customer2 = snapshot.get(2)!;
    expect(customer2.rFrozen).toBe(5);
    expect(customer2.mFrozen).toBe(5);
    expect(customer2.f).toBe(5);
  });

  it('attributes an unchanged customer to "no change at all" when nothing moves', () => {
    const rows: FinalSnapshotRow[] = [{ prestashopCustomerId: 1, frequencyOrders: 2, grossMonetaryTaxIncl: '25.000000', recencyDays: 20 }];
    const snapshot = buildFinalSnapshot(rows, classifyFrequencyModelB, RECENCY_BOUNDARIES, MONETARY_BOUNDARIES);
    const stats = compareFinalSnapshots(snapshot, snapshot);
    expect(stats.changeAttribution.noChangeAtAll).toBe(1);
    expect(stats.dynamic.identicalCodeCount).toBe(1);
    expect(stats.frozen.identicalCodeCount).toBe(1);
  });

  it('attributes a raw-metric change (new order) to "window activity change", not time or population', () => {
    const baseline = buildFinalSnapshot(
      [{ prestashopCustomerId: 1, frequencyOrders: 1, grossMonetaryTaxIncl: '10.000000', recencyDays: 50 }],
      classifyFrequencyModelB,
      RECENCY_BOUNDARIES,
      MONETARY_BOUNDARIES,
    );
    const comparison = buildFinalSnapshot(
      [{ prestashopCustomerId: 1, frequencyOrders: 2, grossMonetaryTaxIncl: '35.000000', recencyDays: 5 }],
      classifyFrequencyModelB,
      RECENCY_BOUNDARIES,
      MONETARY_BOUNDARIES,
    );
    const stats = compareFinalSnapshots(baseline, comparison);
    expect(stats.changeAttribution.explainedByWindowActivityChange).toBe(1);
    expect(stats.changeAttribution.explainedByTimePassingOnly).toBe(0);
    expect(stats.changeAttribution.explainedByPopulationChangeOnly).toBe(0);
  });

  it('attributes a raw-unchanged, frozen-boundary-crossing change to "time passing only"', () => {
    const baseline = buildFinalSnapshot(
      [{ prestashopCustomerId: 1, frequencyOrders: 1, grossMonetaryTaxIncl: '10.000000', recencyDays: 9 }],
      classifyFrequencyModelB,
      RECENCY_BOUNDARIES,
      MONETARY_BOUNDARIES,
    );
    // same order (frequency/monetary identical), but the calendar date moved and recency
    // crossed the p20=10 frozen boundary purely from time passing.
    const comparison = buildFinalSnapshot(
      [{ prestashopCustomerId: 1, frequencyOrders: 1, grossMonetaryTaxIncl: '10.000000', recencyDays: 11 }],
      classifyFrequencyModelB,
      RECENCY_BOUNDARIES,
      MONETARY_BOUNDARIES,
    );
    const stats = compareFinalSnapshots(baseline, comparison);
    expect(stats.changeAttribution.explainedByTimePassingOnly).toBe(1);
    expect(stats.frozen.r.identicalCount).toBe(0);
  });

  it('builds a 5x5 transition matrix and counts customers only present in one snapshot', () => {
    const baseline = buildFinalSnapshot(
      [
        { prestashopCustomerId: 1, frequencyOrders: 1, grossMonetaryTaxIncl: '5.000000', recencyDays: 200 },
        { prestashopCustomerId: 2, frequencyOrders: 1, grossMonetaryTaxIncl: '5.000000', recencyDays: 200 },
      ],
      classifyFrequencyModelB,
      RECENCY_BOUNDARIES,
      MONETARY_BOUNDARIES,
    );
    const comparison = buildFinalSnapshot(
      [{ prestashopCustomerId: 1, frequencyOrders: 1, grossMonetaryTaxIncl: '5.000000', recencyDays: 200 }],
      classifyFrequencyModelB,
      RECENCY_BOUNDARIES,
      MONETARY_BOUNDARIES,
    );
    const stats = compareFinalSnapshots(baseline, comparison);
    expect(stats.comparedCustomers).toBe(1);
    expect(stats.onlyInBaseline).toBe(1);
    expect(stats.onlyInComparison).toBe(0);
    expect(stats.frozen.r.transitionMatrix).toHaveLength(5);
    expect(stats.frozen.r.transitionMatrix[0]!).toHaveLength(5);
    // customer 1 unchanged: score1->score1 (r=1 for recencyDays=200 under our boundaries)
    expect(stats.frozen.r.transitionMatrix[0]![0]).toBe(1);
  });

  it('does not throw and returns zeroed stats when there is no overlap', () => {
    const baseline = buildFinalSnapshot(
      [{ prestashopCustomerId: 1, frequencyOrders: 1, grossMonetaryTaxIncl: '5.000000', recencyDays: 200 }],
      classifyFrequencyModelB,
      RECENCY_BOUNDARIES,
      MONETARY_BOUNDARIES,
    );
    const comparison = buildFinalSnapshot(
      [{ prestashopCustomerId: 2, frequencyOrders: 1, grossMonetaryTaxIncl: '5.000000', recencyDays: 200 }],
      classifyFrequencyModelB,
      RECENCY_BOUNDARIES,
      MONETARY_BOUNDARIES,
    );
    const stats = compareFinalSnapshots(baseline, comparison);
    expect(stats.comparedCustomers).toBe(0);
    expect(stats.dynamic.identicalCodePercent).toBe('0.000000');
  });
});
