import { wilsonInterval, type ProportionInterval } from "./stats";
import type { EntityRow } from "./types";

export function isMature(entity: EntityRow, windowDays: number): boolean {
  return entity.converted && entity.age_days !== null && entity.age_days >= windowDays;
}

/** Second purchase gap is inside the platform window. Renewals never reach n_orders / second_purchase_at. */
export function isRepeatWithin(entity: EntityRow, windowDays: number): boolean {
  if (!isMature(entity, windowDays)) return false;
  if (!entity.second_purchase_at || !entity.first_purchase_at) return false;
  const gap = (Date.parse(entity.second_purchase_at) - Date.parse(entity.first_purchase_at)) / 86_400_000;
  return gap >= 0 && gap <= windowDays;
}

export function repeatWithin(entities: EntityRow[], windowDays: number): ProportionInterval {
  const mature = entities.filter((entity) => isMature(entity, windowDays));
  const repeated = mature.filter((entity) => isRepeatWithin(entity, windowDays));
  return wilsonInterval(repeated.length, mature.length);
}
