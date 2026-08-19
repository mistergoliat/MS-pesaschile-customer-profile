"""CP-R2-T02 — trains the APPROVED production candidate (Feature Set A, K-Means, k=4) and
writes a portable, auditable JSON artifact for TypeScript to validate and persist.

Boundary (task Section 27): reads ONLY the local files feature-extraction.ts already produced
(features-raw.csv, dataset-manifest.json) — never a DB connection, never a DB credential.
Writes ONLY a local JSON file — never a DB write, never HTTP.

This does not re-investigate the clustering problem (task top instruction: "NO volver a
investigar... NO cambiar algoritmo... NO reabrir selección de k"). It reproduces exactly the
CP-R2-T01 finding: Feature Set A, K-Means, k=4 — using a fixed canonical training seed (42)
instead of T01's per-run "most representative of 10 seeds" reporting technique, which was
never meant to be a stable production choice.
"""
from __future__ import annotations

import json
import sys
import time
from itertools import combinations
from pathlib import Path

import numpy as np
from scipy.optimize import linear_sum_assignment

sys.path.insert(0, str(Path(__file__).parent))

from clustering_lib import interpretation, models, preprocessing, stability
from clustering_lib.io_utils import load_feature_dataset

OUTPUT_DIR = Path(__file__).parent.parent / "outputs"

TRAINING_SEED = 42  # must match src/domain/customer-clustering/model-version.ts's trainingSeed
K = 4  # must match model-version.ts's k
FEATURE_VERSION = "behavioral-clustering-features-v1"
PREPROCESSING_VERSION = "behavioral-clustering-preprocessing-v1"
MODEL_VERSION = "behavioral-kmeans-k4-v1"
POPULATION_POLICY_VERSION = "cp-r2-clustering-population-b-prime-v1"
OPERATIONAL_EXCLUSION_POLICY_VERSION = "operational-account-exclusion-v1"
SHOP_SCOPE = "all_valid_prestashop_shops"
ARTIFACT_VERSION = "clustering-model-artifact-v1"

# CP-R2-T01's real, published Feature-Set-A cluster median profiles
# (docs/experiments/CP-R2-T01-behavioral-clustering-v1-controlled-experiment.md Section 14 /
# scripts/clustering/outputs/cluster-profiles.json from that run). Used only to Hungarian-match
# a freshly trained model's cluster IDs back to their T01 commercial story (task Section 45) —
# never used as training input. Only fields with actual T01 report coverage are included; two
# trained features (top3Share, averageUnitsPerOrder) were not part of T01's profile report and
# are excluded from matching, documented as a known limitation.
T01_REFERENCE_PROFILES = {
    "LONG_TENURE_DORMANT_SPREAD_OUT_REPEAT_BUYERS": {
        "distinctProducts": 4.0,
        "effectiveDiversity": 2.506059,
        "purchaseFrequencyDays": 235.29099537037035,
        "orders365d": 0.0,
        "customerTenureDays": 1302.0,
        "top1Share": 0.5287634999999999,
        "shippingShare": 0.0911278346456167,
    },
    "NEW_BURST_THEN_LAPSED_BUYERS": {
        "distinctProducts": 3.0,
        "effectiveDiversity": 2.123652,
        "purchaseFrequencyDays": 6.491944444444444,
        "orders365d": 0.0,
        "customerTenureDays": 761.0,
        "top1Share": 0.569938,
        "shippingShare": 0.0434026267722014,
    },
    "HIGH_VALUE_DIVERSIFIED_REPEAT_BUYERS": {
        "distinctProducts": 12.0,
        "effectiveDiversity": 6.1809855,
        "purchaseFrequencyDays": 139.63293451003085,
        "orders365d": 0.0,
        "customerTenureDays": 1240.0,
        "top1Share": 0.2690515,
        "shippingShare": 0.0308525101694046,
    },
    "RECENTLY_ACTIVE_NEWER_REPEAT_BUYERS": {
        "distinctProducts": 4.0,
        "effectiveDiversity": 2.580108,
        "purchaseFrequencyDays": 129.6655102237654,
        "orders365d": 2.0,
        "customerTenureDays": 440.0,
        "top1Share": 0.517334,
        "shippingShare": 0.08695007431523175,
    },
}


def build_transforms(report: preprocessing.PreprocessingReport) -> dict:
    transforms: dict = {}
    for feature in preprocessing.LOG1P_SCALE_FEATURES:
        transforms[feature] = {
            "kind": "log1p_robust_scale",
            "center": report.scaler_center[feature],
            "scale": report.scaler_scale[feature],
        }
    for feature in preprocessing.TENURE_SCALE_ONLY_FEATURES:
        transforms[feature] = {
            "kind": "robust_scale",
            "center": report.scaler_center[feature],
            "scale": report.scaler_scale[feature],
        }
    for feature in preprocessing.RATIO_CLIP01_FEATURES:
        transforms[feature] = {"kind": "clip01"}
    for feature in preprocessing.RATIO_WINSORIZE_FEATURES:
        transforms[feature] = {"kind": "winsorize_p99", "cap": report.winsorize_caps[feature]}
    return transforms


