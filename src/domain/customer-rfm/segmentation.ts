import type { RfmScore } from './scoring.js';

export const rfmCommercialSegmentVersion = 'rfm-commercial-v1';

export type RfmCommercialSegmentCode =
  | 'CHAMPION'
  | 'LOYAL'
  | 'POTENTIAL_LOYAL'
  | 'RECENT_HIGH_VALUE'
  | 'RECENT_ONE_TIME'
  | 'NEEDS_ATTENTION'
  | 'AT_RISK_HIGH_VALUE'
  | 'HIBERNATING';

export const rfmCommercialSegmentCodes: readonly RfmCommercialSegmentCode[] = [
  'CHAMPION',
  'LOYAL',
  'POTENTIAL_LOYAL',
  'RECENT_HIGH_VALUE',
  'RECENT_ONE_TIME',
  'NEEDS_ATTENTION',
  'AT_RISK_HIGH_VALUE',
  'HIBERNATING',
];

export type RfmCommercialSegment = {
  readonly segmentCode: RfmCommercialSegmentCode;
  readonly segmentVersion: typeof rfmCommercialSegmentVersion;
};

export function classifyRfmCommercialSegment(input: {
  readonly recencyScore: RfmScore;
  readonly frequencyScore: RfmScore;
  readonly monetaryScore: RfmScore;
}): RfmCommercialSegment {
  const recencyScore = assertScore(input.recencyScore, 'recencyScore');
  const frequencyScore = assertScore(input.frequencyScore, 'frequencyScore');
  const monetaryScore = assertScore(input.monetaryScore, 'monetaryScore');

  if (recencyScore >= 4 && frequencyScore >= 4 && monetaryScore >= 4) {
    return segment('CHAMPION');
  }
  if (recencyScore >= 3 && frequencyScore >= 3) {
    return segment('LOYAL');
  }
  if (recencyScore >= 4 && frequencyScore === 2) {
    return segment('POTENTIAL_LOYAL');
  }
  if (recencyScore >= 4 && frequencyScore === 1 && monetaryScore >= 4) {
    return segment('RECENT_HIGH_VALUE');
  }
  if (recencyScore >= 4 && frequencyScore === 1) {
    return segment('RECENT_ONE_TIME');
  }
  if (recencyScore === 3) {
    return segment('NEEDS_ATTENTION');
  }
  if (recencyScore <= 2 && (monetaryScore >= 4 || frequencyScore >= 3)) {
    return segment('AT_RISK_HIGH_VALUE');
  }
  return segment('HIBERNATING');
}

function segment(segmentCode: RfmCommercialSegmentCode): RfmCommercialSegment {
  return {
    segmentCode,
    segmentVersion: rfmCommercialSegmentVersion,
  };
}

function assertScore(value: RfmScore, field: string): RfmScore {
  if (![1, 2, 3, 4, 5].includes(value)) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return value;
}
