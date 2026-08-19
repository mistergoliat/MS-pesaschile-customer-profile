import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from clustering_lib import models, stability
from clustering_lib.io_utils import MalformedFeatureMatrixError, assert_no_nan_or_inf, load_feature_dataset


def test_same_seed_produces_identical_kmeans_assignments():
    rng = np.random.default_rng(1)
    matrix = np.vstack([rng.normal(loc=[0, 0], scale=0.3, size=(50, 2)), rng.normal(loc=[5, 5], scale=0.3, size=(50, 2))])
    run_a = models.run_kmeans(matrix, k=2, seed=7)
    run_b = models.run_kmeans(matrix, k=2, seed=7)
    np.testing.assert_array_equal(run_a.labels, run_b.labels)
    assert run_a.inertia == run_b.inertia


def test_quality_metrics_prefer_well_separated_clusters_over_a_single_random_split():
    rng = np.random.default_rng(2)
    separated = np.vstack([rng.normal(loc=[0, 0], scale=0.2, size=(60, 2)), rng.normal(loc=[8, 8], scale=0.2, size=(60, 2))])
    labels_good = np.array([0] * 60 + [1] * 60)
    labels_random = rng.integers(0, 2, size=120)

    good = models.compute_quality_metrics(separated, labels_good)
    random_split = models.compute_quality_metrics(separated, labels_random)
    assert good is not None and random_split is not None
    assert good.silhouette > random_split.silhouette


def test_seed_ari_is_perfect_for_identical_label_arrays():
    labels = np.array([0, 0, 1, 1, 2, 2])
    stats = stability.seed_ari_stats([labels, labels.copy(), labels.copy()])
    assert stats.mean == pytest.approx(1.0)
    assert stats.min == pytest.approx(1.0)


def test_resampling_ari_stats_returns_one_score_per_resample():
    rng = np.random.default_rng(3)
    matrix = np.vstack([rng.normal(loc=[0, 0], scale=0.3, size=(50, 2)), rng.normal(loc=[6, 6], scale=0.3, size=(50, 2))])
    baseline = models.run_kmeans(matrix, k=2, seed=42)
    stats, detail = stability.resampling_ari_stats(matrix, baseline.labels, models.run_kmeans, k=2, base_seed=42, n_resamples=5, frac=0.8)
    assert stats.n_comparisons == 5
    assert len(detail) == 5
    assert all(0.0 <= d["ari"] <= 1.0 or d["ari"] < 0 for d in detail)  # ARI can be slightly negative, never > 1


def test_assert_no_nan_or_inf_rejects_nan():
    df = pd.DataFrame({"a": [1.0, float("nan")], "b": [1.0, 2.0]})
    with pytest.raises(MalformedFeatureMatrixError):
        assert_no_nan_or_inf(df, ["a", "b"])


def test_assert_no_nan_or_inf_rejects_infinite():
    df = pd.DataFrame({"a": [1.0, float("inf")], "b": [1.0, 2.0]})
    with pytest.raises(MalformedFeatureMatrixError):
        assert_no_nan_or_inf(df, ["a", "b"])


def test_assert_no_nan_or_inf_passes_clean_data():
    df = pd.DataFrame({"a": [1.0, 2.0], "b": [1.0, 2.0]})
    assert_no_nan_or_inf(df, ["a", "b"])  # should not raise


def _write_minimal_dataset(tmp_path: Path, populationSize=2, corrupt=None):
    from clustering_lib.io_utils import RAW_FEATURE_COLUMNS

    row = {col: 1.0 for col in RAW_FEATURE_COLUMNS}
    rows = [{"customerId": i + 1, **row} for i in range(populationSize)]
    if corrupt == "duplicate_customer_id":
        rows[-1]["customerId"] = rows[0]["customerId"]
    df = pd.DataFrame(rows)
    if corrupt == "missing_column":
        df = df.drop(columns=["hhi"])
    features_csv = tmp_path / "features-raw.csv"
    df.to_csv(features_csv, index=False)

    manifest = {"populationSize": populationSize, "datasetChecksum": "deadbeef"}
    manifest_json = tmp_path / "dataset-manifest.json"
    manifest_json.write_text(json.dumps(manifest), encoding="utf8")
    return features_csv, manifest_json


def test_load_feature_dataset_rejects_missing_columns(tmp_path):
    features_csv, manifest_json = _write_minimal_dataset(tmp_path, corrupt="missing_column")
    with pytest.raises(MalformedFeatureMatrixError):
        load_feature_dataset(features_csv, manifest_json)


def test_load_feature_dataset_rejects_duplicate_customer_ids(tmp_path):
    features_csv, manifest_json = _write_minimal_dataset(tmp_path, populationSize=2, corrupt="duplicate_customer_id")
    with pytest.raises(MalformedFeatureMatrixError):
        load_feature_dataset(features_csv, manifest_json)


def test_load_feature_dataset_accepts_a_well_formed_matrix(tmp_path):
    features_csv, manifest_json = _write_minimal_dataset(tmp_path, populationSize=3)
    dataset = load_feature_dataset(features_csv, manifest_json)
    assert len(dataset.raw) == 3
    assert dataset.manifest["datasetChecksum"] == "deadbeef"
