import numpy as np
import pandas as pd
import pytest

from clustering_lib.preprocessing import FEATURE_SET_A, FEATURE_SET_B, build_matrix
from clustering_lib.io_utils import RAW_FEATURE_COLUMNS


def _synthetic_raw(n: int = 200, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    df = pd.DataFrame(
        {
            "validOrders": rng.integers(2, 20, n),
            "totalSpentTaxIncl": rng.lognormal(mean=11, sigma=1.2, size=n),
            "averageOrderValueTaxIncl": rng.lognormal(mean=9, sigma=1.0, size=n),
            "customerTenureDays": rng.integers(3, 1450, n),
            "daysSinceLastOrder": rng.integers(0, 1400, n),
            "purchaseFrequencyDays": rng.uniform(0, 1400, n),
            "daysBetweenFirstLastOrder": rng.uniform(0, 1400, n),
            "orders365d": rng.integers(0, 10, n),
            "totalOrdersAllStates": rng.integers(2, 25, n),
            "cancelledOrders": rng.integers(0, 3, n),
            "cancelledOrderRatio": rng.uniform(0, 0.5, n),
            "totalDiscountsTaxIncl": rng.uniform(0, 100000, n),
            "totalShippingTaxIncl": rng.uniform(0, 50000, n),
            "discountShare": rng.exponential(0.05, n),
            "shippingShare": rng.uniform(0, 0.8, n),
            "distinctProducts": rng.integers(1, 50, n),
            "repeatProductRate": rng.uniform(0, 1, n),
            "top1Share": rng.uniform(0.1, 1.0, n),
            "top3Share": rng.uniform(0.3, 1.0, n),
            "hhi": rng.uniform(0.05, 1.0, n),
            "effectiveDiversity": rng.uniform(1, 30, n),
            "averageUnitsPerOrder": rng.lognormal(mean=1, sigma=1, size=n),
        }
    )
    assert set(df.columns) == set(RAW_FEATURE_COLUMNS)
    return df


def test_build_matrix_is_deterministic_for_the_same_input():
    raw = _synthetic_raw()
    matrix_a, report_a = build_matrix(raw, "A")
    matrix_b, report_b = build_matrix(raw, "A")
    np.testing.assert_array_equal(matrix_a, matrix_b)
    assert report_a.winsorize_caps == report_b.winsorize_caps


def test_feature_set_a_excludes_raw_rfm_dominant_variables():
    for forbidden in ("totalSpentTaxIncl", "validOrders", "daysSinceLastOrder"):
        assert forbidden not in FEATURE_SET_A


def test_feature_set_b_is_a_strict_superset_of_set_a():
    assert set(FEATURE_SET_A).issubset(set(FEATURE_SET_B))
    assert set(FEATURE_SET_B) - set(FEATURE_SET_A) == {"totalSpentTaxIncl", "validOrders", "daysSinceLastOrderPlus1"}


def test_hhi_is_excluded_from_both_feature_sets_to_avoid_double_counting_concentration():
    assert "hhi" not in FEATURE_SET_A
    assert "hhi" not in FEATURE_SET_B


def test_build_matrix_produces_no_nan_or_inf():
    raw = _synthetic_raw()
    for name in ("A", "B"):
        matrix, _ = build_matrix(raw, name)
        assert np.all(np.isfinite(matrix))


def test_build_matrix_rejects_unknown_feature_set_name():
    raw = _synthetic_raw()
    with pytest.raises(ValueError):
        build_matrix(raw, "C")


def test_winsorization_caps_the_long_tail_of_discount_share():
    raw = _synthetic_raw()
    raw.loc[raw.index[0], "discountShare"] = 50.0  # inject an extreme outlier
    _, report = build_matrix(raw, "A")
    assert report.winsorize_caps["discountShare"] < 50.0


def test_ratio_features_are_clipped_to_unit_interval():
    raw = _synthetic_raw()
    raw.loc[raw.index[0], "top3Share"] = 1.000001  # observed real rounding drift
    matrix, report = build_matrix(raw, "A")
    idx = report.feature_columns.index("top3Share")
    assert matrix[:, idx].max() <= 1.0
