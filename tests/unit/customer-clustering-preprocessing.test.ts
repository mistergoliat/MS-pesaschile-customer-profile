import { describe, expect, it } from 'vitest';
import { applyFeatureTransform, transformFeatureVector } from '../../src/domain/customer-clustering/preprocessing.js';
import { featureOrder } from '../../src/domain/customer-clustering/model-version.js';
import type { FeatureTransform, RawClusterFeatureVector } from '../../src/domain/customer-clustering/contracts.js';

describe('applyFeatureTransform', () => {
  it('log1p_robust_scale: (log1p(x) - center) / scale', () => {
    const transform: FeatureTransform = { kind: 'log1p_robust_scale', center: Math.log1p(3), scale: 2 };
    expect(applyFeatureTransform(3, transform)).toBeCloseTo(0, 10);
    const transform2: FeatureTransform = { kind: 'log1p_robust_scale', center: 0, scale: 1 };
    expect(applyFeatureTransform(Math.E - 1, transform2)).toBeCloseTo(1, 10);
  });

  it('robust_scale: (x - center) / scale, no log1p (customerTenureDays semantics)', () => {
    const transform: FeatureTransform = { kind: 'robust_scale', center: 1000, scale: 500 };
    expect(applyFeatureTransform(1500, transform)).toBeCloseTo(1, 10);
    expect(applyFeatureTransform(1000, transform)).toBeCloseTo(0, 10);
  });

  it('clip01: clamps to [0,1], absorbing rounding drift like the observed top3Share=1.000001', () => {
    const transform: FeatureTransform = { kind: 'clip01' };
    expect(applyFeatureTransform(1.000001, transform)).toBe(1);
    expect(applyFeatureTransform(-0.0001, transform)).toBe(0);
    expect(applyFeatureTransform(0.5, transform)).toBe(0.5);
  });

  it('winsorize_p99: clamps to [0, cap], never rescaled (raw ratio semantics preserved)', () => {
    const transform: FeatureTransform = { kind: 'winsorize_p99', cap: 0.174 };
    expect(applyFeatureTransform(4.376, transform)).toBe(0.174); // observed live discountShare outlier
    expect(applyFeatureTransform(0.05, transform)).toBe(0.05);
    expect(applyFeatureTransform(-1, transform)).toBe(0);
  });
});

describe('transformFeatureVector', () => {
  const identityTransforms = Object.fromEntries(featureOrder.map((f) => [f, { kind: 'clip01' } as FeatureTransform])) as Record<
    (typeof featureOrder)[number],
    FeatureTransform
  >;

  function rawVector(overrides: Partial<RawClusterFeatureVector> = {}): RawClusterFeatureVector {
    const base = Object.fromEntries(featureOrder.map((f) => [f, 0.5])) as RawClusterFeatureVector;
    return { ...base, ...overrides };
  }

  it('produces one transformed value per feature, in featureOrder order', () => {
    const result = transformFeatureVector(rawVector(), featureOrder, identityTransforms);
    expect(result).toHaveLength(featureOrder.length);
    expect(result.every((v) => v === 0.5)).toBe(true);
  });

  it('throws on a missing transform for a feature (fail fast, never silently skip)', () => {
    const incomplete = { ...identityTransforms };
    delete (incomplete as Record<string, unknown>)['top1Share'];
    expect(() => transformFeatureVector(rawVector(), featureOrder, incomplete)).toThrow(/Missing transform/);
  });

  it('throws on a non-finite raw feature value rather than silently coercing it', () => {
    const vector = rawVector({ distinctProducts: Number.NaN });
    expect(() => transformFeatureVector(vector, featureOrder, identityTransforms)).toThrow(/Invalid raw feature value/);
  });
});
