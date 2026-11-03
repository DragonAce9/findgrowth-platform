import type { OrderRow } from "./types";

export interface RenewalMark {
  order_id: string;
  inferred_renewal: boolean;
}

/**
 * Same sku, same revenue, gap of 28–32 days. This is a guess.
 * It does not set is_subscription_renewal and must not drop the order from repeat, LTV, RFM, or pairs.
 */
export function inferRenewals(orders: OrderRow[]): RenewalMark[] {
  const groups = new Map<string, OrderRow[]>();
  for (const order of orders) {
    if (order.status !== "paid" || !order.countsAsOrder) continue;
    const key = `${order.entity_id ?? order.email_hash ?? order.order_id}|${order.sku}|${order.revenue}`;
    const list = groups.get(key) ?? [];
    list.push(order);
    groups.set(key, list);
  }
  const marks = new Map<string, boolean>();
  for (const order of orders) marks.set(order.order_id, false);
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.purchased_at.localeCompare(b.purchased_at));
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = (Date.parse(sorted[i].purchased_at) - Date.parse(sorted[i - 1].purchased_at)) / 86_400_000;
      if (gap >= 28 && gap <= 32) marks.set(sorted[i].order_id, true);
    }
  }
  return [...marks.entries()].map(([order_id, inferred_renewal]) => ({ order_id, inferred_renewal }));
}

export function applyInferredRenewals(orders: OrderRow[]): number {
  const marks = inferRenewals(orders);
  const byId = new Map(marks.map((mark) => [mark.order_id, mark.inferred_renewal]));
  let n = 0;
  for (const order of orders) {
    const inferred = byId.get(order.order_id) === true && !order.is_subscription_renewal;
    order.inferred_renewal = inferred;
    if (inferred) n += 1;
  }
  return n;
}
