"""Diagnostic-only plots (Section 36: PCA is visual/diagnostic, never a clustering input)."""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from sklearn.decomposition import PCA


def plot_elbow(k_values: list[int], mean_inertia_by_k: list[float], output_path: Path, title: str) -> None:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.plot(k_values, mean_inertia_by_k, marker="o")
    ax.set_xlabel("k")
    ax.set_ylabel("Inertia (mean across seeds)")
    ax.set_title(title)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(output_path, dpi=120)
    plt.close(fig)


def plot_silhouette_vs_k(k_values: list[int], mean_silhouette_by_k: list[float], output_path: Path, title: str) -> None:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.plot(k_values, mean_silhouette_by_k, marker="o", color="darkorange")
    ax.set_xlabel("k")
    ax.set_ylabel("Silhouette score (mean across seeds)")
    ax.set_title(title)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(output_path, dpi=120)
    plt.close(fig)


def plot_pca_scatter(matrix: np.ndarray, labels: np.ndarray, output_path: Path, title: str) -> None:
    pca = PCA(n_components=2, random_state=42)
    projected = pca.fit_transform(matrix)
    fig, ax = plt.subplots(figsize=(6, 5))
    scatter = ax.scatter(projected[:, 0], projected[:, 1], c=labels, cmap="tab10", s=6, alpha=0.6)
    ax.set_xlabel(f"PC1 ({pca.explained_variance_ratio_[0] * 100:.1f}% var)")
    ax.set_ylabel(f"PC2 ({pca.explained_variance_ratio_[1] * 100:.1f}% var)")
    ax.set_title(title)
    legend = ax.legend(*scatter.legend_elements(), title="cluster", loc="best", fontsize=8)
    ax.add_artist(legend)
    fig.tight_layout()
    fig.savefig(output_path, dpi=120)
    plt.close(fig)
