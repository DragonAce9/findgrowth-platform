/**
 * Nonparametric helpers. Published checks in stats.test.ts use absolute tolerance 1e-4
 * (Wilson, chi-square survival, Fisher). Bootstrap intervals are seed-stable, not a table lookup.
 */

const Z95 = 1.959963984540054;

/** Two-sided type I error used by Wilson intervals and by linear alpha spending. */
export const DEFAULT_ALPHA = 0.05;

/**
 * Lan–DeMets linear alpha spending for one two-sided look.
 * Information fraction t is in (0, 1]. Spent error is α(t) = α · t.
 * The critical z is Φ⁻¹(1 − α(t)/2). At t = 1 this is the usual z_{α/2}
 * (≈ 1.96 when α = 0.05). An earlier look has spent only part of α, so z is
 * larger and a Wilson interval that uses it is wider. This is not a Pocock boundary.
 */
export function linearAlphaSpendingZ(information: number, alpha = DEFAULT_ALPHA): number {
  if (!(alpha > 0 && alpha < 1)) throw new Error("alpha must be in (0, 1)");
  const t = Math.min(1, Math.max(information, 1e-9));
  return inverseNormal(1 - (alpha * t) / 2);
}

export function linearSpentAlpha(information: number, alpha = DEFAULT_ALPHA): number {
  const t = Math.min(1, Math.max(information, 0));
  return alpha * t;
}

/** Acklam's rational approximation of the standard normal quantile. */
export function inverseNormal(p: number): number {
  if (!(p > 0 && p < 1)) throw new Error("inverseNormal expects p in (0, 1)");
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(
        (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
      )
    );
  }
  q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

export interface ProportionInterval {
  p: number;
  n: number;
  successes: number;
  low: number;
  high: number;
}

