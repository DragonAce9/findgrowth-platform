"""Synthetic propensity baselines, elastic-net, calibration, and a model card.

Every row here is generated. Nothing in the card is a measured lift or a screen fact.
lifetimes is used for BG/NBD when it imports; otherwise a Beta-Geometric closed form.
Cox elastic net is fit on the synthetic card when lifelines imports. It does not replace elastic-net unless it wins.
"""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np

FEATURES = ("visits", "recency", "revenue", "orders")


def synthetic_rows(n: int = 280, seed: int = 11, brand: str = "synthetic") -> list[dict]:
    """Label depends on visits, recency, and revenue. Order count is weak on purpose."""
    rng = np.random.default_rng(seed)
    start = date(2023, 1, 2)
    rows = []
    for index in range(n):
        visits = float(rng.integers(1, 15))
        recency = float(rng.integers(1, 80))
        revenue = float(rng.uniform(15, 140))
        orders = float(rng.choice([1, 1, 1, 2, 3]))
        role = "serum" if rng.random() < 0.5 else "spf"
        logit = -2.6 + 0.48 * visits - 0.04 * recency + 0.015 * (revenue - 40)
        probability = 1 / (1 + np.exp(-logit))
        repeat = int(rng.random() < probability)
        rows.append(
            {
                "id": f"{brand}-{index:04d}",
                "t1": (start + timedelta(days=index)).isoformat(),
                "repeat": repeat,
                "orders": orders,
                "revenue": round(revenue, 2),
                "visits": visits,
                "recency": recency,
                "role": role,
                "brand_id": brand,
            }
        )
    return rows


def time_split(rows: list[dict], frac: float = 0.7) -> tuple[list[dict], list[dict]]:
    ordered = sorted(rows, key=lambda row: (row["t1"], row["id"]))
    cut = max(1, min(len(ordered) - 1, int(len(ordered) * frac)))
    while cut < len(ordered) - 1 and ordered[cut - 1]["t1"] == ordered[cut]["t1"]:
        cut += 1
    return ordered[:cut], ordered[cut:]


def label_copy_features(rows: list[dict], names: list[str], label: str = "repeat") -> list[str]:
    target = np.array([float(row[label]) for row in rows])
    flagged = []
    for name in names:
        column = np.array([float(row[name]) for row in rows])
        if column.shape == target.shape and np.allclose(column, target):
            flagged.append(name)
    return flagged


def features_without_leakage(rows: list[dict], names: list[str]) -> tuple[list[str], list[str]]:
    flagged = label_copy_features(rows, names)
    blocked = set(flagged)
    return [name for name in names if name not in blocked], flagged


