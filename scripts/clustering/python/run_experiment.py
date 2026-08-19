"""CP-R2-T01 — Behavioral Clustering V1: Python fitting/analysis orchestrator.

Reads ONLY the local files scripts/clustering/feature-extraction.ts already produced
(features-raw.csv, dataset-manifest.json, rfm-segments.csv). Never touches PrestaShop, MariaDB,
or any DB credential — the Python boundary (task Section 20) is enforced structurally by this
script simply never importing a DB client.

Usage:
    .venv/Scripts/python.exe run_experiment.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from clustering_lib import interpretation, models, plotting, preprocessing, stability
from clustering_lib.io_utils import load_feature_dataset, load_rfm_segments

OUTPUT_DIR = Path(__file__).parent.parent / "outputs"
PLOTS_DIR = OUTPUT_DIR / "plots"
GMM_SEEDS = [42, 101, 202, 303, 404]
RESAMPLE_COUNT = 10
RESAMPLE_FRACTION = 0.8
SMALL_CLUSTER_PCT_FLOOR = 3.0
SEED_ARI_STABILITY_FLOOR = 0.5


def run_feature_set(name: str, raw, rfm_segments, timings: dict) -> dict:
    print(f"[experiment] === Feature Set {name} ===")
    t0 = time.time()
    matrix, preprocessing_report = preprocessing.build_matrix(raw, name)
    timings[f"preprocessing_{name}_ms"] = round((time.time() - t0) * 1000, 1)
    print(f"[experiment] matrix shape: {matrix.shape}, columns: {preprocessing_report.feature_columns}")

    # --- K-Means sweep: elbow (k=2..10) + decision metrics (k=4..8), 10 seeds each ---
    t0 = time.time()
    sweep = models.run_kmeans_sweep(matrix, models.ELBOW_K_RANGE, models.DEFAULT_SEEDS)
    timings[f"kmeans_sweep_{name}_ms"] = round((time.time() - t0) * 1000, 1)

    by_k: dict[int, list] = {}
    for run in sweep:
        by_k.setdefault(run.k, []).append(run)

    elbow_curve = {k: float(np.mean([r.inertia for r in runs])) for k, runs in sorted(by_k.items())}

    decision_table = {}
    for k in models.DECISION_K_RANGE:
        runs = by_k[k]
        qualities = [r.quality for r in runs if r.quality is not None]
        seed_ari = stability.seed_ari_stats([r.labels for r in runs])
        mean_silhouette = float(np.mean([q.silhouette for q in qualities])) if qualities else None
        mean_db = float(np.mean([q.davies_bouldin for q in qualities])) if qualities else None
        mean_ch = float(np.mean([q.calinski_harabasz for q in qualities])) if qualities else None
        # Representative run for this k: the seed whose labels are most typical (highest mean
        # ARI against every other seed at this k) — avoids picking an arbitrary/outlier seed's
        # cluster-size profile to report.
        representative = _most_representative_run(runs)
        decision_table[k] = {
            "meanInertia": elbow_curve[k],
            "meanSilhouette": mean_silhouette,
            "meanDaviesBouldin": mean_db,
            "meanCalinskiHarabasz": mean_ch,
            "seedAri": seed_ari.to_json(),
            "representativeSeed": representative.seed,
            "clusterSizes": representative.sizes.to_json(),
            "smallestClusterPct": representative.sizes.smallest_cluster_pct(),
        }

    chosen_k, chosen_reason = _select_k(decision_table)
    chosen_runs = by_k[chosen_k]
    baseline_run = _most_representative_run(chosen_runs)
    print(f"[experiment] Set {name}: chosen k={chosen_k} ({chosen_reason}), representative seed={baseline_run.seed}")

    # --- Resampling stability (subsampling WITHOUT replacement, not bootstrap) ---
    t0 = time.time()
    resample_stats, resample_detail = stability.resampling_ari_stats(
        matrix,
        baseline_run.labels,
        models.run_kmeans,
        chosen_k,
        base_seed=baseline_run.seed,
        n_resamples=RESAMPLE_COUNT,
        frac=RESAMPLE_FRACTION,
    )
    timings[f"resampling_{name}_ms"] = round((time.time() - t0) * 1000, 1)

    # --- GMM secondary candidate, same decision k range, fewer seeds ---
    t0 = time.time()
    gmm_by_k = {}
    for k in models.DECISION_K_RANGE:
        gmm_runs = [models.run_gmm(matrix, k, seed) for seed in GMM_SEEDS]
        qualities = [r.quality for r in gmm_runs if r.quality is not None]
        gmm_by_k[k] = {
            "meanBic": float(np.mean([r.bic for r in gmm_runs])),
            "meanAic": float(np.mean([r.aic for r in gmm_runs])),
            "meanSilhouette": float(np.mean([q.silhouette for q in qualities])) if qualities else None,
            "seedAri": stability.seed_ari_stats([r.labels for r in gmm_runs]).to_json(),
            "clusterSizes": gmm_runs[0].sizes.to_json(),
            "meanMembershipConfidence": float(np.mean([np.max(r.membership_probabilities, axis=1).mean() for r in gmm_runs])),
        }
    timings[f"gmm_{name}_ms"] = round((time.time() - t0) * 1000, 1)
    gmm_best_k = min(gmm_by_k, key=lambda k: gmm_by_k[k]["meanBic"])

    # --- HDBSCAN, diagnostic only ---
    t0 = time.time()
    min_cluster_size = max(30, int(0.03 * matrix.shape[0]))
    hdbscan_result = models.run_hdbscan_diagnostic(matrix, min_cluster_size)
    timings[f"hdbscan_{name}_ms"] = round((time.time() - t0) * 1000, 1)

    # --- Interpretation: cluster profiles + RFM cross-tab + association, for the chosen candidate ---
    profiles = interpretation.cluster_profiles(raw, baseline_run.labels)
    crosstab = interpretation.rfm_crosstab(raw.index, baseline_run.labels, rfm_segments)
    association = interpretation.rfm_association(baseline_run.labels, rfm_segments, raw.index)

    # --- Plots ---
    PLOTS_DIR.mkdir(parents=True, exist_ok=True)
    plotting.plot_elbow(list(elbow_curve.keys()), list(elbow_curve.values()), PLOTS_DIR / f"elbow-set-{name.lower()}.png", f"K-Means elbow — Set {name}")
    sil_k = [k for k in decision_table if decision_table[k]["meanSilhouette"] is not None]
    plotting.plot_silhouette_vs_k(
        sil_k,
        [decision_table[k]["meanSilhouette"] for k in sil_k],
        PLOTS_DIR / f"silhouette-vs-k-set-{name.lower()}.png",
        f"Silhouette vs k — Set {name}",
    )
    plotting.plot_pca_scatter(matrix, baseline_run.labels, PLOTS_DIR / f"pca-set-{name.lower()}.png", f"PCA (2D) — Set {name}, k={chosen_k}")

    # --- Assignments CSV ---
    assignments_path = OUTPUT_DIR / f"assignments-set-{name.lower()}.csv"
    import pandas as pd

    pd.DataFrame({"customerId": raw.index, "cluster": baseline_run.labels}).to_csv(assignments_path, index=False)

    small_clusters = [
        cid for cid, size in baseline_run.sizes.sizes.items() if 100.0 * size / baseline_run.sizes.population < SMALL_CLUSTER_PCT_FLOOR
    ]

    return {
        "featureSet": name,
        "featureColumns": preprocessing_report.feature_columns,
        "preprocessing": preprocessing_report.to_json(),
        "elbowCurve": elbow_curve,
        "decisionTable": {str(k): v for k, v in decision_table.items()},
        "chosenK": chosen_k,
        "chosenKReason": chosen_reason,
        "representativeSeed": baseline_run.seed,
        "resampleAri": resample_stats.to_json(),
        "resampleDetail": resample_detail,
        "gmm": {str(k): v for k, v in gmm_by_k.items()},
        "gmmBestKByBic": gmm_best_k,
        "hdbscan": {
            "minClusterSize": hdbscan_result.min_cluster_size,
            "clustersFound": hdbscan_result.n_clusters_found,
            "noiseCount": hdbscan_result.noise_count,
            "noisePct": hdbscan_result.noise_pct,
            "sizes": hdbscan_result.sizes.to_json(),
            "quality": hdbscan_result.quality.to_json() if hdbscan_result.quality else None,
        },
        "clusterProfiles": profiles,
        "rfmCrosstab": crosstab,
        "rfmAssociation": association,
        "smallClusters": small_clusters,
        "assignmentsFile": str(assignments_path.name),
    }


def _most_representative_run(runs: list):
    from sklearn.metrics import adjusted_rand_score

    if len(runs) == 1:
        return runs[0]
    scores = []
    for i, run in enumerate(runs):
        others = [runs[j].labels for j in range(len(runs)) if j != i]
        mean_ari = float(np.mean([adjusted_rand_score(run.labels, other) for other in others]))
        scores.append(mean_ari)
    return runs[int(np.argmax(scores))]


def _select_k(decision_table: dict) -> tuple[int, str]:
    """Documented, inspectable heuristic (Section 29: never pick k on silhouette alone).

    Candidate pool = k in [4,8] with seedAri.mean >= stability floor (0.5) AND at most one
    cluster below the 3% small-cluster flag. Within that pool, pick the highest silhouette,
    tie-broken by lower Davies-Bouldin. If the pool is empty, relax the stability floor and
    fall back to the best silhouette overall, flagged as such — this is a first-pass automatic
    recommendation; the experiment report reviews it against the full metrics table by hand
    rather than trusting it blindly.
    """
    candidates = []
    for k, row in decision_table.items():
        stable = row["seedAri"]["mean"] >= SEED_ARI_STABILITY_FLOOR
        balanced = sum(1 for pct in row["clusterSizes"]["populationPct"].values() if pct < SMALL_CLUSTER_PCT_FLOOR) <= 1
        if stable and balanced and row["meanSilhouette"] is not None:
            candidates.append(k)

    if candidates:
        best = max(candidates, key=lambda k: (decision_table[k]["meanSilhouette"], -decision_table[k]["meanDaviesBouldin"]))
        return best, f"best silhouette among stable(seedARI>={SEED_ARI_STABILITY_FLOOR}) & balanced(<=1 small cluster) candidates"

    fallback = max(
        (k for k in decision_table if decision_table[k]["meanSilhouette"] is not None),
        key=lambda k: decision_table[k]["meanSilhouette"],
    )
    return fallback, "FALLBACK: no k met the stability/balance filter — picked best silhouette overall, needs manual review"


def main() -> None:
    started_at = time.time()
    features_csv = OUTPUT_DIR / "features-raw.csv"
    manifest_json = OUTPUT_DIR / "dataset-manifest.json"
    rfm_segments_csv = OUTPUT_DIR / "rfm-segments.csv"

    dataset = load_feature_dataset(features_csv, manifest_json)
    rfm_segments = load_rfm_segments(rfm_segments_csv)
    print(f"[experiment] loaded {len(dataset.raw)} customers, manifest checksum={dataset.manifest['datasetChecksum']}")
    if rfm_segments is not None:
        print(f"[experiment] RFM segments available for {len(rfm_segments)} customers")
    else:
        print("[experiment] no RFM segments file found — cross-tab will be unavailable")

    timings: dict = {}
    results = {}
    for name in ("A", "B"):
        results[name] = run_feature_set(name, dataset.raw, rfm_segments, timings)

    comparison = _build_comparison_table(results)

    experiment_result = {
        "experimentVersion": "cp-r2-t01-v1",
        "manifest": dataset.manifest,
        "seeds": models.DEFAULT_SEEDS,
        "gmmSeeds": GMM_SEEDS,
        "resampleCount": RESAMPLE_COUNT,
        "resampleFraction": RESAMPLE_FRACTION,
        "elbowKRange": models.ELBOW_K_RANGE,
        "decisionKRange": models.DECISION_K_RANGE,
        "results": results,
        "setAvsSetB": comparison,
        "timingsMs": timings,
        "totalDurationMs": round((time.time() - started_at) * 1000, 1),
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_DIR / "kmeans-metrics.json", "w", encoding="utf8") as f:
        json.dump(
            {name: {"decisionTable": r["decisionTable"], "elbowCurve": r["elbowCurve"], "chosenK": r["chosenK"], "chosenKReason": r["chosenKReason"]} for name, r in results.items()},
            f,
            indent=2,
        )
    with open(OUTPUT_DIR / "gmm-metrics.json", "w", encoding="utf8") as f:
        json.dump({name: r["gmm"] for name, r in results.items()}, f, indent=2)
    with open(OUTPUT_DIR / "cluster-profiles.json", "w", encoding="utf8") as f:
        json.dump({name: r["clusterProfiles"] for name, r in results.items()}, f, indent=2)
    with open(OUTPUT_DIR / "rfm-cross-tab.json", "w", encoding="utf8") as f:
        json.dump({name: r["rfmCrosstab"] for name, r in results.items()}, f, indent=2)
    with open(OUTPUT_DIR / "experiment-results.json", "w", encoding="utf8") as f:
        json.dump(experiment_result, f, indent=2)

    print(f"[experiment] DONE in {experiment_result['totalDurationMs']}ms — see {OUTPUT_DIR}/experiment-results.json")
    print(json.dumps(comparison, indent=2))


def _build_comparison_table(results: dict) -> dict:
    table = {}
    for name, r in results.items():
        row = r["decisionTable"][str(r["chosenK"])]
        table[name] = {
            "chosenK": r["chosenK"],
            "silhouette": row["meanSilhouette"],
            "daviesBouldin": row["meanDaviesBouldin"],
            "calinskiHarabasz": row["meanCalinskiHarabasz"],
            "seedAriMean": row["seedAri"]["mean"],
            "seedAriMin": row["seedAri"]["min"],
            "resampleAriMean": r["resampleAri"]["mean"],
            "resampleAriMin": r["resampleAri"]["min"],
            "smallestClusterPct": row["smallestClusterPct"],
            "rfmAssociationNmi": r["rfmAssociation"].get("normalizedMutualInformation") if r["rfmAssociation"].get("available") else None,
            "rfmAssociationAmi": r["rfmAssociation"].get("adjustedMutualInformation") if r["rfmAssociation"].get("available") else None,
        }
    return table


if __name__ == "__main__":
    main()
