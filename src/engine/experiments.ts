import { formatCount } from "./client-copy";
import { chiSquareSurvival } from "./stats";
import type { ExposureRow } from "./types";

export interface ExperimentReadiness {
  experiment_id: string;
  n: Record<string, number>;
  srm_p: number;
  duration_days: number;
  mde: number;
  observed_lift: number | null;
  ready: boolean;
  blockers: string[];
  overlap_warning: boolean;
}

const POST_SLICES = new Set(["reached_checkout", "reached_checkout_after", "purchased"]);

export function queryExperimentSlices(
  rows: ExposureRow[],
  experimentId: string,
  dimension: string,
): Array<Record<string, string | number>> {
  if (POST_SLICES.has(dimension)) {
    throw new Error(`Пост-срез ${dimension} запрещён: измерение известно только до показа`);
  }
  const allowed = new Set(["device_type", "channel_group", "user_type", "in_holdout"]);
  if (!allowed.has(dimension)) {
    throw new Error(`Срез ${dimension} не входит в pre-exposure список`);
  }
  const first = firstExposures(rows).filter((row) => row.experiment_id === experimentId);
  const counts = new Map<string, number>();
  for (const row of first) {
    const key = String(row[dimension as keyof ExposureRow]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([value, n]) => ({ [dimension]: value, n }));
}

export function experimentReadiness(rows: ExposureRow[], asOf: string): ExperimentReadiness[] {
  const first = firstExposures(rows);
  const byExperiment = new Map<string, ExposureRow[]>();
  for (const row of first) {
    const list = byExperiment.get(row.experiment_id) ?? [];
    list.push(row);
    byExperiment.set(row.experiment_id, list);
  }
  const entityExperiments = new Map<string, Set<string>>();
  for (const row of first) {
    const set = entityExperiments.get(row.entity_id) ?? new Set();
    set.add(row.experiment_id);
    entityExperiments.set(row.entity_id, set);
  }
  const overlapped = new Set<string>();
  for (const [entity, names] of entityExperiments) {
    if (names.size > 1) {
      for (const name of names) overlapped.add(name);
    }
    void entity;
  }
  const asOfMs = Date.parse(asOf);
  return [...byExperiment.entries()].map(([experimentId, exposures]) => {
    const n: Record<string, number> = {};
    let minTs = Infinity;
    let maxTs = -Infinity;
    for (const row of exposures) {
      n[row.variant] = (n[row.variant] ?? 0) + 1;
      const ts = Date.parse(row.exposed_at);
      minTs = Math.min(minTs, ts);
      maxTs = Math.max(maxTs, ts);
    }
    const variants = Object.keys(n);
    const total = variants.reduce((sum, key) => sum + n[key], 0);
    const expected = total / Math.max(variants.length, 1);
    let chi = 0;
    for (const key of variants) chi += (n[key] - expected) ** 2 / Math.max(expected, 1e-9);
    const srmP = variants.length > 1 ? chiSquareSurvival(chi, variants.length - 1) : 1;
    const durationDays = Number.isFinite(minTs) ? (asOfMs - minTs) / 86_400_000 : 0;
    const successes = exposures.filter((row) => row.reached_checkout_after).length;
    const baseline = total ? (successes + 0.5) / (total + 1) : 0.5;
    const mde = minimumDetectableEffect(baseline, n, variants);
    const blockers: string[] = [];
    if (variants.some((key) => n[key] < 50)) blockers.push("n par variante inférieur à 50");
    if (srmP < 0.001) blockers.push("SRM : les parts ne correspondent pas au plan");
    if (durationDays < 7) blockers.push("durée inférieure à 7 jours");
    return {
      experiment_id: experimentId,
      n,
      srm_p: round(srmP),
      duration_days: round(durationDays),
      mde: round(mde),
      observed_lift: null,
      ready: blockers.length === 0,
      blockers,
      overlap_warning: overlapped.has(experimentId),
    };
  });
}

export function assertRolloutAllowed(readiness: ExperimentReadiness): void {
  if (!readiness.ready) {
    throw new Error(`Раскатка запрещена: ${readiness.blockers.join("; ")}`);
  }
}

function firstExposures(rows: ExposureRow[]): ExposureRow[] {
  const best = new Map<string, ExposureRow>();
  for (const row of rows) {
    const key = `${row.experiment_id}:${row.entity_id}`;
    const current = best.get(key);
    if (!current || row.exposed_at < current.exposed_at) best.set(key, row);
  }
  return [...best.values()];
}

const Z_ALPHA = 1.959963984540054;
const Z_POWER = 0.841621233572914;

/** Two-proportion MDE at alpha 0.05 and power 0.8. Baseline p comes from the caller, not a hardcoded 0.05. */
export function minimumDetectableEffect(baseline: number, n: Record<string, number>, variants: string[]): number {
  const p = Math.min(0.999, Math.max(0.001, baseline));
  if (variants.length < 2) return 1;
  const control = variants.includes("control") ? "control" : variants[0];
  const others = variants.filter((key) => key !== control);
  const controlN = Math.max(n[control] ?? 0, 1);
  let hardest = 0;
  for (const key of others) {
    const otherN = Math.max(n[key] ?? 0, 1);
    const effect = (Z_ALPHA + Z_POWER) * Math.sqrt(p * (1 - p) * (1 / controlN + 1 / otherN));
    if (effect > hardest) hardest = effect;
  }
  return hardest;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Control size for a two-proportion difference of `effectPp` points
 * at alpha 0.05 and power 0.8. `ratio` is n_treatment / n_control.
 * Inverse of minimumDetectableEffect for equal arms when ratio is 1.
 */
export function nControlForEffect(baseline: number, effectPp: number, ratio = 1): number {
  const p = Math.min(0.999, Math.max(0.001, baseline));
  const delta = effectPp / 100;
  if (!(delta > 0) || !(ratio > 0)) return Number.POSITIVE_INFINITY;
  const z = Z_ALPHA + Z_POWER;
  const n = (z * z * p * (1 - p) * (1 + 1 / ratio)) / (delta * delta);
  return Math.ceil(n);
}

export function powerBrief(input: { controlN: number; repeatP: number; effectPp: number }): string {
  const need = nControlForEffect(input.repeatP, input.effectPp);
  const needed = Number.isFinite(need) ? formatCount(need) : "—";
  const head = `Без письма ${formatCount(input.controlN)} человек; чтобы увидеть ${input.effectPp} п.п. при наблюдаемой доле повтора, нужно ${needed}.`;
  if (input.controlN < need) return `${head} Этот срез даст только накопление в байесовский приор, не решение.`;
  return head;
}
