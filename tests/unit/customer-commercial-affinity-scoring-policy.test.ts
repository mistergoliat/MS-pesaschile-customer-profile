import { describe, expect, it } from 'vitest';
import {
  RECENCY_HALF_LIFE_DAYS,
  confidenceMultiplier,
  diversityBonus,
  frequencyWeight,
  monetaryWeight,
  recencyWeight,
  repeatBonus,
  roleMultiplier,
  roundToAffinityPrecision,
  saturate,
} from '../../src/domain/customer-commercial-affinity/index.js';

describe('recencyWeight — half-life decay', () => {
  it('is 1 at zero days and decays to ~0.5 at exactly the half-life', () => {
    expect(recencyWeight(0)).toBe(1);
    expect(recencyWeight(RECENCY_HALF_LIFE_DAYS)).toBeCloseTo(0.5, 6);
  });

  it('is strictly monotonically decreasing with age, never negative', () => {
    const recent = recencyWeight(10);
    const older = recencyWeight(100);
    const veryOld = recencyWeight(3650);

    expect(recent).toBeGreaterThan(older);
    expect(older).toBeGreaterThan(veryOld);
    expect(veryOld).toBeGreaterThan(0);
  });

  it('rejects negative, NaN, and non-finite input', () => {
    expect(() => recencyWeight(-1)).toThrow();
    expect(() => recencyWeight(NaN)).toThrow();
    expect(() => recencyWeight(Infinity)).toThrow();
  });
});

describe('frequencyWeight — saturating transform', () => {
  it('is 0 at zero orders', () => {
    expect(frequencyWeight(0)).toBe(0);
  });

  it('grows with diminishing returns: 20 orders is not 20x the evidence of 1 order', () => {
    const one = frequencyWeight(1);
    const twenty = frequencyWeight(20);

    expect(twenty).toBeGreaterThan(one);
    expect(twenty).toBeLessThan(one * 20);
    expect(twenty).toBeLessThan(1); // bounded, never reaches the ceiling
  });

  it('rejects negative or non-integer input', () => {
    expect(() => frequencyWeight(-1)).toThrow();
    expect(() => frequencyWeight(1.5)).toThrow();
  });
});

describe('repeatBonus', () => {
  it('is a flat, bounded 0/1 bonus', () => {
    expect(repeatBonus(true)).toBe(1);
    expect(repeatBonus(false)).toBe(0);
  });
});

describe('monetaryWeight — dampened spend share', () => {
  it('is 0 at zero share and 1 at full share', () => {
    expect(monetaryWeight(0)).toBe(0);
    expect(monetaryWeight(1)).toBe(1);
  });

  it('dampens small shares upward relative to a linear weighting', () => {
    // sqrt(0.01) = 0.1, which is 10x its linear value -- the low end is boosted.
    expect(monetaryWeight(0.01)).toBeCloseTo(0.1, 6);
    expect(monetaryWeight(0.01)).toBeGreaterThan(0.01);
  });

  it('is monotonically increasing and never exceeds 1', () => {
    expect(monetaryWeight(0.5)).toBeGreaterThan(monetaryWeight(0.2));
    expect(monetaryWeight(1)).toBeLessThanOrEqual(1);
  });

  it('rejects out-of-range or non-finite input', () => {
    expect(() => monetaryWeight(-0.01)).toThrow();
    expect(() => monetaryWeight(1.01)).toThrow();
    expect(() => monetaryWeight(NaN)).toThrow();
  });
});

describe('roleMultiplier — primary vs. secondary vs. standard', () => {
  it('weights primary above secondary, and standard at full weight', () => {
    expect(roleMultiplier('primary')).toBeGreaterThan(roleMultiplier('secondary'));
    expect(roleMultiplier('secondary')).toBeGreaterThan(0);
    expect(roleMultiplier('standard')).toBe(1);
  });
});

describe('confidenceMultiplier — EXPLICIT == missing >= STRONGLY_INFERRED', () => {
  it('treats a missing confidence exactly like EXPLICIT (full weight, never a discount)', () => {
    expect(confidenceMultiplier(undefined)).toBe(confidenceMultiplier('EXPLICIT'));
  });

  it('applies a small, bounded discount to STRONGLY_INFERRED only', () => {
    const explicit = confidenceMultiplier('EXPLICIT');
    const inferred = confidenceMultiplier('STRONGLY_INFERRED');

    expect(inferred).toBeLessThan(explicit);
    expect(inferred).toBeGreaterThan(0.5); // small discount, not a dominant penalty
  });
});

describe('diversityBonus — distinct-product saturation', () => {
  it('is 0 with no supporting products, and grows with diminishing returns', () => {
    expect(diversityBonus(0)).toBe(0);

    const one = diversityBonus(1);
    const three = diversityBonus(3);

    expect(three).toBeGreaterThan(one);
    expect(three).toBeLessThan(one * 3);
  });

  it('rejects negative or non-integer input', () => {
    expect(() => diversityBonus(-1)).toThrow();
    expect(() => diversityBonus(1.5)).toThrow();
  });
});

describe('saturate — final bounded transform', () => {
  it('is exactly 0 at zero evidence', () => {
    expect(saturate(0)).toBe(0);
  });

  it('is strictly increasing and never reaches or exceeds 1', () => {
    const low = saturate(0.5);
    const high = saturate(5);

    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThan(1);
    // Mathematically 1 - exp(-x) < 1 for every finite x, but at very large x, exp(-x)
    // underflows to exactly 0 in float64 and 1 - 0 rounds to exactly 1 — expected numerical
    // behavior, not a design flaw, since realistic compositeEvidence values in this kernel stay
    // well under 10. saturate(10) is still comfortably representable below 1.
    expect(saturate(10)).toBeLessThan(1);
  });

  it('rejects negative or non-finite input', () => {
    expect(() => saturate(-0.01)).toThrow();
    expect(() => saturate(NaN)).toThrow();
  });
});

describe('roundToAffinityPrecision', () => {
  it('rounds to exactly 6 decimal places', () => {
    expect(roundToAffinityPrecision(0.123456789)).toBe(0.123457);
    expect(roundToAffinityPrecision(1)).toBe(1);
    expect(roundToAffinityPrecision(0)).toBe(0);
  });
});
