import { diffProportions } from "./stats";
import type { OrderRow, SnapshotLine } from "./types";

const DAY = 86_400_000;

export interface SeasonalNote {
  available: boolean;
  method: "same-cohort-prior-year";
  /** Russian label. The unavailable sentence has no digits. */
  label: string;
  unadjusted: number | null;
  adjusted: number | null;
  unadjustedLow: number | null;
  unadjustedHigh: number | null;
  adjustedLow: number | null;
  adjustedHigh: number | null;
  treatmentN: number;
  controlN: number;
}

/**
 * Difference-in-differences against the same armed cohort one year earlier.
 * unadjusted = repeat(treatment) − repeat(control) in the current window.
 * adjusted = unadjusted − the same difference in [asOf_snapshot − 365d, + windowDays].
 * If that prior window has no paid order for these people, the method is unavailable.
 * A missing prior year is not filled with zero.
 */
export function seasonalNote(input: {
  snapshot: SnapshotLine[];
  orders: OrderRow[];
  windowDays: number;
  asOf: string;
}): SeasonalNote {
  const unavailable = (unadjusted: number | null, treatmentN = 0, controlN = 0): SeasonalNote => ({
    available: false,
    method: "same-cohort-prior-year",
    label: "Сезонная поправка недоступна: нет той же когорты годом ранее.",
    unadjusted,
    adjusted: null,
    unadjustedLow: null,
    unadjustedHigh: null,
    adjustedLow: null,
    adjustedHigh: null,
    treatmentN,
    controlN,
  });
  const armed = input.snapshot.filter((line) => line.arm === "treatment" || line.arm === "control");
  if (!armed.length) return unavailable(null);
  const start = Date.parse(armed[0].as_of);
  const asOf = Date.parse(input.asOf);
  if (!Number.isFinite(start) || !Number.isFinite(asOf)) return unavailable(null);
  const treatment = new Set(armed.filter((line) => line.arm === "treatment").map((line) => line.entity_id));
  const control = new Set(armed.filter((line) => line.arm === "control").map((line) => line.entity_id));
  const nowEnd = Math.min(asOf, start + input.windowDays * DAY);
  const now = armDiff(treatment, control, input.orders, start, nowEnd);
  const priorStart = start - 365 * DAY;
  const priorEnd = priorStart + input.windowDays * DAY;
  const cohort = new Set([...treatment, ...control]);
  const priorHits = input.orders.some((order) => inWindow(order, priorStart, priorEnd) && order.entity_id && cohort.has(order.entity_id));
  if (!priorHits || !now) return unavailable(now?.diff ?? null, treatment.size, control.size);
  const prior = armDiff(treatment, control, input.orders, priorStart, priorEnd);
  if (!prior) return unavailable(now.diff, treatment.size, control.size);
  const adjusted = now.diff - prior.diff;
  const adjustedLow = adjusted - Math.sqrt((now.diff - now.low) ** 2 + (prior.high - prior.diff) ** 2);
  const adjustedHigh = adjusted + Math.sqrt((now.high - now.diff) ** 2 + (prior.diff - prior.low) ** 2);
  return {
    available: true,
    method: "same-cohort-prior-year",
    label: "Разность разностей с той же когортой годом ранее. Оба числа наблюдаемые.",
    unadjusted: now.diff,
    adjusted,
    unadjustedLow: now.low,
    unadjustedHigh: now.high,
    adjustedLow,
    adjustedHigh,
    treatmentN: treatment.size,
    controlN: control.size,
  };
}

/** Screen sentence. A missing prior year stays the digit-free label. Small arms stay hidden. */
export function formatSeasonal(note: SeasonalNote): string {
  if (!note.available || note.unadjusted === null || note.adjusted === null) return note.label;
  if (note.treatmentN < 5 || note.controlN < 5) return `${note.label} Группа меньше 5 человек, разность не показываем.`;
  if (note.unadjustedLow === null || note.unadjustedHigh === null || note.adjustedLow === null || note.adjustedHigh === null) {
    return note.label;
  }
  return `Без поправки: ${formatPp(note.unadjusted)} (${formatPp(note.unadjustedLow)}–${formatPp(note.unadjustedHigh)}). С поправкой: ${formatPp(note.adjusted)} (${formatPp(note.adjustedLow)}–${formatPp(note.adjustedHigh)}). ${note.label}`;
}

export function formatPp(value: number): string {
  const rounded = Math.round(value * 1000) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded} п.п.`;
}

function armDiff(
  treatment: Set<string>,
  control: Set<string>,
  orders: OrderRow[],
  start: number,
  end: number,
): { diff: number; low: number; high: number } | null {
  if (!treatment.size || !control.size) return null;
  const buyers = new Set<string>();
  for (const order of orders) {
    if (!inWindow(order, start, end) || !order.entity_id) continue;
    buyers.add(order.entity_id);
  }
  const treatHits = [...treatment].filter((id) => buyers.has(id)).length;
  const ctrlHits = [...control].filter((id) => buyers.has(id)).length;
  const band = diffProportions(treatHits, treatment.size, ctrlHits, control.size);
  return { diff: band.diff, low: band.low, high: band.high };
}

function inWindow(order: OrderRow, start: number, end: number): boolean {
  if (order.status !== "paid" || order.is_subscription_renewal || !order.countsAsOrder) return false;
  const ts = Date.parse(order.purchased_at);
  return ts > start && ts <= end;
}
