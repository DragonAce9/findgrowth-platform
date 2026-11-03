"""Elastic-net logistic scores versus a dumb RFM rule. Shadow unless both notices are set.

GBM is refused below 500 positives and is not fit here. No cross-brand training.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

FEATURES = ("orders", "revenue", "visits", "recency")


def refuse_gbm(positives: int) -> None:
    if positives < 500:
        raise RuntimeError("GBM refused: fewer than 500 positives")


def refuse_model_shadow(positives: int) -> None:
    """EPV gate. Separate from refuse_gbm. Below 100 the model does not score, even in shadow."""
    if positives < 100:
        raise RuntimeError("EPV refused: fewer than 100 positives; RFM only, not shadow")


def load_rows(path: Path) -> list[dict]:
    payload = json.loads(path.read_text())
    rows = payload["rows"] if isinstance(payload, dict) else payload
    return sorted(rows, key=lambda row: (row["t1"], row["id"]))


def rfm_score(row: dict) -> float:
    return 1.0 if int(row["orders"]) >= 2 else 0.0


def time_split(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    cut = max(1, int(len(rows) * 0.7))
    if cut >= len(rows):
        cut = len(rows) - 1
    return rows[:cut], rows[cut:]


def fit_scores(rows: list[dict], *, profiling_notice: bool, customer_notice: bool) -> tuple[list[dict], dict]:
    import numpy as np
    from sklearn.linear_model import LogisticRegression

    positives = sum(int(row["repeat"]) for row in rows)
    if positives < 100:
        scored = []
        for row in rows:
            top = int(row["orders"]) >= 2
            scored.append({"id": row["id"], "bucket": "top" if top else "bottom", "abstain": False, "rule": "rfm"})
        card = {
            "mode": "rfm",
            "model": None,
            "baseline": "rfm-orders-at-least-2",
            "positives": positives,
            "notes": "EPV < 100: RFM assigns the bucket. Elastic-net is not fit and does not write a score.",
        }
        return scored, card
    train, test = time_split(rows)
    x_train = np.array([[float(row[name]) for name in FEATURES] for row in train])
    y_train = np.array([int(row["repeat"]) for row in train])
    x_test = np.array([[float(row[name]) for name in FEATURES] for row in test])
    model = LogisticRegression(penalty="elasticnet", solver="saga", l1_ratio=0.5, C=1.0, max_iter=4000)
    if len(set(y_train.tolist())) < 2:
        probs = [float(y_train.mean())] * len(test)
    else:
        model.fit(x_train, y_train)
        probs = model.predict_proba(x_test)[:, 1].tolist()
    scored = []
    for row, prob in zip(test, probs):
        low, high = bootstrap_band(train, row)
        wide = high - low > 0.4
        scored.append({"id": row["id"], "score": prob, "low": low, "high": high, "wide": wide})
    assign_buckets(scored)
    mode = "live" if profiling_notice and customer_notice else "shadow"
    card = {
        "mode": mode,
        "model": "elastic-net-logistic",
        "baseline": "rfm-orders-at-least-2",
        "train_n": len(train),
        "test_n": len(test),
        "baseline_accuracy": accuracy([rfm_score(row) >= 0.5 for row in test], [int(row["repeat"]) for row in test]),
        "notes": "Shadow unless profilingNotice and customerNotice. Not a screen fact.",
    }
    return scored, card


def bootstrap_band(train: list[dict], row: dict, reps: int = 25) -> tuple[float, float]:
    import numpy as np
    from sklearn.linear_model import LogisticRegression

    rng = np.random.default_rng(1)
    point = np.array([[float(row[name]) for name in FEATURES]])
    y = np.array([int(item["repeat"]) for item in train])
    if len(set(y.tolist())) < 2:
        return float(y.mean()), float(y.mean())
    draws = []
    n = len(train)
    for _ in range(reps):
        pick = rng.integers(0, n, n)
        sample = [train[int(index)] for index in pick]
        labels = np.array([int(item["repeat"]) for item in sample])
        if len(set(labels.tolist())) < 2:
            continue
        x = np.array([[float(item[name]) for name in FEATURES] for item in sample])
        model = LogisticRegression(penalty="elasticnet", solver="saga", l1_ratio=0.5, C=1.0, max_iter=2000)
        model.fit(x, labels)
        draws.append(float(model.predict_proba(point)[0, 1]))
    if not draws:
        return 0.0, 1.0
    draws.sort()
    return draws[0], draws[-1]


def assign_buckets(scored: list[dict]) -> None:
    ranked = sorted(scored, key=lambda row: (-row["score"], row["id"]))
    n = len(ranked)
    for index, row in enumerate(ranked):
        if row["wide"] or n <= 1:
            row["bucket"] = "middle"
            row["abstain"] = True
            continue
        pct = index / n
        row["bucket"] = "top" if pct < 0.2 else "bottom" if pct >= 0.8 else "middle"
        row["abstain"] = False
    for row in scored:
        row.pop("wide", None)


def accuracy(pred: list[bool], actual: list[int]) -> float:
    if not actual:
        return 0.0
    hits = sum(int(flag) == value for flag, value in zip(pred, actual))
    return hits / len(actual)


def write_outputs(scores: list[dict], card: dict, scores_path: Path, card_path: Path) -> None:
    scores_path.write_text(json.dumps(scores, indent=2))
    card_path.write_text(json.dumps(card, indent=2))


def self_check(fixture: Path) -> int:
    try:
        refuse_gbm(10)
    except RuntimeError as error:
        if "GBM refused" not in str(error):
            raise
    else:
        raise AssertionError("GBM must refuse under 500 positives")
    refuse_gbm(500)
    try:
        refuse_model_shadow(10)
    except RuntimeError as error:
        if "EPV refused" not in str(error):
            raise
    else:
        raise AssertionError("EPV must refuse under 100 positives")
    refuse_model_shadow(100)
    try:
        import sklearn  # noqa: F401
    except ImportError:
        print("skipped: scikit-learn is not installed")
        return 0
    scores, card = fit_scores(load_rows(fixture), profiling_notice=True, customer_notice=True)
    assert card["mode"] == "rfm"
    assert card["model"] is None
    assert scores
    for row in scores:
        assert row["bucket"] in {"top", "bottom"}
        assert "score" not in row
    wide = []
    for index in range(320):
        day = index + 1
        wide.append(
            {
                "id": f"w{index:03d}",
                "t1": f"2024-{(day // 28) + 1:02d}-{(day % 27) + 1:02d}",
                "repeat": 1 if index % 3 == 0 else 0,
                "orders": 2 if index % 3 == 0 else 1,
                "revenue": 40 + (index % 50),
                "visits": 1 + (index % 6),
                "recency": 5 + (index % 20),
            }
        )
    scored, shadow = fit_scores(wide, profiling_notice=False, customer_notice=False)
    assert shadow["mode"] == "shadow"
    assert "score" in scored[0]
    print(f"ok {len(scores)} rfm rows, {len(scored)} shadow scores")
    return 0


def serve_health(host: str = "0.0.0.0", port: int = 8080) -> int:
    """One route so compose can mark the process healthy. This is not a score."""
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path.split("?", 1)[0] != "/health":
                self.send_response(404)
                self.end_headers()
                return
            body = b"ok"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: object) -> None:
            return

    server = ThreadingHTTPServer((host, port), Handler)
    print(f"health listening on {port}", flush=True)
    server.serve_forever()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=Path)
    parser.add_argument("--scores", type=Path)
    parser.add_argument("--card", type=Path)
    parser.add_argument("--profiling-notice", action="store_true")
    parser.add_argument("--customer-notice", action="store_true")
    parser.add_argument("--self-check", action="store_true")
    parser.add_argument("--health", action="store_true")
    args = parser.parse_args()
    fixture = Path(__file__).resolve().parents[1] / "fixtures" / "synthetic_features.json"
    if args.health:
        return serve_health()
    if args.self_check:
        return self_check(fixture)
    if not args.features or not args.scores or not args.card:
        parser.error("pass --features, --scores, and --card, or --self-check")
    scores, card = fit_scores(
        load_rows(args.features),
        profiling_notice=args.profiling_notice,
        customer_notice=args.customer_notice,
    )
    write_outputs(scores, card, args.scores, args.card)
    return 0
