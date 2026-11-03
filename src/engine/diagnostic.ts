import { observedCycle } from "./pipeline";
import { piiHmac } from "./hash";
import { isRepeatWithin } from "./repeat";
import type { EntityRow, OrderRow, RawNps, RunConfig } from "./types";

export interface RfmCell {
  recency: string;
  frequency: string;
  monetary: string;
  n: number;
  revenue: number;
}

export interface VoiceCell {
  asked: boolean;
  band: "promoter" | "passive" | "detractor" | "silent" | "never";
  n: number;
}

export interface FirstCohort {
  month: string;
  buyers: number;
  mature: number;
  repeated: number;
}

export interface LookalikeCut {
  device: string;
  n: number;
  converted: number;
}

export interface RfmPoint {
  recency: number;
  ltv: number;
  repeat: boolean;
}

export function rfmGrid(entities: EntityRow[], config: RunConfig): RfmCell[] {
  const buyers = entities.filter((entity) => entity.converted && entity.last_purchase_at);
  const asOf = Date.parse(config.asOf);
  const recency = buyers.map((entity) => (asOf - Date.parse(entity.last_purchase_at!)) / 86_400_000);
  const frequency = buyers.map((entity) => entity.n_orders);
  const monetary = buyers.map((entity) => (entity.n_orders ? entity.ltv / entity.n_orders : 0));
  const recencyEdges = tercileEdges(recency);
  const frequencyEdges = tercileEdges(frequency);
  const monetaryEdges = tercileEdges(monetary);
  const labels = ["низкий", "средний", "высокий"] as const;
  const cells: RfmCell[] = [];
  for (const r of [0, 1, 2]) {
    for (const f of [0, 1, 2]) {
      for (const m of [0, 1, 2]) {
        const people = buyers.filter((entity, index) => {
          return tercile(recency[index], recencyEdges) === r && tercile(frequency[index], frequencyEdges) === f && tercile(monetary[index], monetaryEdges) === m;
        });
        cells.push({
          recency: labels[r],
          frequency: labels[f],
          monetary: labels[m],
          n: people.length,
          revenue: robustMoney(people.map((entity) => entity.ltv)),
        });
      }
    }
  }
  return cells;
}

export function rfmPoints(entities: EntityRow[], config: RunConfig): RfmPoint[] {
  const asOf = Date.parse(config.asOf);
  return entities
    .filter((entity) => entity.converted && entity.last_purchase_at)
    .map((entity) => ({
      recency: (asOf - Date.parse(entity.last_purchase_at!)) / 86_400_000,
      ltv: entity.ltv,
      repeat: entity.n_orders >= 2,
    }));
}

export function voiceGrid(entities: EntityRow[], orders: OrderRow[], nps: RawNps[]): VoiceCell[] {
  const emailOf = emailByEntity(orders);
  const scoreOf = new Map<string, RawNps>();
  for (const row of nps) {
    const hash = row.email_hash ?? (row.email ? piiHmac(row.email) : "");
    if (hash) scoreOf.set(hash, row);
  }
  const cells: VoiceCell[] = [
    { asked: true, band: "promoter", n: 0 },
    { asked: true, band: "passive", n: 0 },
    { asked: true, band: "detractor", n: 0 },
    { asked: true, band: "silent", n: 0 },
    { asked: false, band: "never", n: 0 },
  ];
  const bump = (band: VoiceCell["band"]) => {
    const cell = cells.find((item) => item.band === band);
    if (cell) cell.n += 1;
  };
  for (const entity of entities.filter((row) => row.converted)) {
    const email = emailOf.get(entity.entity_id);
    const row = email ? scoreOf.get(email) : undefined;
    if (!row || row.requested === false) {
      bump("never");
      continue;
    }
    if (row.score >= 9) bump("promoter");
    else if (row.score >= 7) bump("passive");
    else bump("detractor");
  }
  return cells;
}

export function firstPurchaseCohorts(entities: EntityRow[], windowDays: number): FirstCohort[] {
  const grouped = new Map<string, FirstCohort>();
  for (const entity of entities) {
    if (!entity.converted || !entity.first_purchase_at) continue;
    const month = entity.first_purchase_at.slice(0, 7);
    const row = grouped.get(month) ?? { month, buyers: 0, mature: 0, repeated: 0 };
    row.buyers += 1;
    if (entity.age_days !== null && entity.age_days >= windowDays) row.mature += 1;
    if (isRepeatWithin(entity, windowDays)) row.repeated += 1;
    grouped.set(month, row);
  }
  return [...grouped.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function lookalikeByDevice(entities: EntityRow[]): LookalikeCut[] {
  const grouped = new Map<string, LookalikeCut>();
  for (const entity of entities) {
    const device = entity.device || "unknown";
    const row = grouped.get(device) ?? { device, n: 0, converted: 0 };
    row.n += 1;
    if (entity.converted) row.converted += 1;
    grouped.set(device, row);
  }
  return [...grouped.values()].sort((a, b) => b.n - a.n);
}

function emailByEntity(orders: OrderRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const order of orders) {
    if (!order.entity_id || !order.email_hash) continue;
    if (!map.has(order.entity_id)) map.set(order.entity_id, order.email_hash);
  }
  return map;
}

export function observedCycleHigh(entities: EntityRow[], config: RunConfig): number {
  return observedCycle(entities, config).high;
}

function tercileEdges(values: number[]): [number, number] {
  const sorted = [...values].sort((a, b) => a - b);
  return [quantile(sorted, 1 / 3), quantile(sorted, 2 / 3)];
}

function tercile(value: number, edges: [number, number]): 0 | 1 | 2 {
  if (value <= edges[0]) return 0;
  if (value <= edges[1]) return 1;
  return 2;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - pos) + sorted[hi] * (pos - lo);
}

function robustMoney(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length < 10) return sorted[Math.floor((sorted.length - 1) / 2)];
  const cut = Math.floor(sorted.length * 0.1);
  const slice = sorted.slice(cut, sorted.length - cut);
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}