def match_clusters_to_reference(candidate_profiles: dict) -> list[dict]:
    """Hungarian-matches the candidate model's own clusters to the 4 T01 reference profiles,
    using min-max normalization derived from the reference clusters' own spread per field
    (fields with zero spread across the 4 references carry no discriminating signal and are
    dropped from the distance computation, not divided by zero)."""
    reference_labels = list(T01_REFERENCE_PROFILES.keys())
    fields = list(next(iter(T01_REFERENCE_PROFILES.values())).keys())

    field_ranges = {}
    for field in fields:
        values = [T01_REFERENCE_PROFILES[label][field] for label in reference_labels]
        span = max(values) - min(values)
        if span > 0:
            field_ranges[field] = (min(values), span)

    candidate_ids = sorted(candidate_profiles.keys(), key=int)
    cost_matrix = np.zeros((len(candidate_ids), len(reference_labels)))
    for i, cluster_id in enumerate(candidate_ids):
        candidate_metrics = candidate_profiles[cluster_id]["metrics"]
        for j, label in enumerate(reference_labels):
            distance = 0.0
            for field, (field_min, field_span) in field_ranges.items():
                candidate_value = candidate_metrics[field]["median"]
                reference_value = T01_REFERENCE_PROFILES[label][field]
                normalized_candidate = (candidate_value - field_min) / field_span
                normalized_reference = (reference_value - field_min) / field_span
                distance += (normalized_candidate - normalized_reference) ** 2
            cost_matrix[i, j] = float(np.sqrt(distance))

    row_indices, col_indices = linear_sum_assignment(cost_matrix)
    mapping = []
    for row, col in zip(row_indices, col_indices):
        cluster_id = int(candidate_ids[row])
        label = reference_labels[col]
        mapping.append(
            {
                "clusterId": cluster_id,
                "label": label,
                "matchedReferenceLabel": label,
                "matchDistance": float(cost_matrix[row, col]),
            }
        )
    return sorted(mapping, key=lambda entry: entry["clusterId"])


def main() -> None:
    started_at = time.time()
    features_csv = OUTPUT_DIR / "features-raw.csv"
    manifest_json = OUTPUT_DIR / "dataset-manifest.json"

    dataset = load_feature_dataset(features_csv, manifest_json)
    print(f"[train] loaded {len(dataset.raw)} customers, manifest checksum={dataset.manifest['datasetChecksum']}")

    matrix, report = preprocessing.build_matrix(dataset.raw, "A")

    baseline = models.run_kmeans(matrix, k=K, seed=TRAINING_SEED)
    quality = models.compute_quality_metrics(matrix, baseline.labels)
    if quality is None:
        raise RuntimeError("Failed to compute quality metrics for the candidate model")

    seed_runs = [models.run_kmeans(matrix, k=K, seed=seed) for seed in models.DEFAULT_SEEDS]
    seed_ari = stability.seed_ari_stats([run.labels for run in seed_runs])

    resample_ari, _resample_detail = stability.resampling_ari_stats(
        matrix, baseline.labels, models.run_kmeans, k=K, base_seed=TRAINING_SEED, n_resamples=10, frac=0.8
    )

    candidate_profiles = interpretation.cluster_profiles(dataset.raw, baseline.labels)
    interpretation_mapping = match_clusters_to_reference(candidate_profiles)

    trained_at = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())

    artifact = {
        "artifactVersion": ARTIFACT_VERSION,
        "modelVersion": MODEL_VERSION,
        "algorithm": "kmeans",
        "k": K,
        "trainingSeed": TRAINING_SEED,
        "featureVersion": FEATURE_VERSION,
        "preprocessingVersion": PREPROCESSING_VERSION,
        "populationPolicyVersion": POPULATION_POLICY_VERSION,
        "operationalAccountExclusionPolicyVersion": OPERATIONAL_EXCLUSION_POLICY_VERSION,
        "shopScope": SHOP_SCOPE,
        "featureOrder": report.feature_columns,
        "transforms": build_transforms(report),
        "centroids": [row.tolist() for row in baseline.centroids],
        "trainingReferenceTime": dataset.manifest["referenceTime"],
        "trainingPopulationSize": len(dataset.raw),
        "trainingDatasetChecksum": dataset.manifest["datasetChecksum"],
        "metrics": {
            "silhouette": quality.silhouette,
            "daviesBouldin": quality.davies_bouldin,
            "calinskiHarabasz": quality.calinski_harabasz,
            "seedAriMean": seed_ari.mean,
            "seedAriMin": seed_ari.min,
            "resampleAriMean": resample_ari.mean,
            "resampleAriMin": resample_ari.min,
        },
        "temporalStabilityStatus": "not_yet_validated",
        "interpretationMapping": interpretation_mapping,
        "trainedAt": trained_at,
        # No artifactChecksum here — computed and owned by TypeScript on validation/registration
        # (see src/domain/customer-clustering/artifact.ts for why this is deliberately NOT
        # computed in Python: JSON number formatting is not guaranteed byte-identical across
        # the two languages, so a Python-computed checksum could never be reliably verified).
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    artifact_path = OUTPUT_DIR / "model-artifact.json"
    with open(artifact_path, "w", encoding="utf8") as f:
        json.dump(artifact, f, indent=2)

    duration_ms = round((time.time() - started_at) * 1000, 1)
    print(f"[train] k={K} seed={TRAINING_SEED} silhouette={quality.silhouette:.4f} daviesBouldin={quality.davies_bouldin:.4f}")
    print(f"[train] seedARI mean={seed_ari.mean:.4f} min={seed_ari.min:.4f}")
    print(f"[train] resampleARI mean={resample_ari.mean:.4f} min={resample_ari.min:.4f}")
    print(f"[train] interpretation mapping: {json.dumps(interpretation_mapping, indent=2)}")
    print(f"[train] DONE in {duration_ms}ms — wrote {artifact_path}")


if __name__ == "__main__":
    main()
