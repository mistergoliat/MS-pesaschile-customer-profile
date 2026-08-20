import { describe, expect, it } from 'vitest';
import { computeCoverageSummary } from '../../src/domain/customer-intelligence/coverage.js';

// Task Section 46's exact worked fixture: 10 feature customers, 7 RFM-matched, 4
// cluster-matched, 3 matched by both.
describe('computeCoverageSummary (task Section 25/46)', () => {
  it('matches the exact worked fixture', () => {
    const summary = computeCoverageSummary({ featurePopulation: 10, rfmMatched: 7, clusterMatched: 4, bothMatched: 3 });
    expect(summary).toEqual({
      featurePopulation: 10,
      rfmMatched: 7,
      clusterMatched: 4,
      bothMatched: 3,
      // inclusion-exclusion: 10 - 7 - 4 + 3 = 2
      neitherMatched: 2,
      rfmCoveragePct: 70,
      clusterCoveragePct: 40,
    });
  });

  it('handles zero population without dividing by zero', () => {
    const summary = computeCoverageSummary({ featurePopulation: 0, rfmMatched: 0, clusterMatched: 0, bothMatched: 0 });
    expect(summary.rfmCoveragePct).toBe(0);
    expect(summary.clusterCoveragePct).toBe(0);
    expect(summary.neitherMatched).toBe(0);
  });

  it('handles full coverage (rfmMatched = clusterMatched = bothMatched = featurePopulation)', () => {
    const summary = computeCoverageSummary({ featurePopulation: 5, rfmMatched: 5, clusterMatched: 5, bothMatched: 5 });
    expect(summary.rfmCoveragePct).toBe(100);
    expect(summary.clusterCoveragePct).toBe(100);
    expect(summary.neitherMatched).toBe(0);
  });

  it('rounds percentages to 2 decimals', () => {
    const summary = computeCoverageSummary({ featurePopulation: 3, rfmMatched: 1, clusterMatched: 0, bothMatched: 0 });
    expect(summary.rfmCoveragePct).toBeCloseTo(33.33, 2);
  });

  it.each([
    ['negative featurePopulation', { featurePopulation: -1, rfmMatched: 0, clusterMatched: 0, bothMatched: 0 }],
    ['rfmMatched exceeds featurePopulation', { featurePopulation: 5, rfmMatched: 6, clusterMatched: 0, bothMatched: 0 }],
    ['clusterMatched exceeds featurePopulation', { featurePopulation: 5, rfmMatched: 0, clusterMatched: 6, bothMatched: 0 }],
    ['bothMatched exceeds rfmMatched', { featurePopulation: 5, rfmMatched: 2, clusterMatched: 4, bothMatched: 3 }],
    ['bothMatched exceeds clusterMatched', { featurePopulation: 5, rfmMatched: 4, clusterMatched: 2, bothMatched: 3 }],
  ])('rejects inconsistent counts: %s', (_label, counts) => {
    expect(() => computeCoverageSummary(counts)).toThrow();
  });
});