export function wilsonInterval(successes: number, n: number, z = Z95): ProportionInterval {
  if (n <= 0) return { p: 0, n: 0, successes: 0, low: 0, high: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return {
    p,
    n,
    successes,
    low: clamp01(center - margin),
    high: clamp01(center + margin),
  };
}

/** Newcombe hybrid score interval for p1 - p2. */
export function diffProportions(
  successes1: number,
  n1: number,
  successes2: number,
  n2: number,
  z = Z95,
): { diff: number; low: number; high: number; p1: number; p2: number } {
  const w1 = wilsonInterval(successes1, n1, z);
  const w2 = wilsonInterval(successes2, n2, z);
  const diff = w1.p - w2.p;
  const low = diff - Math.sqrt((w1.p - w1.low) ** 2 + (w2.high - w2.p) ** 2);
  const high = diff + Math.sqrt((w1.high - w1.p) ** 2 + (w2.p - w2.low) ** 2);
  return { diff, low, high, p1: w1.p, p2: w2.p };
}

export interface BootstrapInterval {
  mean: number;
  low: number;
  high: number;
}

export function bootstrapMean(
  values: number[],
  options?: { reps?: number; seed?: number; alpha?: number },
): BootstrapInterval {
  const reps = options?.reps ?? 1000;
  const alpha = options?.alpha ?? 0.05;
  const n = values.length;
  if (!n) return { mean: 0, low: 0, high: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const samples = resample(values, reps, options?.seed ?? 1, (draw) => draw.reduce((sum, value) => sum + value, 0) / n);
  return { mean, ...percentile(samples, alpha) };
}

export function bootstrapProportion(
  flags: Array<number | boolean>,
  options?: { reps?: number; seed?: number; alpha?: number },
): BootstrapInterval {
  const values = flags.map((flag) => (flag ? 1 : 0));
  return bootstrapMean(values, options);
}

/** Upper tail P(X > x) for chi-square with any positive df, via the regularized gamma Q(df/2, x/2). */
export function chiSquareSurvival(x: number, df: number): number {
  if (df <= 0) return 1;
  if (x <= 0) return 1;
  const a = df / 2;
  const z = x / 2;
  if (z < a + 1) return clamp01(1 - gammaPSeries(a, z));
  return clamp01(gammaQFraction(a, z));
}

/**
 * Two-sided Fisher exact p-value for the 2×2 table
 * | a b |
 * | c d |
 */
export function fisherExact(a: number, b: number, c: number, d: number): number {
  const row1 = a + b;
  const col1 = a + c;
  const n = a + b + c + d;
  const lo = Math.max(0, row1 + col1 - n);
  const hi = Math.min(row1, col1);
  const observed = logHypergeometric(a, row1, col1, n);
  let sum = 0;
  for (let aa = lo; aa <= hi; aa += 1) {
    const lp = logHypergeometric(aa, row1, col1, n);
    if (lp <= observed + 1e-12) sum += Math.exp(lp);
  }
  return clamp01(sum);
}

/** Hide a person-count in (0, k). Zero stays visible: it identifies nobody. */
export function guardK(n: number, k = 5): number | null {
  if (!Number.isFinite(n)) return null;
  if (n > 0 && n < k) return null;
  return n;
}

/** P(X > Y) for independent Beta(a1, b1) and Beta(a2, b2). Integer shapes from Beta-Binomial posteriors. */
export function betaBetaGreater(a1: number, b1: number, a2: number, b2: number): number {
  if (a1 <= 0 || b1 <= 0 || a2 <= 0 || b2 <= 0) return 0.5;
  const steps = 400;
  const h = 1 / steps;
  let sum = 0;
  for (let i = 1; i < steps; i += 1) {
    const x = i * h;
    const weight = i % 2 === 0 ? 2 : 4;
    sum += weight * betaPdf(x, a1, b1) * regularizedBeta(x, a2, b2);
  }
  return clamp01((sum * h) / 3);
}

export function lnGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  const lanczos = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  let x = lanczos[0];
  const shifted = z - 1;
  for (let i = 1; i < lanczos.length; i += 1) x += lanczos[i] / (shifted + i);
  const t = shifted + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
}

function gammaPSeries(a: number, x: number): number {
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 0; n < 200; n += 1) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

function gammaQFraction(a: number, x: number): number {
  const fpmin = 1e-300;
  let b = x + 1 - a;
  let c = 1 / fpmin;
  let d = 1 / Math.max(Math.abs(b), fpmin);
  if (b < 0) d = -d;
  let h = d;
  for (let i = 1; i <= 200; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < fpmin) d = fpmin * Math.sign(d || 1);
    c = b + an / c;
    if (Math.abs(c) < fpmin) c = fpmin * Math.sign(c || 1);
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

function logHypergeometric(a: number, row1: number, col1: number, n: number): number {
  const b = row1 - a;
  const c = col1 - a;
  const d = n - a - b - c;
  return lnGamma(row1 + 1) + lnGamma(n - row1 + 1) + lnGamma(col1 + 1) + lnGamma(n - col1 + 1)
    - (lnGamma(a + 1) + lnGamma(b + 1) + lnGamma(c + 1) + lnGamma(d + 1) + lnGamma(n + 1));
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBt = a * Math.log(x) + b * Math.log(1 - x) - (lnGamma(a) + lnGamma(b) - lnGamma(a + b));
  const bt = Math.exp(lnBt);
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

function betacf(a: number, b: number, x: number): number {
  const fpmin = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}

function betaPdf(x: number, a: number, b: number): number {
  if (x <= 0 || x >= 1) return 0;
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - (lnGamma(a) + lnGamma(b) - lnGamma(a + b)));
}

function resample(values: number[], reps: number, seed: number, reduce: (draw: number[]) => number): number[] {
  const rand = mulberry32(seed);
  const n = values.length;
  const samples: number[] = [];
  for (let i = 0; i < reps; i += 1) {
    const draw: number[] = [];
    for (let j = 0; j < n; j += 1) draw.push(values[Math.floor(rand() * n)]);
    samples.push(reduce(draw));
  }
  samples.sort((a, b) => a - b);
  return samples;
}

function percentile(sorted: number[], alpha: number): { low: number; high: number } {
  const reps = sorted.length;
  const low = sorted[Math.max(0, Math.floor((alpha / 2) * reps))];
  const high = sorted[Math.min(reps - 1, Math.ceil((1 - alpha / 2) * reps) - 1)];
  return { low, high };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export interface ShrunkSegment {
  id: string;
  n: number;
  successes: number;
  raw: number;
  shrunk: number;
  low: number;
  high: number;
}

/** Empirical Bayes: method-of-moments Beta prior, posterior mean and equal-tail interval. */
export function empiricalBayesShrink(segments: Array<{ id: string; successes: number; n: number }>): ShrunkSegment[] {
  const usable = segments.filter((segment) => segment.n > 0);
  const totalS = usable.reduce((sum, segment) => sum + segment.successes, 0);
  const totalN = usable.reduce((sum, segment) => sum + segment.n, 0);
  const mu = totalN ? clamp01(totalS / totalN) : 0.5;
  let weighted = 0;
  for (const segment of usable) {
    const p = segment.successes / segment.n;
    weighted += segment.n * (p - mu) ** 2;
  }
  const variance = totalN ? weighted / totalN : 0;
  const sampling = usable.length && totalN ? (mu * (1 - mu) * usable.length) / totalN : 0;
  const between = Math.max(variance - sampling, 0);
  const cap = mu * (1 - mu);
  let kappa = 2;
  if (between > 1e-8 && cap > between) kappa = cap / between - 1;
  else if (between <= 1e-8) kappa = 40;
  if (!Number.isFinite(kappa) || kappa < 0.5) kappa = 0.5;
  const priorA = Math.max(mu * kappa, 0.5);
  const priorB = Math.max((1 - mu) * kappa, 0.5);
  return segments.map((segment) => {
    const alpha = priorA + segment.successes;
    const beta = priorB + Math.max(segment.n - segment.successes, 0);
    const shrunk = alpha / (alpha + beta);
    return {
      id: segment.id,
      n: segment.n,
      successes: segment.successes,
      raw: segment.n ? segment.successes / segment.n : 0,
      shrunk,
      low: betaQuantile(0.025, alpha, beta),
      high: betaQuantile(0.975, alpha, beta),
    };
  });
}

/** Benjamini–Hochberg at level q. A segment is marked only after this correction. */
export function benjaminiHochberg(pValues: number[], q = 0.05): boolean[] {
  const n = pValues.length;
  const order = pValues.map((p, index) => ({ p: Number.isFinite(p) ? p : 1, index })).sort((a, b) => a.p - b.p);
  const reject = Array<boolean>(n).fill(false);
  let cutoff = -1;
  for (let k = 0; k < n; k += 1) {
    if (order[k].p <= (q * (k + 1)) / n) cutoff = k;
  }
  for (let k = 0; k <= cutoff; k += 1) reject[order[k].index] = true;
  return reject;
}

export interface SegmentRead {
  id: string;
  n: number;
  raw: number;
  shrunk: number;
  low: number;
  high: number;
  differs: boolean;
}

/** Shrunk rate plus a BH flag against the pooled rate. The flag is not called "significant". */
export function segmentReads(segments: Array<{ id: string; successes: number; n: number }>): SegmentRead[] {
  const shrunk = empiricalBayesShrink(segments);
  const totalS = segments.reduce((sum, segment) => sum + segment.successes, 0);
  const totalN = segments.reduce((sum, segment) => sum + segment.n, 0);
  const pooled = totalN ? totalS / totalN : 0;
  const pValues = segments.map((segment) => {
    if (segment.n <= 0 || pooled <= 0 || pooled >= 1) return 1;
    const p = segment.successes / segment.n;
    const z2 = (p - pooled) ** 2 / ((pooled * (1 - pooled)) / segment.n);
    return chiSquareSurvival(z2, 1);
  });
  const flags = benjaminiHochberg(pValues);
  return shrunk.map((row, index) => ({
    id: row.id,
    n: row.n,
    raw: row.raw,
    shrunk: row.shrunk,
    low: row.low,
    high: row.high,
    differs: flags[index] === true,
  }));
}

export interface MovePosterior {
  brandId: string;
  moveId: string;
  treatmentAlpha: number;
  treatmentBeta: number;
  controlAlpha: number;
  controlBeta: number;
}

export const MOVE_THRESHOLDS = { scaleAt: 0.9, stopAt: 0.1 };

export function accumulateMove(
  prior: MovePosterior | null,
  obs: {
    brandId: string;
    moveId: string;
    treatmentHits: number;
    treatmentN: number;
    controlHits: number;
    controlN: number;
  },
): MovePosterior {
  const same = prior && prior.brandId === obs.brandId && prior.moveId === obs.moveId ? prior : null;
  const base: MovePosterior = same ?? {
    brandId: obs.brandId,
    moveId: obs.moveId,
    treatmentAlpha: 1,
    treatmentBeta: 1,
    controlAlpha: 1,
    controlBeta: 1,
  };
  return {
    brandId: obs.brandId,
    moveId: obs.moveId,
    treatmentAlpha: base.treatmentAlpha + obs.treatmentHits,
    treatmentBeta: base.treatmentBeta + Math.max(obs.treatmentN - obs.treatmentHits, 0),
    controlAlpha: base.controlAlpha + obs.controlHits,
    controlBeta: base.controlBeta + Math.max(obs.controlN - obs.controlHits, 0),
  };
}

export function moveDecision(prob: number, thresholds = MOVE_THRESHOLDS): "scale" | "stop" | "continue" {
  if (prob >= thresholds.scaleAt) return "scale";
  if (prob <= thresholds.stopAt) return "stop";
  return "continue";
}

export const MOVE_DECISION_RU: Record<ReturnType<typeof moveDecision>, string> = {
  scale: "масштабировать",
  stop: "остановить",
  continue: "продолжать",
};

export type EvidenceLevel = "enough" | "thin" | "hidden";
export type EvidenceRule = "people" | "lookalike" | "experiment" | "support" | "cycle";

const EVIDENCE: Record<EvidenceRule, { hideBelow: number; enoughAt: number; hidden: string; thin: string; enough: string }> = {
  people: { hideBelow: 5, enoughAt: 5, hidden: "меньше пяти человек", thin: "мало данных", enough: "данных достаточно" },
  lookalike: { hideBelow: 5, enoughAt: 30, hidden: "меньше пяти человек", thin: "мало данных для сравнения устройств", enough: "данных достаточно" },
  experiment: { hideBelow: 5, enoughAt: 50, hidden: "меньше пяти человек", thin: "мало данных: в варианте меньше пятидесяти", enough: "данных достаточно" },
  support: { hideBelow: 2, enoughAt: 2, hidden: "пара не показывается", thin: "мало данных", enough: "данных достаточно" },
  cycle: { hideBelow: 1, enoughAt: 8, hidden: "цикла нет", thin: "мало данных: усадка к приору категории", enough: "данных достаточно" },
};

/** One screen state. Thresholds stay on the rule; the words are shared. */
export function evidenceState(n: number, rule: EvidenceRule): { level: EvidenceLevel; reason: string } {
  const spec = EVIDENCE[rule];
  if (!Number.isFinite(n)) return { level: "hidden", reason: spec.hidden };
  if (rule === "people" && n === 0) return { level: "enough", reason: "ноль, никого не идентифицирует" };
  if (n > 0 && n < spec.hideBelow) return { level: "hidden", reason: spec.hidden };
  if (n < spec.enoughAt) return { level: "thin", reason: spec.thin };
  return { level: "enough", reason: spec.enough };
}

export function shownPeople(n: number): { level: EvidenceLevel; value: number | null; text: string } {
  const state = evidenceState(n, "people");
  if (state.level === "hidden") return { level: "hidden", value: null, text: "меньше 5" };
  return { level: state.level, value: n, text: Number.isInteger(n) ? n.toLocaleString("ru-RU") : String(n) };
}

function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 48; i += 1) {
    const mid = (lo + hi) / 2;
    if (regularizedBeta(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
