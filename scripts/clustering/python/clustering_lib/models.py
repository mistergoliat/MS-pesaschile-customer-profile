"""K-Means (primary), GMM (secondary), HDBSCAN (diagnostic-only) runners and metrics."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from sklearn.cluster import HDBSCAN, KMeans
from sklearn.metrics import calinski_harabasz_score, davies_bouldin_score, silhouette_score
from sklearn.mixture import GaussianMixture

DEFAULT_SEEDS = [42, 101, 202, 303, 404, 505, 606, 707, 808, 909]
ELBOW_K_RANGE = list(range(2, 11))  # 2..10, full elbow curve
DECISION_K_RANGE = list(range(4, 9))  # 4..8, primary decision range per readiness audit Step 9


@dataclass(frozen=True)
class ClusterSizeSummary:
    sizes: dict[int, int]
    population: int

    def smallest_cluster_pct(self) -> float:
        if not self.sizes:
            return 0.0
        return 100.0 * min(self.sizes.values()) / self.population

    def to_json(self) -> dict:
        return {
            "sizes": {str(k): v for k, v in self.sizes.items()},
            "populationPct": {str(k): round(100.0 * v / self.population, 4) for k, v in self.sizes.items()},
        }


def cluster_size_summary(labels: np.ndarray) -> ClusterSizeSummary:
    unique, counts = np.unique(labels, return_counts=True)
    return ClusterSizeSummary(sizes={int(u): int(c) for u, c in zip(unique, counts)}, population=len(labels))


@dataclass(frozen=True)
class ClusterQualityMetrics:
    silhouette: float
    davies_bouldin: float
    calinski_harabasz: float

    def to_json(self) -> dict:
        return {
            "silhouette": self.silhouette,
            "daviesBouldin": self.davies_bouldin,
            "calinskiHarabasz": self.calinski_harabasz,
        }


def compute_quality_metrics(matrix: np.ndarray, labels: np.ndarray) -> ClusterQualityMetrics | None:
    unique_labels = np.unique(labels[labels >= 0]) if (labels < 0).any() else np.unique(labels)
    if len(unique_labels) < 2:
        return None
    mask = labels >= 0
    x = matrix[mask]
    y = labels[mask]
    return ClusterQualityMetrics(
        silhouette=float(silhouette_score(x, y)),
        davies_bouldin=float(davies_bouldin_score(x, y)),
        calinski_harabasz=float(calinski_harabasz_score(x, y)),
    )


@dataclass(frozen=True)
class KMeansSeedRun:
    k: int
    seed: int
    inertia: float
    labels: np.ndarray
    quality: ClusterQualityMetrics | None
    sizes: ClusterSizeSummary
    centroids: np.ndarray


def run_kmeans(matrix: np.ndarray, k: int, seed: int) -> KMeansSeedRun:
    model = KMeans(n_clusters=k, random_state=seed, n_init=10)
    labels = model.fit_predict(matrix)
    return KMeansSeedRun(
        centroids=model.cluster_centers_,
        k=k,
        seed=seed,
        inertia=float(model.inertia_),
        labels=labels,
        quality=compute_quality_metrics(matrix, labels),
        sizes=cluster_size_summary(labels),
    )


def run_kmeans_sweep(matrix: np.ndarray, k_range: list[int] = None, seeds: list[int] = None) -> list[KMeansSeedRun]:
    k_range = k_range or ELBOW_K_RANGE
    seeds = seeds or DEFAULT_SEEDS
    return [run_kmeans(matrix, k, seed) for k in k_range for seed in seeds]


@dataclass(frozen=True)
class GmmRun:
    k: int
    seed: int
    bic: float
    aic: float
    labels: np.ndarray
    membership_probabilities: np.ndarray
    quality: ClusterQualityMetrics | None
    sizes: ClusterSizeSummary


def run_gmm(matrix: np.ndarray, k: int, seed: int) -> GmmRun:
    model = GaussianMixture(n_components=k, random_state=seed, covariance_type="full", reg_covar=1e-5, n_init=3)
    model.fit(matrix)
    labels = model.predict(matrix)
    probabilities = model.predict_proba(matrix)
    return GmmRun(
        k=k,
        seed=seed,
        bic=float(model.bic(matrix)),
        aic=float(model.aic(matrix)),
        labels=labels,
        membership_probabilities=probabilities,
        quality=compute_quality_metrics(matrix, labels),
        sizes=cluster_size_summary(labels),
    )


@dataclass(frozen=True)
class HdbscanDiagnostic:
    min_cluster_size: int
    n_clusters_found: int
    noise_count: int
    noise_pct: float
    sizes: ClusterSizeSummary
    quality: ClusterQualityMetrics | None
    labels: np.ndarray = field(repr=False)


def run_hdbscan_diagnostic(matrix: np.ndarray, min_cluster_size: int) -> HdbscanDiagnostic:
    model = HDBSCAN(min_cluster_size=min_cluster_size)
    labels = model.fit_predict(matrix)
    noise_count = int(np.sum(labels == -1))
    n_clusters = len(set(labels.tolist())) - (1 if -1 in labels else 0)
    return HdbscanDiagnostic(
        min_cluster_size=min_cluster_size,
        n_clusters_found=n_clusters,
        noise_count=noise_count,
        noise_pct=100.0 * noise_count / len(labels),
        sizes=cluster_size_summary(labels),
        quality=compute_quality_metrics(matrix, labels),
        labels=labels,
    )
