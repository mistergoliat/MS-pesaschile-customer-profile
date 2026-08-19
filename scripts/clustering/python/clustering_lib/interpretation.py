"""Post-hoc interpretation: cluster profiles, RFM cross-tab, and RFM-redundancy measures.

Nothing here ever feeds back into training — rfmCode/segmentCode are read-only context,
joined in strictly after cluster assignment (Section 33/34).
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.metrics import adjusted_mutual_info_score, normalized_mutual_info_score

PROFILE_FIELDS = [
    "totalSpentTaxIncl",
    "averageOrderValueTaxIncl",
    "validOrders",
    "daysSinceLastOrder",
    "customerTenureDays",
    "purchaseFrequencyDays",
    "distinctProducts",
    "repeatProductRate",
    "hhi",
    "top1Share",
    "effectiveDiversity",
    "orders365d",
    "discountShare",
    "shippingShare",
    "cancelledOrderRatio",
]


def cluster_profiles(raw: pd.DataFrame, labels: np.ndarray) -> dict:
    df = raw.copy()
    df["cluster"] = labels
    population = len(df)
    profiles: dict[str, dict] = {}
    for cluster_id, group in df.groupby("cluster"):
        stats: dict[str, dict] = {}
        for field in PROFILE_FIELDS:
            series = group[field]
            stats[field] = {
                "median": float(series.median()),
                "p25": float(series.quantile(0.25)),
                "p75": float(series.quantile(0.75)),
                "mean": float(series.mean()),
            }
        profiles[str(int(cluster_id))] = {
            "population": int(len(group)),
            "populationPct": round(100.0 * len(group) / population, 4),
            "metrics": stats,
        }
    return profiles


def rfm_crosstab(customer_ids: pd.Index, labels: np.ndarray, rfm_segments: pd.DataFrame | None) -> dict:
    labels_df = pd.DataFrame({"cluster": labels}, index=customer_ids)
    if rfm_segments is None or rfm_segments.empty:
        return {"available": False, "reason": "no_published_rfm_snapshot", "counts": {}, "rowPercentages": {}}

    joined = labels_df.join(rfm_segments[["segmentCode"]], how="left")
    joined["segmentCode"] = joined["segmentCode"].fillna("NO_CURRENT_RFM_SEGMENT")

    counts = pd.crosstab(joined["cluster"], joined["segmentCode"])
    row_pct = counts.div(counts.sum(axis=1), axis=0) * 100.0

    return {
        "available": True,
        "matchedCustomers": int((joined["segmentCode"] != "NO_CURRENT_RFM_SEGMENT").sum()),
        "totalCustomers": int(len(joined)),
        "counts": {str(idx): row.to_dict() for idx, row in counts.iterrows()},
        "rowPercentages": {str(idx): row.round(4).to_dict() for idx, row in row_pct.iterrows()},
    }


def rfm_association(labels: np.ndarray, rfm_segments: pd.DataFrame | None, customer_ids: pd.Index) -> dict:
    """NMI/AMI between cluster assignment and RFM segment, computed over the FULL clustering
    population — customers with no published RFM row get an explicit 'NO_CURRENT_RFM_SEGMENT'
    category rather than being dropped, since that's itself informative (Section 34: interpret
    with caution, no arbitrary independence threshold invented)."""
    if rfm_segments is None or rfm_segments.empty:
        return {"available": False}

    labels_df = pd.DataFrame({"cluster": labels}, index=customer_ids)
    joined = labels_df.join(rfm_segments[["segmentCode"]], how="left")
    joined["segmentCode"] = joined["segmentCode"].fillna("NO_CURRENT_RFM_SEGMENT")

    nmi = float(normalized_mutual_info_score(joined["cluster"], joined["segmentCode"]))
    ami = float(adjusted_mutual_info_score(joined["cluster"], joined["segmentCode"]))
    return {"available": True, "normalizedMutualInformation": nmi, "adjustedMutualInformation": ami}
