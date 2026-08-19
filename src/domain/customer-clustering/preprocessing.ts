import type { FeatureTransform } from './contracts.js';
import type { ClusterFeatureName } from './model-version.js';

// Pure reimplementation of scripts/clustering/python/clustering_lib/preprocessing.py's
// per-feature transforms, driven entirely by the persisted model artifact's `transforms`
// parameters (center/scale/cap) — never recomputed from a live population at serving time
// (task Section 16: "los p99 usados durante training deben quedar persistidos... No
// recalcularlos arbitrariamente durante serving de un modelo ya entrenado"). This is what
// lets TypeScript reproduce assignment without invoking Python (task Section 28).
export function applyFeatureTransform(rawValue: number, transform: FeatureTransform): number {
  switch (transform.kind) {
    case 'log1p_robust_scale':
      return (Math.log1p(rawValue) - transform.center) / transform.scale;
    case 'robust_scale':
      return (rawValue - transform.center) / transform.scale;
    case 'clip01':
      return clamp(rawValue, 0, 1);
    case 'winsorize_p99':
      return clamp(rawValue, 0, transform.cap);
  }
}

export function transformFeatureVector(
  rawFeatures: Readonly<Record<ClusterFeatureName, number>>,
  featureOrder: readonly ClusterFeatureName[],
  transforms: Readonly<Record<ClusterFeatureName, FeatureTransform>>,
): number[] {
  return featureOrder.map((feature) => {
    const rawValue = rawFeatures[feature];
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
      throw new Error(`Invalid raw feature value for ${feature}: ${String(rawValue)}`);
    }
    const transform = transforms[feature];
    if (!transform) {
      throw new Error(`Missing transform for feature ${feature}`);
    }
    const transformed = applyFeatureTransform(rawValue, transform);
    if (!Number.isFinite(transformed)) {
      throw new Error(`Transform for ${feature} produced a non-finite value`);
    }
    return transformed;
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
