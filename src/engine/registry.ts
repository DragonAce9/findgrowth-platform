import { formatRatio, STATUS_RU } from "./client-copy";
import type { OrderRow, SnapshotBucket, SnapshotLine } from "./types";

export const PSI_WARN = 0.25;

export interface HeldOutScores {
  prAuc: number;
  brier: number;
}

export interface ChampionDecision {
  status: "champion" | "challenger";
  killed: boolean;
  audit: string;
}

/** A new model is champion only when its held-out PR-AUC beats the current one. A worse Brier kills that promotion. */
export function decideChampion(input: {
  candidate: HeldOutScores;
  champion: HeldOutScores | null;
  baselineBrier: number;
  brierMargin: number;
}): ChampionDecision {
  if (input.candidate.brier > input.baselineBrier + input.brierMargin) {
    return {
      status: "challenger",
      killed: true,
      audit: `kill-switch: Brier ${input.candidate.brier} is worse than baseline ${input.baselineBrier} by more than ${input.brierMargin}`,
    };
  }
  if (!input.champion || input.candidate.prAuc > input.champion.prAuc) {
    return {
      status: "champion",
      killed: false,
      audit: input.champion
        ? `champion: held-out PR-AUC ${input.candidate.prAuc} beat ${input.champion.prAuc}`
        : `champion: no current champion, held-out PR-AUC ${input.candidate.prAuc}`,
    };
  }
  return {
    status: "challenger",
    killed: false,
    audit: `challenger: held-out PR-AUC ${input.candidate.prAuc} did not beat ${input.champion.prAuc}`,
  };
}

/** Writes score, bucket, and model version. The offer SKU and the arm stay as they were. */
export function applyShadowScores(
  lines: SnapshotLine[],
  scores: Array<{ entity_id: string; score: number; bucket: SnapshotBucket }>,
  modelVersion: string,
): SnapshotLine[] {
  const byEntity = new Map(scores.map((row) => [row.entity_id, row]));
  return lines.map((line) => {
    const score = byEntity.get(line.entity_id);
    if (!score) return { ...line };
    return { ...line, score: score.score, bucket: score.bucket, model_version: modelVersion };
  });
}

export function observedRepeatByBucket(lines: SnapshotLine[], orders: OrderRow[]): Array<{
  bucket: SnapshotBucket;
  repeated: number;
  n: number;
}> {
  const asOf = Date.parse(lines[0]?.as_of ?? "");
  const later = new Set<string>();
  for (const order of orders) {
    if (order.status !== "paid" || order.is_subscription_renewal || !order.countsAsOrder || !order.entity_id) continue;
    if (!(Date.parse(order.purchased_at) > asOf)) continue;
    later.add(order.entity_id);
  }
  const buckets: SnapshotBucket[] = ["top", "middle", "bottom"];
  return buckets.map((bucket) => {
    const people = new Set(lines.filter((line) => line.bucket === bucket).map((line) => line.entity_id));
    const repeated = [...people].filter((id) => later.has(id)).length;
    return { bucket, repeated, n: people.size };
  });
}

/** Population stability index. Bin edges come from the reference cut. */
export function populationStabilityIndex(reference: number[], current: number[], bins = 10): number {
  if (reference.length < 2 || current.length < 2) return 0;
  const sorted = [...reference].sort((a, b) => a - b);
  const edges: number[] = [];
  for (let index = 1; index < bins; index += 1) {
    edges.push(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * index) / bins))] ?? 0);
  }
  const cuts = [-Infinity, ...[...new Set(edges)].sort((a, b) => a - b), Infinity];
  const share = (values: number[]) => {
    const counts = Array.from({ length: cuts.length - 1 }, () => 0);
    for (const value of values) {
      let bin = 0;
      while (bin < cuts.length - 2 && value > (cuts[bin + 1] ?? Infinity)) bin += 1;
      counts[bin] += 1;
    }
    return counts.map((count) => Math.max(0.0001, count / values.length));
  };
  const expected = share(reference);
  const actual = share(current);
  let psi = 0;
  for (let index = 0; index < expected.length; index += 1) {
    const left = expected[index] ?? 0.0001;
    const right = actual[index] ?? 0.0001;
    psi += (right - left) * Math.log(right / left);
  }
  return psi;
}

export function psiWarning(psi: number): string | null {
  if (!(psi > PSI_WARN)) return null;
  const shown = String(Math.round(psi * 100) / 100).replace(".", ",");
  return `Предупреждение: PSI ${shown} выше порога 0,25. Распределение между срезами сдвинулось.`;
}

export interface StoredModelCard {
  version: string;
  status: "shadow" | "challenger" | "champion";
  modelType: string;
  metrics: Record<string, unknown> | null;
  card: Record<string, unknown> | null;
  audit: string | null;
}

function metricText(metrics: Record<string, unknown> | null, name: string, label: string): string | null {
  const raw = metrics?.[name];
  if (!raw || typeof raw !== "object") return null;
  const band = raw as { value?: unknown; low?: unknown; high?: unknown };
  if (typeof band.value !== "number") return null;
  const point = formatRatio(band.value);
  if (typeof band.low === "number" && typeof band.high === "number") {
    return `${label} ${point} (${formatRatio(band.low)}–${formatRatio(band.high)}).`;
  }
  return `${label} ${point}.`;
}

/** Russian catalog line. No row means a short empty line, not a made-up model. */
export function renderModelCard(row: StoredModelCard | null): string {
  if (!row) return "Карточки модели для этого проекта нет.";
  const parts = [`Версия ${row.version}.`, `Статус: ${STATUS_RU[row.status]}.`, `Тип: ${row.modelType}.`];
  const pr = metricText(row.metrics, "pr_auc", "PR-AUC");
  const brier = metricText(row.metrics, "brier", "Brier");
  if (pr) parts.push(pr);
  if (brier) parts.push(brier);
  if (!pr && !brier) parts.push("Метрик в карточке нет.");
  if (row.card?.synthetic === true) parts.push("Это синтетическая модель, не факт на экране.");
  const reasons = row.card?.reason_codes;
  if (Array.isArray(reasons)) {
    const words = reasons.filter((item): item is string => typeof item === "string" && item.length > 0 && !/\d/.test(item));
    if (words.length) parts.push(`Ведро: ${words.slice(0, 3).join(", ")}.`);
  }
  else if (row.status === "shadow" || row.card?.mode === "shadow") parts.push("Модель в тени: предложение и группа письма не меняются.");
  const psi = typeof row.card?.psi === "number" ? row.card.psi : null;
  if (psi !== null) {
    const warning = psiWarning(psi);
    if (warning) parts.push(warning);
  }
  return parts.join(" ");
}
