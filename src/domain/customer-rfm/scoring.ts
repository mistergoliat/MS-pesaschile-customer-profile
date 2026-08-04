import { compareRfmDecimalAsc } from './decimal.js';

export type RfmScore = 1 | 2 | 3 | 4 | 5;

export type FrequencyThresholds = {
  readonly score1: readonly [number, number];
  readonly score2: readonly [number, number];
  readonly score3: readonly [number, number];
  readonly score4: readonly [number, number];
  readonly score5: readonly [number, null];
};

export const defaultFrequencyThresholds: FrequencyThresholds = {
  score1: [1, 1],
  score2: [2, 2],
  score3: [3, 3],
  score4: [4, 5],
  score5: [6, null],
};

export const frequencyScoringPolicyVersion = 'frequency-thresholds-candidate-v1';

export function scoreRecencyTieSafe(values: readonly number[]): Map<number, RfmScore> {
  return scoreTieSafeNumber(values, 'lower_value_better');
}

export function scoreMonetaryTieSafe(values: readonly string[]): Map<string, RfmScore> {
  return scoreTieSafeDecimal(values, 'higher_value_better');
}

export function scoreFrequencyThresholds(value: number, thresholds = defaultFrequencyThresholds): RfmScore {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid frequencyOrders: ${String(value)}`);
  }
  const entries: Array<readonly [RfmScore, readonly [number, number | null]]> = [
    [1, thresholds.score1],
    [2, thresholds.score2],
    [3, thresholds.score3],
    [4, thresholds.score4],
    [5, thresholds.score5],
  ];
  for (const [score, [min, max]] of entries) {
    if (value >= min && (max === null || value <= max)) {
      return score;
    }
  }
  throw new Error(`frequencyOrders did not match configured thresholds: ${value}`);
}

export function buildRfmCode(recencyScore: RfmScore, frequencyScore: RfmScore, monetaryScore: RfmScore): string {
  return `R${recencyScore}F${frequencyScore}M${monetaryScore}`;
}

function scoreTieSafeNumber(values: readonly number[], method: 'lower_value_better' | 'higher_value_better'): Map<number, RfmScore> {
  const unique = Array.from(new Set(values)).sort((a, b) => a - b);
  const ordered = method === 'lower_value_better' ? unique : [...unique].reverse();
  const scores = new Map<number, RfmScore>();
  for (const [index, value] of ordered.entries()) {
    const rankFraction = ordered.length === 1 ? 1 : 1 - index / ordered.length;
    scores.set(value, toScore(rankFraction));
  }
  return scores;
}

function scoreTieSafeDecimal(values: readonly string[], method: 'lower_value_better' | 'higher_value_better'): Map<string, RfmScore> {
  const unique = Array.from(new Set(values)).sort(compareRfmDecimalAsc);
  const ordered = method === 'lower_value_better' ? unique : [...unique].reverse();
  const scores = new Map<string, RfmScore>();
  for (const [index, value] of ordered.entries()) {
    const rankFraction = ordered.length === 1 ? 1 : 1 - index / ordered.length;
    scores.set(value, toScore(rankFraction));
  }
  return scores;
}

function toScore(rankFraction: number): RfmScore {
  return Math.max(1, Math.min(5, Math.ceil(rankFraction * 5))) as RfmScore;
}