def _tertile_edges(values: np.ndarray) -> tuple[float, float]:
    ordered = np.sort(values.astype(float))
    if len(ordered) < 3:
        point = float(ordered[0]) if len(ordered) else 0.0
        return point, point
    return float(ordered[len(ordered) // 3]), float(ordered[(2 * len(ordered)) // 3])


def _bin(value: float, low: float, high: float, higher_is_better: bool) -> int:
    raw = 1 if value <= low else 3 if value > high else 2
    return raw if higher_is_better else 4 - raw


def rfm_scores(train: list[dict], test: list[dict]) -> np.ndarray:
    """Train-only tertiles of recency, frequency, and monetary value, plus the first-SKU role rate."""
    recency = _tertile_edges(np.array([row["recency"] for row in train]))
    orders = _tertile_edges(np.array([row["orders"] for row in train]))
    revenue = _tertile_edges(np.array([row["revenue"] for row in train]))
    role_hits: dict[str, list[int]] = {}
    for row in train:
        role_hits.setdefault(str(row["role"]), []).append(int(row["repeat"]))
    role_rate = {role: (sum(flags) + 1) / (len(flags) + 2) for role, flags in role_hits.items()}
    cells: dict[int, list[int]] = {}
    coded = []
    for row in train:
        code = (
            _bin(float(row["recency"]), *recency, False)
            + _bin(float(row["orders"]), *orders, True)
            + _bin(float(row["revenue"]), *revenue, True)
        )
        coded.append(code)
        cells.setdefault(code, []).append(int(row["repeat"]))
    rate = {code: (sum(flags) + 1) / (len(flags) + 2) for code, flags in cells.items()}
    fallback = (sum(int(row["repeat"]) for row in train) + 1) / (len(train) + 2)
    scores = []
    for row in test:
        code = (
            _bin(float(row["recency"]), *recency, False)
            + _bin(float(row["orders"]), *orders, True)
            + _bin(float(row["revenue"]), *revenue, True)
        )
        base = rate.get(code, fallback)
        role = role_rate.get(str(row["role"]), fallback)
        scores.append(0.85 * base + 0.15 * role)
    return np.array(scores, dtype=float)


def _beta_moments(flags: np.ndarray) -> tuple[float, float]:
    mean = float(np.mean(flags)) if len(flags) else 0.5
    variance = float(np.var(flags)) if len(flags) else 0.0
    cap = mean * (1 - mean)
    if cap <= 1e-8 or variance <= 1e-8 or variance >= cap * 0.99:
        return 1.0, 1.0
    common = mean * (1 - mean) / variance - 1
    if common <= 0:
        return 1.0, 1.0
    return mean * common, (1 - mean) * common


def beta_geometric_scores(train: list[dict], test: list[dict]) -> tuple[np.ndarray, str]:
    """BG/NBD via lifetimes when that package imports. Otherwise a Beta-Geometric closed form.

    Dropout probability θ ~ Beta(alpha, beta), moments matched to the training repeat rate.
    After `orders` observed purchases the posterior mean of buying again is
    (beta + orders - 1) / (alpha + beta + orders - 1). This is not a lifetimes BG/NBD fit.
    """
    try:
        from lifetimes import BetaGeoFitter  # type: ignore

        return _lifetimes_bgnbd(train, test, BetaGeoFitter), "lifetimes-bgnbd"
    except Exception:
        flags = np.array([int(row["repeat"]) for row in train], dtype=float)
        alpha, beta = _beta_moments(flags)
        scores = np.array(
            [(beta + float(row["orders"]) - 1) / (alpha + beta + float(row["orders"]) - 1) for row in test],
            dtype=float,
        )
        return np.clip(scores, 0, 1), "beta-geometric-closed-form"


def _lifetimes_bgnbd(train: list[dict], test: list[dict], fitter_cls: type) -> np.ndarray:
    import pandas as pd

    frame = pd.DataFrame(
        {
            "frequency": [max(0, int(row["orders"]) - 1) for row in train],
            "recency": [float(row["recency"]) for row in train],
            "T": [float(row["recency"]) + 30 for row in train],
        }
    )
    model = fitter_cls(penalizer_coef=0.01)
    model.fit(frame["frequency"], frame["recency"], frame["T"])
    scored = []
    for row in test:
        frequency = max(0, int(row["orders"]) - 1)
        recency = float(row["recency"])
        horizon = recency + 30
        scored.append(float(model.conditional_probability_alive(frequency, recency, horizon)))
    return np.clip(np.array(scored, dtype=float), 0, 1)


def _matrix(rows: list[dict], features: list[str]) -> np.ndarray:
    return np.array([[float(row[name]) for name in features] for row in rows], dtype=float)


def elastic_net_proba(train: list[dict], test: list[dict], features: list[str]) -> tuple[np.ndarray, np.ndarray]:
    from sklearn.linear_model import LogisticRegression

    x_train = _matrix(train, features)
    y_train = np.array([int(row["repeat"]) for row in train])
    x_test = _matrix(test, features)
    center = x_train.mean(axis=0)
    scale = x_train.std(axis=0)
    scale[scale < 1e-6] = 1

    def norm(values: np.ndarray) -> np.ndarray:
        return (values - center) / scale

    if len(set(y_train.tolist())) < 2:
        point = float(y_train.mean()) if len(y_train) else 0.0
        return np.full(len(test), point), np.full(len(train), point)
    model = LogisticRegression(
        penalty="elasticnet",
        solver="saga",
        l1_ratio=0.5,
        C=1.0,
        max_iter=600,
        random_state=0,
        tol=1e-3,
    )
    model.fit(norm(x_train), y_train)
    return model.predict_proba(norm(x_test))[:, 1], model.predict_proba(norm(x_train))[:, 1]


def average_precision(y: np.ndarray, scores: np.ndarray) -> float:
    y = np.asarray(y, dtype=float)
    order = np.argsort(-np.asarray(scores, dtype=float), kind="mergesort")
    ranked = y[order]
    positives = float(ranked.sum())
    if positives <= 0:
        return 0.0
    hits = 0.0
    total = 0.0
    for index, label in enumerate(ranked, start=1):
        if label:
            hits += 1
            total += hits / index
    return float(total / positives)


def lift_at_20(y: np.ndarray, scores: np.ndarray) -> float:
    y = np.asarray(y, dtype=float)
    base = float(y.mean()) if len(y) else 0.0
    if base <= 0:
        return 0.0
    take = max(1, int(round(len(y) * 0.2)))
    order = np.argsort(-np.asarray(scores, dtype=float), kind="mergesort")
    return float(y[order[:take]].mean() / base)


def brier(y: np.ndarray, scores: np.ndarray) -> float:
    y = np.asarray(y, dtype=float)
    p = np.asarray(scores, dtype=float)
    if not len(y):
        return 0.0
    return float(np.mean((p - y) ** 2))


def _percentile(draws: list[float]) -> tuple[float, float]:
    ordered = sorted(draws)
    low = ordered[int(0.025 * (len(ordered) - 1))]
    high = ordered[int(0.975 * (len(ordered) - 1))]
    return float(low), float(high)


def bootstrap_metric(y: np.ndarray, scores: np.ndarray, fn, reps: int = 250, seed: int = 3) -> dict:
    rng = np.random.default_rng(seed)
    y = np.asarray(y, dtype=float)
    scores = np.asarray(scores, dtype=float)
    point = float(fn(y, scores))
    draws = []
    n = len(y)
    for _ in range(reps):
        index = rng.integers(0, n, n)
        sample_y = y[index]
        if fn is average_precision and sample_y.min() == sample_y.max():
            continue
        draws.append(float(fn(sample_y, scores[index])))
    if not draws:
        return {"value": point, "low": point, "high": point}
    low, high = _percentile(draws)
    return {"value": point, "low": low, "high": high}


def bootstrap_gap(y: np.ndarray, left: np.ndarray, right: np.ndarray, fn, reps: int = 250, seed: int = 5) -> dict:
    """left minus right on the same resample. For Brier, pass baseline then model so a positive gap is a win."""
    rng = np.random.default_rng(seed)
    y = np.asarray(y, dtype=float)
    left = np.asarray(left, dtype=float)
    right = np.asarray(right, dtype=float)
    point = float(fn(y, left) - fn(y, right))
    draws = []
    n = len(y)
    for _ in range(reps):
        index = rng.integers(0, n, n)
        sample_y = y[index]
        if fn is average_precision and sample_y.min() == sample_y.max():
            continue
        draws.append(float(fn(sample_y, left[index]) - fn(sample_y, right[index])))
    if not draws:
        return {"value": point, "low": point, "high": point}
    low, high = _percentile(draws)
    return {"value": point, "low": low, "high": high}


def repeated_stratified_cv(rows: list[dict], features: list[str], repeats: int = 5, folds: int = 5, seed: int = 1) -> dict:
    rng = np.random.default_rng(seed)
    scores = []
    for _ in range(repeats):
        buckets: list[list[dict]] = [[] for _ in range(folds)]
        by_label = {0: [], 1: []}
        for row in rows:
            by_label[int(row["repeat"])].append(row)
        for label in (0, 1):
            order = np.array(by_label[label], dtype=object)
            rng.shuffle(order)
            for index, row in enumerate(order.tolist()):
                buckets[index % folds].append(row)
        for hold in range(folds):
            test = buckets[hold]
            train = [row for index, bucket in enumerate(buckets) if index != hold for row in bucket]
            if len({int(row["repeat"]) for row in train}) < 2 or len({int(row["repeat"]) for row in test}) < 2:
                continue
            predicted, _ = elastic_net_proba(train, test, features)
            scores.append(average_precision(np.array([row["repeat"] for row in test], dtype=float), predicted))
    if not scores:
        return {"repeats": repeats, "folds": folds, "pr_auc_mean": None, "n": 0}
    values = np.array(scores, dtype=float)
    return {
        "repeats": repeats,
        "folds": folds,
        "pr_auc_mean": float(values.mean()),
        "pr_auc_low": float(np.quantile(values, 0.025)),
        "pr_auc_high": float(np.quantile(values, 0.975)),
        "n": int(len(values)),
    }


def calibration_curve(y: np.ndarray, scores: np.ndarray, bins: int = 5) -> list[dict]:
    y = np.asarray(y, dtype=float)
    scores = np.asarray(scores, dtype=float)
    order = np.argsort(scores, kind="mergesort")
    y = y[order]
    scores = scores[order]
    curve = []
    for index, chunk in enumerate(np.array_split(np.arange(len(y)), bins)):
        if len(chunk) == 0:
            continue
        curve.append(
            {
                "bin": int(index),
                "predicted": float(scores[chunk].mean()),
                "observed": float(y[chunk].mean()),
            }
        )
    return curve


def diagonal_distance(curve: list[dict]) -> float:
    if not curve:
        return 0.0
    return float(np.mean([abs(row["predicted"] - row["observed"]) for row in curve]))


def platt_calibrate(y_fit: np.ndarray, scores_fit: np.ndarray, scores_apply: np.ndarray) -> np.ndarray:
    from sklearn.linear_model import LogisticRegression

    def logit(values: np.ndarray) -> np.ndarray:
        clipped = np.clip(values, 1e-4, 1 - 1e-4)
        return np.log(clipped / (1 - clipped))

    y_fit = np.asarray(y_fit).astype(int)
    if len(set(y_fit.tolist())) < 2:
        return np.asarray(scores_apply, dtype=float)
    model = LogisticRegression(max_iter=200, random_state=0)
    model.fit(logit(np.asarray(scores_fit, dtype=float)).reshape(-1, 1), y_fit)
    return model.predict_proba(logit(np.asarray(scores_apply, dtype=float)).reshape(-1, 1))[:, 1]


def lifelines_imports() -> bool:
    try:
        import lifelines  # noqa: F401
    except Exception:
        return False
    return True


ISOTONIC_MIN_N = 400
EPV_MIN = 100

REASON_PHRASES = {
    "visits": ("мало визитов до покупки", "много визитов до покупки"),
    "recency": ("покупал недавно", "давно не покупал"),
    "revenue": ("небольшой первый чек", "крупный первый чек"),
    "orders": ("мало заказов до этой даты", "уже были заказы"),
}


def assert_epv(positives: int) -> None:
    if positives < EPV_MIN:
        raise RuntimeError("EPV refused: fewer than 100 positives; RFM only, not shadow")


def fit_elastic_net(train: list[dict], features: list[str]):
    from sklearn.linear_model import LogisticRegression

    x_train = _matrix(train, features)
    y_train = np.array([int(row["repeat"]) for row in train])
    center = x_train.mean(axis=0)
    scale = x_train.std(axis=0)
    scale[scale < 1e-6] = 1
    model = LogisticRegression(penalty="elasticnet", solver="saga", l1_ratio=0.5, C=1.0, max_iter=600, random_state=0, tol=1e-3)
    if len(set(y_train.tolist())) < 2:
        point = float(y_train.mean()) if len(y_train) else 0.0

        def predict_constant(rows: list[dict]) -> np.ndarray:
            return np.full(len(rows), point)

        return {"predict": predict_constant, "coef": [0.0] * len(features), "center": center, "scale": scale, "features": features}
    model.fit((x_train - center) / scale, y_train)

    def predict(rows: list[dict]) -> np.ndarray:
        values = (_matrix(rows, features) - center) / scale
        return model.predict_proba(values)[:, 1]

    return {"predict": predict, "coef": model.coef_.ravel(), "center": center, "scale": scale, "features": features}


def isotonic_calibrate(y_fit: np.ndarray, scores_fit: np.ndarray, scores_apply: np.ndarray) -> np.ndarray:
    from sklearn.isotonic import IsotonicRegression

    y_fit = np.asarray(y_fit).astype(int)
    if len(set(y_fit.tolist())) < 2:
        return np.asarray(scores_apply, dtype=float)
    model = IsotonicRegression(out_of_bounds="clip")
    model.fit(np.asarray(scores_fit, dtype=float), y_fit)
    return model.predict(np.asarray(scores_apply, dtype=float))


def choose_calibrator(y_fit: np.ndarray, scores_fit: np.ndarray, scores_apply: np.ndarray) -> tuple[np.ndarray, str]:
    if len(y_fit) >= ISOTONIC_MIN_N:
        return isotonic_calibrate(y_fit, scores_fit, scores_apply), "isotonic"
    return platt_calibrate(y_fit, scores_fit, scores_apply), "platt"


def reason_phrases(row: dict, fitted: dict, limit: int = 3) -> list[str]:
    ranked = []
    for name, coef, center, scale in zip(fitted["features"], fitted["coef"], fitted["center"], fitted["scale"]):
        z = (float(row[name]) - float(center)) / float(scale if scale else 1)
        ranked.append((abs(float(coef) * z), name, z))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    words = []
    for _magnitude, name, z in ranked[:limit]:
        pair = REASON_PHRASES.get(name)
        if pair is None:
            words.append("признак ниже обычного для среза" if z < 0 else "признак выше обычного для среза")
        else:
            words.append(pair[0] if z < 0 else pair[1])
    return words


def nested_feature_cv(rows: list[dict], features: list[str]) -> dict:
    """Outer time split, inner leave-one-feature check on the train half. Synthetic only."""
    train, test = time_split(rows)
    if len(features) < 2 or len({int(row["repeat"]) for row in train}) < 2:
        return {"selected": list(features), "outer_pr_auc": None}
    best_names = list(features)
    best_score = -1.0
    candidates = [list(features)] + [[name for name in features if name != drop] for drop in features]
    inner_cut = max(1, int(len(train) * 0.7))
    inner_train, inner_test = train[:inner_cut], train[inner_cut:]
    if len({int(row["repeat"]) for row in inner_test}) < 2:
        inner_test = train[-max(2, len(train) // 5) :]
        inner_train = train[: len(train) - len(inner_test)]
    for names in candidates:
        if len({int(row["repeat"]) for row in inner_train}) < 2:
            continue
        predicted, _ = elastic_net_proba(inner_train, inner_test, names)
        score = average_precision(np.array([row["repeat"] for row in inner_test], dtype=float), predicted)
        if score > best_score:
            best_score = score
            best_names = names
    outer, _ = elastic_net_proba(train, test, best_names)
    outer_score = average_precision(np.array([row["repeat"] for row in test], dtype=float), outer)
    return {"selected": best_names, "inner_pr_auc": best_score, "outer_pr_auc": outer_score, "synthetic": True}


def permutation_importance(train: list[dict], test: list[dict], features: list[str], seed: int = 4) -> list[dict]:
    fitted = fit_elastic_net(train, features)
    y = np.array([row["repeat"] for row in test], dtype=float)
    base = average_precision(y, fitted["predict"](test))
    rng = np.random.default_rng(seed)
    rows = []
    for name in features:
        drops = []
        for _ in range(6):
            shuffled = [dict(row) for row in test]
            order = rng.permutation(len(shuffled))
            values = [shuffled[int(index)][name] for index in order]
            for row, value in zip(shuffled, values):
                row[name] = value
            drops.append(base - average_precision(y, fitted["predict"](shuffled)))
        rows.append({"feature": name, "drop": float(np.mean(drops)), "synthetic": True})
    rows.sort(key=lambda item: -item["drop"])
    return rows


def conformal_interval(y_cal: np.ndarray, scores_cal: np.ndarray, scores_new: np.ndarray, alpha: float = 0.1) -> dict:
    """Split-conformal band on scores. No refit. Wide bands abstain."""
    residual = np.abs(np.asarray(y_cal, dtype=float) - np.asarray(scores_cal, dtype=float))
    if not len(residual):
        return {"quantile": 1.0, "low": [], "high": [], "abstain": []}
    quantile = float(np.quantile(residual, min(1.0, (1 - alpha) * (len(residual) + 1) / len(residual))))
    scores = np.asarray(scores_new, dtype=float)
    low = np.clip(scores - quantile, 0, 1)
    high = np.clip(scores + quantile, 0, 1)
    return {
        "quantile": quantile,
        "low": low.tolist(),
        "high": high.tolist(),
        "abstain": (high - low > 0.4).tolist(),
        "shap": "waiting for GBM",
    }


def cox_elastic_net(train: list[dict], test: list[dict], features: list[str], step1_scores: np.ndarray) -> dict:
    """Survival elastic net on a synthetic duration. Stays off the production path unless it beats step 1."""
    try:
        from lifelines import CoxPHFitter
        import pandas as pd
    except Exception as error:
        return {"available": False, "error": type(error).__name__, "beats_step1": False, "synthetic": True}

    def frame(rows: list[dict]):
        data = []
        for row in rows:
            event = int(row["repeat"])
            duration = max(1.0, float(15 + row["recency"] * (0.35 if event else 1)))
            item = {name: float(row[name]) for name in features}
            item["duration"] = duration
            item["event"] = event
            data.append(item)
        return pd.DataFrame(data)

    try:
        model = CoxPHFitter(penalizer=0.1, l1_ratio=0.5)
        model.fit(frame(train), duration_col="duration", event_col="event")
        risk = np.asarray(model.predict_partial_hazard(frame(test))).ravel()
        y = np.array([row["repeat"] for row in test], dtype=float)
        pr = average_precision(y, risk)
        step1 = average_precision(y, step1_scores)
        return {
            "available": True,
            "pr_auc": pr,
            "step1_pr_auc": step1,
            "beats_step1": bool(pr > step1),
            "penalizer": 0.1,
            "l1_ratio": 0.5,
            "synthetic": True,
        }
    except Exception as error:
        return {"available": False, "error": type(error).__name__, "beats_step1": False, "synthetic": True}


def synthetic_nonbuyers(n: int = 240, seed: int = 9) -> list[dict]:
    """Synthetic goal 2a. Censored rows keep label None, not zero. Not a screen fact."""
    rng = np.random.default_rng(seed)
    rows = []
    start = date(2024, 1, 2)
    for index in range(n):
        visits = float(rng.integers(1, 12))
        pdp = float(rng.integers(0, 8))
        cart = int(rng.random() < 0.35)
        days = float(rng.integers(0, 40))
        follow = float(rng.integers(5, 60))
        logit = -2.4 + 0.62 * visits + 0.08 * pdp + 0.2 * cart
        probability = 1 / (1 + np.exp(-logit))
        bought = int(rng.random() < probability)
        censored = follow < 30 and not bought
        rows.append(
            {
                "id": f"nb-{index:04d}",
                "t_visit": (start + timedelta(days=index)).isoformat(),
                "visits": visits,
                "pdp": pdp,
                "cart": cart,
                "days": days,
                "follow": follow,
                "censored": censored,
                "label": None if censored else bought,
            }
        )
    return rows


def abandoned_cart_scores(rows: list[dict]) -> np.ndarray:
    return np.array([1.0 if int(row["cart"]) == 1 else 0.0 for row in rows], dtype=float)


def nonbuyer_versus_baseline() -> dict:
    """Elastic net versus the 7-day abandoned-cart rule on uncensored synthetic rows.

    The generator's logit puts more weight on visits than on the cart flag, and the
    fit uses those same columns. A gap whose interval crosses zero on this fixture
    is a small held-out negative class, not a missed feature.
    """
    raw = synthetic_nonbuyers()
    rows = []
    for row in raw:
        if row["label"] is None:
            continue
        rows.append({**row, "repeat": int(row["label"]), "t1": row["t_visit"]})
    train, test = time_split(rows)
    features = ["visits", "pdp", "cart"]
    model_scores, _ = elastic_net_proba(train, test, features)
    fitted = fit_elastic_net(train, features)
    y = np.array([row["repeat"] for row in test], dtype=float)
    baseline = abandoned_cart_scores(test)
    gap = bootstrap_gap(y, model_scores, baseline, average_precision, reps=80, seed=9)
    oracle = np.array(
        [
            1 / (1 + np.exp(-(-2.4 + 0.62 * row["visits"] + 0.08 * row["pdp"] + 0.2 * row["cart"])))
            for row in test
        ],
        dtype=float,
    )
    oracle_gap = bootstrap_gap(y, oracle, baseline, average_precision, reps=80, seed=9)
    censored = sum(1 for row in raw if row["censored"])
    return {
        "synthetic": True,
        "censored": censored,
        "censored_are_not_zero": all(row["label"] is None for row in raw if row["censored"]),
        "test_n": len(test),
        "test_positives": int(y.sum()),
        "coefficients": {name: float(coef) for name, coef in zip(features, fitted["coef"])},
        "model_pr_auc": average_precision(y, model_scores),
        "baseline_pr_auc": average_precision(y, baseline),
        "gap_pr_auc": gap,
        "oracle_gap_pr_auc": oracle_gap,
        "beats_baseline": gap["low"] > 0,
        "sentence": "Synthetic non-buyer fixture. Not a screen fact. Not a measured lift.",
    }


def build_model_card(rows: list[dict] | None = None) -> dict:
    rows = [dict(row) for row in (rows or synthetic_rows())]
    leaked_names = [*FEATURES, "repeat_copy"]
    for row in rows:
        row["repeat_copy"] = row["repeat"]
    used, flagged = features_without_leakage(rows, leaked_names)
    if "repeat_copy" not in flagged:
        raise RuntimeError("a feature that copies the label was not flagged")
    train, test = time_split(rows)
    if not train or not test or train[-1]["t1"] > test[0]["t1"]:
        raise RuntimeError("time split did not follow cohort date")
    baseline = rfm_scores(train, test)
    bg_scores, bg_name = beta_geometric_scores(train, test)
    model_scores, train_scores = elastic_net_proba(train, test, used)
    y_test = np.array([row["repeat"] for row in test], dtype=float)
    y_train = np.array([row["repeat"] for row in train], dtype=float)
    calibrated, calibration_method = choose_calibrator(y_train, train_scores, model_scores)
    fitted = fit_elastic_net(train, used)
    reasons = reason_phrases(test[0], fitted) if test else []
    nested = nested_feature_cv(rows, used)
    importance = permutation_importance(train, test, used)
    conformal = conformal_interval(y_train, train_scores, model_scores)
    cox = cox_elastic_net(train, test, used, model_scores)
    production = "cox-elastic-net" if cox.get("beats_step1") else "elastic-net-logistic"
    gap_pr = bootstrap_gap(y_test, model_scores, baseline, average_precision, seed=7)
    gap_brier = bootstrap_gap(y_test, baseline, model_scores, brier, seed=8)
    beats = gap_pr["low"] > 0 or gap_brier["low"] > 0
    cv_rows = train
    cv = repeated_stratified_cv(cv_rows, used, repeats=3, folds=3, seed=2)
    return {
        "synthetic": True,
        "mode": "shadow",
        "model": "elastic-net-logistic",
        "baseline": "rfm-tertile-and-role",
        "bg_nbd": bg_name,
        "lifelines": lifelines_imports(),
        "cox": cox,
        "production_model": production,
        "calibration_method": calibration_method,
        "reason_codes": reasons,
        "nested_cv": nested,
        "permutation_importance": importance,
        "conformal": {"quantile": conformal["quantile"], "abstain_share": float(np.mean(conformal["abstain"])) if conformal["abstain"] else 0.0, "shap": conformal["shap"]},
        "features": used,
        "leakage_flagged": flagged,
        "train_n": len(train),
        "test_n": len(test),
        "train_t1_max": train[-1]["t1"],
        "test_t1_min": test[0]["t1"],
        "beats_rfm": beats,
        "metrics": {
            "pr_auc": bootstrap_metric(y_test, model_scores, average_precision, seed=11),
            "lift_at_20": bootstrap_metric(y_test, model_scores, lift_at_20, seed=12),
            "brier": bootstrap_metric(y_test, model_scores, brier, seed=13),
            "baseline_pr_auc": bootstrap_metric(y_test, baseline, average_precision, seed=14),
            "baseline_brier": bootstrap_metric(y_test, baseline, brier, seed=15),
            "bg_brier": bootstrap_metric(y_test, bg_scores, brier, seed=16),
            "gap_pr_auc": gap_pr,
            "gap_brier": gap_brier,
        },
        "cv": cv,
        "calibration": calibration_curve(y_test, calibrated, bins=5),
        "sentence": "Synthetic fixture. Not a screen fact. Not a measured lift.",
    }


def pooled_rows(brands: list[dict]) -> list[dict]:
    rows = []
    for brand in brands:
        if brand.get("pooling_consent") is not True:
            continue
        for row in brand["rows"]:
            rows.append({**row, "brand_id": brand["id"]})
    return rows


def category_versus_brand() -> dict:
    """Two synthetic brands. A pooled fit uses only pooling_consent rows."""
    small_train = synthetic_rows(36, seed=21, brand="small")
    small_test = synthetic_rows(90, seed=22, brand="small")
    donor = synthetic_rows(240, seed=23, brand="donor")
    secret = synthetic_rows(40, seed=24, brand="secret")
    brands = [
        {"id": "small", "pooling_consent": True, "rows": small_train},
        {"id": "donor", "pooling_consent": True, "rows": donor},
        {"id": "secret", "pooling_consent": False, "rows": secret},
    ]
    pool = pooled_rows(brands)
    features = list(FEATURES)
    brand_scores, _ = elastic_net_proba(small_train, small_test, features)
    category_scores, _ = elastic_net_proba(pool, small_test, features)
    y = np.array([row["repeat"] for row in small_test], dtype=float)
    gap = bootstrap_gap(y, category_scores, brand_scores, average_precision, reps=200, seed=19)
    return {
        "brand_positives": sum(int(row["repeat"]) for row in small_train),
        "pool_ids": sorted({row["brand_id"] for row in pool}),
        "gap_pr_auc": gap,
        "beats": gap["low"] > 0,
    }


def synthetic_uplift(n: int = 500, seed: int = 5) -> dict:
    """Treatment effect is larger when x is low. Propensity is larger when x is high."""
    rng = np.random.default_rng(seed)
    x = rng.random(n)
    propensity = 1 / (1 + np.exp(-(-1.4 + 3.0 * x)))
    treated = (rng.random(n) < propensity).astype(int)
    probability = 1 / (1 + np.exp(-(-1.1 + 0.3 * x + treated * (2.2 * (1 - x)))))
    outcome = (rng.random(n) < probability).astype(int)
    return {"x": x, "treated": treated, "outcome": outcome, "propensity": propensity}


def _logit_fit(x: np.ndarray, y: np.ndarray, x_new: np.ndarray) -> np.ndarray:
    from sklearn.linear_model import LogisticRegression

    if len(x) < 8 or len(set(y.astype(int).tolist())) < 2:
        return np.full(len(x_new), float(y.mean()) if len(y) else 0.0)
    model = LogisticRegression(max_iter=200, random_state=0)
    model.fit(x.reshape(-1, 1), y.astype(int))
    return model.predict_proba(x_new.reshape(-1, 1))[:, 1]


def t_learner_uplift(x: np.ndarray, treated: np.ndarray, outcome: np.ndarray) -> np.ndarray:
    treated_mask = treated == 1
    control_mask = ~treated_mask
    treated_score = _logit_fit(x[treated_mask], outcome[treated_mask], x)
    control_score = _logit_fit(x[control_mask], outcome[control_mask], x)
    return treated_score - control_score


def qini_curve(outcome: np.ndarray, treated: np.ndarray, scores: np.ndarray) -> list[dict]:
    order = np.argsort(-np.asarray(scores, dtype=float), kind="mergesort")
    y = np.asarray(outcome, dtype=float)[order]
    t = np.asarray(treated, dtype=float)[order]
    treat_hits = control_hits = treat_n = control_n = 0.0
    curve = []
    step = max(1, len(y) // 10)
    for index in range(len(y)):
        if t[index] == 1:
            treat_n += 1
            treat_hits += y[index]
        else:
            control_n += 1
            control_hits += y[index]
        if (index + 1) % step == 0 or index + 1 == len(y):
            incremental = 0.0
            if treat_n > 0 and control_n > 0:
                incremental = treat_hits - control_hits * (treat_n / control_n)
            curve.append({"k": int(index + 1), "incremental": float(incremental)})
    return curve


def qini_area(curve: list[dict]) -> float:
    if not curve:
        return 0.0
    return float(np.trapezoid([row["incremental"] for row in curve], [row["k"] for row in curve]))


def uplift_versus_propensity() -> dict:
    sample = synthetic_uplift()
    uplift = t_learner_uplift(sample["x"], sample["treated"], sample["outcome"])
    uplift_curve = qini_curve(sample["outcome"], sample["treated"], uplift)
    propensity_curve = qini_curve(sample["outcome"], sample["treated"], sample["propensity"])
    uplift_area = qini_area(uplift_curve)
    propensity_area = qini_area(propensity_curve)
    return {
        "uplift_curve": uplift_curve,
        "propensity_curve": propensity_curve,
        "uplift_area": uplift_area,
        "propensity_area": propensity_area,
        "beats": uplift_area > propensity_area,
    }
