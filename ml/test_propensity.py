import numpy as np
import pytest

from findgrowth_ml.propensity import (
    build_model_card,
    calibration_curve,
    category_versus_brand,
    diagonal_distance,
    features_without_leakage,
    label_copy_features,
    platt_calibrate,
    pooled_rows,
    synthetic_rows,
    time_split,
    uplift_versus_propensity,
)


def test_time_split_follows_cohort_date_and_flags_a_label_copy():
    rows = synthetic_rows(40, seed=3)
    train, test = time_split(rows)
    assert train[-1]["t1"] <= test[0]["t1"]
    leaked = [{**row, "leak": row["repeat"]} for row in rows]
    assert label_copy_features(leaked, ["visits", "leak"]) == ["leak"]
    used, flagged = features_without_leakage(leaked, ["visits", "leak", "orders"])
    assert "leak" not in used
    assert flagged == ["leak"]


def test_model_card_is_synthetic_and_intervals_are_ordered():
    pytest.importorskip("sklearn")
    card = build_model_card()
    assert card["synthetic"] is True
    assert "Synthetic" in card["sentence"]
    assert card["leakage_flagged"] == ["repeat_copy"]
    assert "repeat_copy" not in card["features"]
    assert card["cv"]["n"] > 0
    for name in ("pr_auc", "lift_at_20", "brier", "gap_pr_auc", "gap_brier"):
        band = card["metrics"][name]
        assert band["low"] <= band["value"] <= band["high"]
    assert card["calibration"]
    assert {"bin", "predicted", "observed"} <= set(card["calibration"][0])
    print("E4.4", card["beats_rfm"], card["metrics"]["gap_pr_auc"], card["metrics"]["gap_brier"], card["bg_nbd"])


def test_miscalibrated_scores_move_toward_the_diagonal():
    pytest.importorskip("sklearn")
    rng = np.random.default_rng(4)
    latent = rng.normal(size=400)
    truth = 1 / (1 + np.exp(-latent))
    outcome = (rng.random(400) < truth).astype(int)
    bad = np.clip(0.08 + 0.2 * truth, 0.02, 0.98)
    calibrated = platt_calibrate(outcome[:200], bad[:200], bad[200:])
    before = diagonal_distance(calibration_curve(outcome[200:], bad[200:]))
    after = diagonal_distance(calibration_curve(outcome[200:], calibrated))
    assert after < before


def test_pool_drops_a_brand_without_consent():
    brands = [
        {"id": "yes", "pooling_consent": True, "rows": [{"id": "a", "repeat": 1}]},
        {"id": "no", "pooling_consent": False, "rows": [{"id": "b", "repeat": 0}]},
    ]
    assert [row["brand_id"] for row in pooled_rows(brands)] == ["yes"]


def test_category_and_uplift_reports():
    pytest.importorskip("sklearn")
    category = category_versus_brand()
    assert category["brand_positives"] < 300
    assert category["pool_ids"] == ["donor", "small"]
    uplift = uplift_versus_propensity()
    assert len(uplift["uplift_curve"]) >= 5
    assert len(uplift["propensity_curve"]) >= 5
    print("E4.11", category["beats"], category["gap_pr_auc"], "positives", category["brand_positives"])
    print("E4.12", uplift["beats"], uplift["uplift_area"], uplift["propensity_area"])
