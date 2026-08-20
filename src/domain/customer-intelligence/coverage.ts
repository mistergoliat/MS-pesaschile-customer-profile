import type { CustomerIntelligencePopulationCoverage } from './contracts.js';

export type CoverageCounts = {
  readonly featurePopulation: number;
  readonly rfmMatched: number;
  readonly clusterMatched: number;
  readonly bothMatched: number;
};

// Pure percentage/derived-count math (task Section 14/25/46) — same round-to-2-decimals
// convention CP-R2-T03's cross-tab coverage already uses, so the two coverage shapes read
// consistently across the codebase.
export function computeCoverageSummary(counts: CoverageCounts): CustomerIntelligencePopulationCoverage {
  if (counts.featurePopulation < 0 || counts.rfmMatched < 0 || counts.clusterMatched < 0 || counts.bothMatched < 0) {
    throw new Error('Coverage counts must be non-negative');
  }
  if (counts.rfmMatched > counts.featurePopulation || counts.clusterMatched > counts.featurePopulation) {
    throw new Error('A matched count cannot exceed the feature population');
  }
  if (counts.bothMatched > counts.rfmMatched || counts.bothMatched > counts.clusterMatched) {
    throw new Error('bothMatched cannot exceed either individual matched count');
  }

  const neitherMatched = counts.featurePopulation - counts.rfmMatched - counts.clusterMatched + counts.bothMatched;
  if (neitherMatched < 0) {
    throw new Error('Coverage counts are inconsistent (inclusion-exclusion produced a negative neitherMatched)');
  }

  return {
    featurePopulation: counts.featurePopulation,
    rfmMatched: counts.rfmMatched,
    clusterMatched: counts.clusterMatched,
    bothMatched: counts.bothMatched,
    neitherMatched,
    rfmCoveragePct: percentage(counts.rfmMatched, counts.featurePopulation),
    clusterCoveragePct: percentage(counts.clusterMatched, counts.featurePopulation),
  };
}

function percentage(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100 * 100) / 100;
}
