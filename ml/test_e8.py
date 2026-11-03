import numpy as np
import pytest

from findgrowth_ml.propensity import (
    ISOTONIC_MIN_N,
    assert_epv,
    build_model_card,
    choose_calibrator,
    conformal_interval,
    nonbuyer_versus_baseline,
    reason_phrases,
    synthetic_nonbuyers,
    synthetic_rows,
    fit_elastic_net,
)
from findgrowth_ml.train import refuse_gbm, refuse_model_shadow


def test_epv_gate_is_not_the_gbm_gate():
    with pytest.raises(RuntimeError, match="EPV refused"):
        assert_epv(99)
    with pytest.raises(RuntimeError, match="EPV refused"):
        refuse_model_shadow(99)
    refuse_model_shadow(100)
    with pytest.raises(RuntimeError, match="GBM refused"):
        refuse_gbm(100)


def test_card_adds_cox_reasons_and_keeps_platt_on_the_small_fixture():
    pytest.importorskip("sklearn")
    card = build_model_card()
    assert card["cox"] is not None
    assert card["calibration_method"] == "platt"
    assert card["train_n"] < ISOTONIC_MIN_N
    assert card["production_model"] in {"elastic-net-logistic", "cox-elastic-net"}
    if not card["cox"].get("beats_step1"):
        assert card["production_model"] == "elastic-net-logistic"
    assert card["nested_cv"]["selected"]
    assert card["permutation_importance"]
    assert "quantile" in card["conformal"]
    assert card["conformal"]["shap"] == "waiting for GBM"
    for line in card["reason_codes"]:
        assert not any(char.isdigit() for char in line)
    print("E8.15", card["cox"])
    print("E8.16", card["nested_cv"]["selected"], card["permutation_importance"][0], card["conformal"]["quantile"])


def test_isotonic_switches_on_only_above_the_threshold():
    pytest.importorskip("sklearn")
    rng = np.random.default_rng(2)
    y = rng.integers(0, 2, 420)
    scores = np.clip(y * 0.6 + rng.normal(0, 0.05, 420), 0.01, 0.99)
    _, small = choose_calibrator(y[:200], scores[:200], scores[200:220])
    _, large = choose_calibrator(y, scores, scores[:10])
    assert small == "platt"
    assert large == "isotonic"


def test_reason_phrases_have_no_digits():
    pytest.importorskip("sklearn")
    rows = synthetic_rows(40, seed=2)
    fitted = fit_elastic_net(rows[:28], ["visits", "recency", "revenue", "orders"])
    words = reason_phrases(rows[30], fitted)
    assert words
    assert any("визит" in word or "покупал" in word or "чек" in word or "заказ" in word for word in words)
    for word in words:
        assert not any(char.isdigit() for char in word)


def test_conformal_abstains_without_a_refit():
    y = np.array([0, 1, 0, 1, 0, 1], dtype=float)
    scores = np.array([0.2, 0.8, 0.3, 0.7, 0.4, 0.6])
    band = conformal_interval(y, scores, np.array([0.5]))
    assert band["low"][0] <= 0.5 <= band["high"][0]
    assert band["shap"] == "waiting for GBM"


def test_nonbuyer_censoring_and_baseline():
    pytest.importorskip("sklearn")
    rows = synthetic_nonbuyers()
    assert any(row["censored"] and row["label"] is None for row in rows)
    assert not any(row["censored"] and row["label"] == 0 for row in rows)
    report = nonbuyer_versus_baseline()
    assert report["synthetic"] is True
    assert report["censored_are_not_zero"] is True
    assert report["beats_baseline"] is False
    assert report["gap_pr_auc"]["low"] <= 0
    assert report["oracle_gap_pr_auc"]["low"] <= 0
    assert report["coefficients"]["visits"] > report["coefficients"]["cart"]
    print(
        "E8.7",
        report["beats_baseline"],
        report["gap_pr_auc"],
        "test",
        report["test_n"],
        report["test_positives"],
        "coef",
        report["coefficients"],
        "oracle",
        report["oracle_gap_pr_auc"],
    )
