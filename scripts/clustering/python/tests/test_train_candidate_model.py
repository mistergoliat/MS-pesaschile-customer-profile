import numpy as np
import pandas as pd
import pytest

import train_candidate_model as train
from clustering_lib import models
from clustering_lib.preprocessing import build_matrix


def test_build_transforms_covers_every_feature_with_the_right_kind():
    raw = pd.DataFrame(
        {
            "validOrders": [2, 3],
            "totalSpentTaxIncl": [100000.0, 200000.0],
            "averageOrderValueTaxIncl": [50000.0, 66666.0],
            "customerTenureDays": [500, 800],
            "daysSinceLastOrder": [100, 200],
            "purchaseFrequencyDays": [50.0, 80.0],
            "daysBetweenFirstLastOrder": [50.0, 160.0],
            "orders365d": [1, 0],
            "totalOrdersAllStates": [2, 3],
            "cancelledOrders": [0, 0],
            "cancelledOrderRatio": [0.0, 0.0],
            "totalDiscountsTaxIncl": [0.0, 0.0],
            "totalShippingTaxIncl": [5000.0, 6000.0],
            "discountShare": [0.0, 0.01],
            "shippingShare": [0.05, 0.03],
            "distinctProducts": [3, 5],
            "repeatProductRate": [0.0, 0.2],
            "top1Share": [0.5, 0.4],
            "top3Share": [0.9, 0.8],
            "hhi": [0.3, 0.25],
            "effectiveDiversity": [3.0, 4.0],
            "averageUnitsPerOrder": [1.5, 2.0],
        }
    )
    _, report = build_matrix(raw, "A")
    transforms = train.build_transforms(report)

    assert set(transforms.keys()) == set(report.feature_columns)
    assert transforms["distinctProducts"]["kind"] == "log1p_robust_scale"
    assert transforms["customerTenureDays"]["kind"] == "robust_scale"
    assert transforms["top1Share"] == {"kind": "clip01"}
    assert transforms["discountShare"]["kind"] == "winsorize_p99"
    assert "cap" in transforms["discountShare"]


def test_match_clusters_to_reference_recovers_an_exact_replica_of_t01():
    # Build candidate profiles that are IDENTICAL to the T01 reference profiles (same fields,
    # same values) under different (shuffled) cluster ids — the Hungarian match should recover
    # the exact original label for each, with ~zero distance.
    labels = list(train.T01_REFERENCE_PROFILES.keys())
    shuffled_ids = [2, 0, 3, 1]
    candidate_profiles = {}
    for cluster_id, label in zip(shuffled_ids, labels):
        metrics = {field: {"median": value} for field, value in train.T01_REFERENCE_PROFILES[label].items()}
        candidate_profiles[str(cluster_id)] = {"metrics": metrics}

    mapping = train.match_clusters_to_reference(candidate_profiles)

    assert len(mapping) == 4
    by_cluster = {entry["clusterId"]: entry for entry in mapping}
    for cluster_id, label in zip(shuffled_ids, labels):
        assert by_cluster[cluster_id]["label"] == label
        assert by_cluster[cluster_id]["matchDistance"] == pytest.approx(0.0, abs=1e-9)


def test_match_clusters_to_reference_produces_a_bijective_mapping():
    labels = list(train.T01_REFERENCE_PROFILES.keys())
    candidate_profiles = {}
    for cluster_id, label in enumerate(labels):
        metrics = {field: {"median": value * 1.1} for field, value in train.T01_REFERENCE_PROFILES[label].items()}
        candidate_profiles[str(cluster_id)] = {"metrics": metrics}

    mapping = train.match_clusters_to_reference(candidate_profiles)
    matched_labels = [entry["label"] for entry in mapping]
    assert sorted(matched_labels) == sorted(labels)  # every reference label used exactly once


def test_kmeans_seed_run_exposes_centroids_with_the_right_shape():
    rng = np.random.default_rng(1)
    matrix = np.vstack([rng.normal(loc=[0, 0], scale=0.2, size=(30, 2)), rng.normal(loc=[5, 5], scale=0.2, size=(30, 2))])
    run = models.run_kmeans(matrix, k=2, seed=42)
    assert run.centroids.shape == (2, 2)
