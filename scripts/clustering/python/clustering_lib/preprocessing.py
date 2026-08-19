"""Feature Set A / B construction and preprocessing (log1p, winsorization, robust scaling).

Design decisions, all justified against the live distributions captured in
scripts/clustering/outputs/dataset-manifest.json (CP-R2 readiness audit Step 7):

- Skewed, unbounded-positive counts/money (distinctProducts, effectiveDiversity,
  averageUnitsPerOrder, purchaseFrequencyDays, orders365d, customerTenureDays, and — Set B
  only — totalSpentTaxIncl/validOrders/daysSinceLastOrder+1): log1p, then RobustScaler
  (median/IQR) fit on this population.
- Already-bounded ratios (repeatProductRate, top1Share, top3Share): left as-is, only clipped
  to [0,1] to absorb decimal-rounding drift (observed max 1.000001 on top3Share) — NOT
  rescaled again, matching the audit's reasoning that rescaling an already-meaningful [0,1]
  ratio would distort its unit.
- cancelledOrderRatio/discountShare/shippingShare: confirmed live denominator-blowup outliers
  (discountShare observed max 4.38, i.e. discounts > 4x total spend for some repeat-purchase
  customers) — winsorized at the population's own p99 before use, per audit Step 16. The p99
  cutoff is data-derived, never hardcoded.
- hhi is deliberately excluded from both feature sets (see manifest note from the TS side):
  effectiveDiversity = 1/hhi is a bijective transform of hhi, so training on both would
  double-count concentration.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.preprocessing import RobustScaler

preprocessing_version = "cluster-preprocessing-v1"

LOG1P_SCALE_FEATURES = [
    "distinctProducts",
    "effectiveDiversity",
    "averageUnitsPerOrder",
    "purchaseFrequencyDays",
    "orders365d",
]
# Roughly bounded (~3 to ~1450 days observed) — RobustScaler only, no log1p (log1p would
# needlessly compress an already-modest range).
TENURE_SCALE_ONLY_FEATURES = ["customerTenureDays"]

RATIO_CLIP01_FEATURES = ["repeatProductRate", "top1Share", "top3Share"]
RATIO_WINSORIZE_FEATURES = ["cancelledOrderRatio", "discountShare", "shippingShare"]

SET_B_LOG1P_SCALE_FEATURES = ["totalSpentTaxIncl", "validOrders", "daysSinceLastOrderPlus1"]

FEATURE_SET_A = (
    LOG1P_SCALE_FEATURES + TENURE_SCALE_ONLY_FEATURES + RATIO_CLIP01_FEATURES + RATIO_WINSORIZE_FEATURES
)
FEATURE_SET_B = FEATURE_SET_A + SET_B_LOG1P_SCALE_FEATURES

WINSORIZE_PERCENTILE = 0.99


@dataclass(frozen=True)
class PreprocessingReport:
    feature_set_name: str
    feature_columns: list[str]
    winsorize_caps: dict[str, float] = field(default_factory=dict)
    scaler_center: dict[str, float] = field(default_factory=dict)
    scaler_scale: dict[str, float] = field(default_factory=dict)

    def to_json(self) -> dict:
        return {
            "preprocessingVersion": preprocessing_version,
            "featureSetName": self.feature_set_name,
            "featureColumns": self.feature_columns,
            "winsorizeCaps": self.winsorize_caps,
            "scalerCenter": self.scaler_center,
            "scalerScale": self.scaler_scale,
        }


def _derive_columns(raw: pd.DataFrame) -> pd.DataFrame:
    df = raw.copy()
    df["daysSinceLastOrderPlus1"] = df["daysSinceLastOrder"] + 1
    return df


def build_matrix(raw: pd.DataFrame, feature_set_name: str) -> tuple[np.ndarray, PreprocessingReport]:
    if feature_set_name == "A":
        columns = FEATURE_SET_A
    elif feature_set_name == "B":
        columns = FEATURE_SET_B
    else:
        raise ValueError(f"Unknown feature set: {feature_set_name}")

    df = _derive_columns(raw)
    working = pd.DataFrame(index=df.index)
    winsorize_caps: dict[str, float] = {}

    log1p_columns = LOG1P_SCALE_FEATURES + TENURE_SCALE_ONLY_FEATURES + (
        SET_B_LOG1P_SCALE_FEATURES if feature_set_name == "B" else []
    )
    for column in log1p_columns:
        values = df[column].to_numpy(dtype=float)
        if column in TENURE_SCALE_ONLY_FEATURES:
            working[column] = values
        else:
            working[column] = np.log1p(values)

    for column in RATIO_CLIP01_FEATURES:
        working[column] = df[column].clip(lower=0.0, upper=1.0)

    for column in RATIO_WINSORIZE_FEATURES:
        cap = float(df[column].quantile(WINSORIZE_PERCENTILE))
        winsorize_caps[column] = cap
        working[column] = df[column].clip(lower=0.0, upper=cap)

    working = working[columns]

    scale_columns = [column for column in columns if column not in RATIO_CLIP01_FEATURES + RATIO_WINSORIZE_FEATURES]
    scaler = RobustScaler()
    scaled_part = scaler.fit_transform(working[scale_columns])
    final = working.copy()
    final[scale_columns] = scaled_part

    matrix = final[columns].to_numpy(dtype=float)
    if not np.all(np.isfinite(matrix)):
        raise ValueError("Preprocessed matrix contains non-finite values — aborting before fit (Section 41)")

    report = PreprocessingReport(
        feature_set_name=feature_set_name,
        feature_columns=columns,
        winsorize_caps=winsorize_caps,
        scaler_center=dict(zip(scale_columns, scaler.center_.tolist())),
        scaler_scale=dict(zip(scale_columns, scaler.scale_.tolist())),
    )
    return matrix, report
