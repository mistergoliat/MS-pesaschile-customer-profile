import { describe, expect, it } from 'vitest';
import {
  classifyRfmCommercialSegment,
  rfmCommercialSegmentCodes,
  rfmCommercialSegmentVersion,
  type RfmCommercialSegmentCode,
  type RfmScore,
} from '../../src/domain/customer-rfm/index.js';

function classify(recencyScore: RfmScore, frequencyScore: RfmScore, monetaryScore: RfmScore) {
  return classifyRfmCommercialSegment({ recencyScore, frequencyScore, monetaryScore });
}

describe('classifyRfmCommercialSegment', () => {
  it('classifies every valid R/F/M combination exactly once', () => {
    const seen = new Set<string>();

    for (const recencyScore of [1, 2, 3, 4, 5] as const) {
      for (const frequencyScore of [1, 2, 3, 4, 5] as const) {
        for (const monetaryScore of [1, 2, 3, 4, 5] as const) {
          const result = classify(recencyScore, frequencyScore, monetaryScore);
          expect(rfmCommercialSegmentCodes).toContain(result.segmentCode);
          expect(result.segmentVersion).toBe(rfmCommercialSegmentVersion);
          seen.add(`R${recencyScore}F${frequencyScore}M${monetaryScore}:${result.segmentCode}`);
        }
      }
    }

    expect(seen.size).toBe(125);
  });

  it('is reproducible for the same score triple', () => {
    const first = classify(4, 2, 5);
    const second = classify(4, 2, 5);

    expect(second).toEqual(first);
  });

  it.each<readonly [RfmScore, RfmScore, RfmScore, RfmCommercialSegmentCode]>([
    [5, 5, 5, 'CHAMPION'],
    [4, 3, 4, 'LOYAL'],
    [5, 2, 3, 'POTENTIAL_LOYAL'],
    [5, 1, 5, 'RECENT_HIGH_VALUE'],
    [4, 1, 2, 'RECENT_ONE_TIME'],
    [3, 1, 5, 'NEEDS_ATTENTION'],
    [2, 3, 2, 'AT_RISK_HIGH_VALUE'],
    [1, 1, 2, 'HIBERNATING'],
  ])('maps R%s F%s M%s to %s', (recencyScore, frequencyScore, monetaryScore, expected) => {
    expect(classify(recencyScore, frequencyScore, monetaryScore)).toEqual({
      segmentCode: expected,
      segmentVersion: rfmCommercialSegmentVersion,
    });
  });

  it('rejects invalid score inputs instead of silently classifying them', () => {
    expect(() => classifyRfmCommercialSegment({ recencyScore: 0 as RfmScore, frequencyScore: 1, monetaryScore: 1 })).toThrow(
      /recencyScore/,
    );
    expect(() => classifyRfmCommercialSegment({ recencyScore: 1, frequencyScore: 6 as RfmScore, monetaryScore: 1 })).toThrow(
      /frequencyScore/,
    );
    expect(() => classifyRfmCommercialSegment({ recencyScore: 1, frequencyScore: 1, monetaryScore: 9 as RfmScore })).toThrow(
      /monetaryScore/,
    );
  });
});
