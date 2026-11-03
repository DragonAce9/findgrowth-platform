from pathlib import Path

import pytest

from findgrowth_ml.train import refuse_gbm, self_check

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "synthetic_features.json"


def test_gbm_refused_under_500_positives():
    with pytest.raises(RuntimeError, match="GBM refused"):
        refuse_gbm(499)
    refuse_gbm(500)


def test_synthetic_fixture_scores():
    pytest.importorskip("sklearn")
    assert self_check(FIXTURE) == 0
