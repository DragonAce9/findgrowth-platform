import type { OrderRow } from "./types";

export interface DailyQuality {
  median: number;
  mad: number;
  spikeDays: string[];
}

export function dailyOrderQuality(orders: OrderRow[]): DailyQuality {
  const counts = new Map<string, number>();
  for (const order of orders) {
    if (order.status !== "paid" || order.is_subscription_renewal || !order.countsAsOrder) continue;
    const day = order.purchased_at.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const values = [...counts.values()].sort((a, b) => a - b);
  const median = quantile(values, 0.5);
  const deviations = values.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  const mad = quantile(deviations, 0.5);
  const limit = median + Math.max(5 * (mad || 1), 3);
  const spikeDays = [...counts.entries()].filter(([, count]) => count > limit).map(([day]) => day);
  return { median, mad, spikeDays };
}

/** Simple max CDF gap on revenue, plus a channel-share gap. Not a claim about a named KS table. */
export function distributionShift(previous: OrderRow[], next: OrderRow[]): { sharp: boolean; note: string } {
  const left = revenues(previous);
  const right = revenues(next);
  if (left.length < 8 || right.length < 8) return { sharp: false, note: "" };
  const distance = cdfDistance(left, right);
  const channel = channelDistance(previous, next);
  const sharp = distance >= 0.35 || channel >= 0.35;
  if (!sharp) return { sharp: false, note: "" };
  return {
    sharp: true,
    note: "Файл не похож на предыдущий: распределение чека или каналов сдвинулось. Цифры этого среза с прошлым лучше не складывать.",
  };
}

export function qualityNote(orders: OrderRow[], previous?: OrderRow[]): string | null {
  const daily = dailyOrderQuality(orders);
  const parts: string[] = [];
  if (daily.spikeDays.length) {
    parts.push(`В файле есть день с необычным числом заказов (${daily.spikeDays[0]}). Это предупреждение, не правка файла.`);
  }
  if (previous?.length) {
    const shift = distributionShift(previous, orders);
    if (shift.sharp) parts.push(shift.note);
  }
  return parts.length ? parts.join(" ") : null;
}

function revenues(orders: OrderRow[]): number[] {
  return orders.filter((order) => order.status === "paid" && !order.is_subscription_renewal && order.countsAsOrder).map((order) => order.revenue);
}

function cdfDistance(left: number[], right: number[]): number {
  const pooled = [...new Set([...left, ...right])].sort((a, b) => a - b);
  const a = [...left].sort((x, y) => x - y);
  const b = [...right].sort((x, y) => x - y);
  let max = 0;
  for (const point of pooled) {
    const fa = shareAtMost(a, point);
    const fb = shareAtMost(b, point);
    max = Math.max(max, Math.abs(fa - fb));
  }
  return max;
}

function shareAtMost(sorted: number[], point: number): number {
  let count = 0;
  for (const value of sorted) {
    if (value > point) break;
    count += 1;
  }
  return sorted.length ? count / sorted.length : 0;
}

function channelDistance(previous: OrderRow[], next: OrderRow[]): number {
  const a = channelShares(previous);
  const b = channelShares(next);
  const keys = new Set([...a.keys(), ...b.keys()]);
  let gap = 0;
  for (const key of keys) gap = Math.max(gap, Math.abs((a.get(key) ?? 0) - (b.get(key) ?? 0)));
  return gap;
}

function channelShares(orders: OrderRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  let total = 0;
  for (const order of orders) {
    if (order.status !== "paid") continue;
    const key = order.sku || "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
  }
  const shares = new Map<string, number>();
  for (const [key, count] of counts) shares.set(key, total ? count / total : 0);
  return shares;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - pos) + sorted[hi] * (pos - lo);
}
