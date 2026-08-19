"""Seed stability (ARI across fixed seeds) and resampling stability (ARI on 80% subsamples,
WITHOUT replacement — deliberately called "resampling"/"subsampling", never "bootstrap", per
the task's explicit correction: true bootstrap is sampling WITH replacement, which this is not).
"""
from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations

import numpy as np
from sklearn.metrics import adjusted_rand_score


@dataclass(frozen=True)
class AriStats:
    mean: float
    median: float
    min: float
    max: float
    n_comparisons: int

    def to_json(self) -> dict:
        return {
            "mean": self.mean,
            "median": self.median,
            "min": self.min,
            "max": self.max,
            "nComparisons": self.n_comparisons,
        }


def _summarize(values: list[float]) -> AriStats:
    if not values:
        return AriStats(mean=0.0, median=0.0, min=0.0, max=0.0, n_comparisons=0)
    arr = np.array(values, dtype=float)
    return AriStats(
        mean=float(arr.mean()),
        median=float(np.median(arr)),
        min=float(arr.min()),
        max=float(arr.max()),
        n_comparisons=len(values),
    )


def seed_ari_stats(labels_by_seed: list[np.ndarray]) -> AriStats:
    pairs = [adjusted_rand_score(a, b) for a, b in combinations(labels_by_seed, 2)]
    return _summarize(pairs)


def resampling_ari_stats(
    matrix: np.ndarray,
    baseline_labels: np.ndarray,
    fit_fn,
    k: int,
    base_seed: int,
    n_resamples: int = 10,
    frac: float = 0.8,
) -> tuple[AriStats, list[dict]]:
    """fit_fn(matrix_subset, k, seed) -> object with a `.labels` attribute.

    Each resample draws `frac` of the population WITHOUT replacement, refits the model on just
    that subsample, and compares the subsample's own fresh labels against the baseline model's
    labels restricted to the same customers — ARI computed over the matching overlapping
    population, per Section 26.
    """
    n = matrix.shape[0]
    sample_size = int(round(n * frac))
    aris: list[float] = []
    detail: list[dict] = []
    for i in range(n_resamples):
        resample_seed = base_seed * 1000 + i
        rng = np.random.default_rng(resample_seed)
        idx = rng.choice(n, size=sample_size, replace=False)
        sub_matrix = matrix[idx]
        sub_result = fit_fn(sub_matrix, k, resample_seed)
        ari = float(adjusted_rand_score(baseline_labels[idx], sub_result.labels))
        aris.append(ari)
        detail.append({"resampleIndex": i, "seed": resample_seed, "sampleSize": sample_size, "ari": ari})
    return _summarize(aris), detail
