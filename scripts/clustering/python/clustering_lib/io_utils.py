"""Load and validate the TS-produced feature matrix. Python never touches PrestaShop or any
DB — it only reads the local files scripts/clustering/feature-extraction.ts already wrote
(Section 20 boundary)."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

RAW_FEATURE_COLUMNS = [
    "validOrders",
    "totalSpentTaxIncl",
    "averageOrderValueTaxIncl",
    "customerTenureDays",
    "daysSinceLastOrder",
    "purchaseFrequencyDays",
    "daysBetweenFirstLastOrder",
    "orders365d",
    "totalOrdersAllStates",
    "cancelledOrders",
    "cancelledOrderRatio",
    "totalDiscountsTaxIncl",
    "totalShippingTaxIncl",
    "discountShare",
    "shippingShare",
    "distinctProducts",
    "repeatProductRate",
    "top1Share",
    "top3Share",
    "hhi",
    "effectiveDiversity",
    "averageUnitsPerOrder",
]


class MalformedFeatureMatrixError(ValueError):
    """Raised when the feature matrix does not match the schema this pipeline requires."""


@dataclass(frozen=True)
class FeatureDataset:
    raw: pd.DataFrame  # indexed by customerId, RAW_FEATURE_COLUMNS only
    manifest: dict


def load_feature_dataset(features_csv: Path, manifest_json: Path) -> FeatureDataset:
    if not features_csv.exists():
        raise MalformedFeatureMatrixError(f"Feature matrix not found: {features_csv}")
    if not manifest_json.exists():
        raise MalformedFeatureMatrixError(f"Dataset manifest not found: {manifest_json}")

    df = pd.read_csv(features_csv)
    manifest = json.loads(manifest_json.read_text(encoding="utf8"))

    expected_columns = {"customerId", *RAW_FEATURE_COLUMNS}
    actual_columns = set(df.columns)
    if actual_columns != expected_columns:
        missing = expected_columns - actual_columns
        extra = actual_columns - expected_columns
        raise MalformedFeatureMatrixError(
            f"Feature matrix schema mismatch. Missing={sorted(missing)} Extra={sorted(extra)}"
        )

    if df["customerId"].duplicated().any():
        dupes = df.loc[df["customerId"].duplicated(), "customerId"].tolist()
        raise MalformedFeatureMatrixError(f"Duplicate customerId rows in feature matrix: {dupes}")

    if len(df) != manifest["populationSize"]:
        raise MalformedFeatureMatrixError(
            f"Row count {len(df)} does not match manifest.populationSize {manifest['populationSize']}"
        )

    assert_no_nan_or_inf(df, RAW_FEATURE_COLUMNS)

    df = df.set_index("customerId").sort_index()
    return FeatureDataset(raw=df, manifest=manifest)


def assert_no_nan_or_inf(df: pd.DataFrame, columns: list[str]) -> None:
    subset = df[columns].to_numpy(dtype=float)
    if np.isnan(subset).any():
        bad_columns = [col for col in columns if df[col].isna().any()]
        raise MalformedFeatureMatrixError(f"Feature matrix contains NaN in columns: {bad_columns}")
    if np.isinf(subset).any():
        bad_columns = [col for col in columns if np.isinf(df[col].to_numpy(dtype=float)).any()]
        raise MalformedFeatureMatrixError(f"Feature matrix contains +/-Inf in columns: {bad_columns}")


def load_rfm_segments(rfm_segments_csv: Path) -> pd.DataFrame | None:
    if not rfm_segments_csv.exists():
        return None
    df = pd.read_csv(rfm_segments_csv)
    df["segmentCode"] = df["segmentCode"].fillna("").replace("", "NO_CURRENT_RFM_SEGMENT")
    return df.set_index("customerId")
