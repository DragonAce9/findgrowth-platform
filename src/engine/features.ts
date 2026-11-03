import { channelGroup } from "./channel";
import { piiHmac } from "./hash";
import { kaplanMeier } from "./survival";
import type { EntityRow, OrderRow, RawEvent, RawNps } from "./types";

export interface FeatureRow {
  entity_id: string;
  t1: string;
  visits_before_t1: number | null;
  pdp_depth: number | null;
  days_first_seen_to_t1: number;
  basket_roles: Record<string, number>;
  revenue: number;
  discount: number;
  channel: string;
  device: string;
  nps: number | null;
  as_of: string;
  first_basket_lines: number;
  weekday: number;
  cart_returns: number | null;
  /** Days from first seen to T1, divided by the KM cycle known at T1. */
  days_versus_cycle: number;
}

/**
 * Point-in-time features at T1 (first non-renewal purchase).
 * Every timestamp used here is <= T1. Later events do not enter the row.
 */
export function featuresFor(input: {
  entities: EntityRow[];
  ordersByEntity: Map<string, OrderRow[]>;
  eventsByEntity: Map<string, RawEvent[]>;
  nps: RawNps[];
  skuRoles: Record<string, string>;
  sampleEvery?: number;
  replenishmentLow?: number;
  replenishmentHigh?: number;
}): FeatureRow[] {
  const npsByHash = new Map<string, RawNps[]>();
  for (const row of input.nps) {
    const hash = npsHash(row);
    if (!hash) continue;
    const list = npsByHash.get(hash) ?? [];
    list.push(row);
    npsByHash.set(hash, list);
  }
  const sessionsCounted = !(input.sampleEvery && input.sampleEvery > 1);
  const priorLow = input.replenishmentLow ?? 30;
  const priorHigh = input.replenishmentHigh ?? 90;
  const cycleCache = new Map<string, number>();
  const rows: FeatureRow[] = [];
  for (const entity of input.entities) {
    if (!entity.first_purchase_at) continue;
    const t1 = Date.parse(entity.first_purchase_at);
    if (!Number.isFinite(t1)) continue;
    const events = (input.eventsByEntity.get(entity.entity_id) ?? []).filter((event) => Date.parse(String(event.timestamp)) <= t1);
    const orders = (input.ordersByEntity.get(entity.entity_id) ?? []).filter(
      (order) =>
        order.status === "paid" &&
        !order.is_subscription_renewal &&
        order.countsAsOrder &&
        Date.parse(order.purchased_at) <= t1,
    );
    const sessions = new Set(events.map((event) => String(event.session_id || event.timestamp)));
    const cartReturns = events.filter((event) => event.event_name === "remove_from_cart").length;
    const firstEvent = [...events].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))[0];
    const firstSeen = firstEvent ? Date.parse(String(firstEvent.timestamp)) : t1;
    const basket: Record<string, number> = {};
    let revenue = 0;
    let discount = 0;
    let basketLines = 0;
    for (const order of orders) {
      if (order.purchased_at !== entity.first_purchase_at && Date.parse(order.purchased_at) !== t1) continue;
      const role = input.skuRoles[order.sku] ?? "unknown";
      const qty = order.quantity && order.quantity > 0 ? order.quantity : 1;
      basket[role] = (basket[role] ?? 0) + qty;
      basketLines += qty;
      revenue += order.revenue;
      discount += orderDiscount(order);
    }
    const emailHash = orders.find((order) => order.email_hash)?.email_hash;
    const scores = emailHash ? (npsByHash.get(emailHash) ?? []) : [];
    const nps = scores
      .filter((row) => Date.parse(row.date) <= t1)
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1);
    const days = Math.max(0, (t1 - firstSeen) / 86_400_000);
    const cycleHigh = cycleAt(input.entities, t1, priorLow, priorHigh, cycleCache);
    rows.push({
      entity_id: entity.entity_id,
      t1: entity.first_purchase_at,
      visits_before_t1: sessionsCounted ? sessions.size : null,
      pdp_depth: sessionsCounted
        ? events.filter((event) => event.event_name === "view_pdp" || event.event_name === "view_product").length
        : null,
      days_first_seen_to_t1: days,
      basket_roles: basket,
      revenue,
      discount,
      channel: firstEvent
        ? channelGroup(String(firstEvent.utm_source ?? ""), String(firstEvent.utm_medium ?? ""))
        : "direct",
      device: String(firstEvent?.device_type ?? "desktop"),
      nps: nps ? nps.score : null,
      as_of: entity.first_purchase_at,
      first_basket_lines: basketLines,
      weekday: new Date(t1).getUTCDay(),
      cart_returns: sessionsCounted ? cartReturns : null,
      days_versus_cycle: cycleHigh > 0 ? days / cycleHigh : 0,
    });
  }
  return rows;
}

export interface NonBuyerFeatureRow {
  entity_id: string;
  as_of: string;
  pdp_depth: number;
  visits: number;
  cart_without_checkout: boolean;
  days_since_first_seen: number;
  channel: string;
  device: string;
  /** Follow-up shorter than 30 days and no purchase yet. Not a negative label. */
  censored: boolean;
  label: 0 | 1 | null;
}

/**
 * Point-in-time features for a non-buyer at the last visit. Events after that
 * moment do not enter. A person who has not had 30 days of follow-up is censored.
 */
export function featuresForNonBuyers(input: {
  entities: EntityRow[];
  eventsByEntity: Map<string, RawEvent[]>;
  ordersByEntity: Map<string, OrderRow[]>;
  asOf: string;
}): NonBuyerFeatureRow[] {
  const asOf = Date.parse(input.asOf);
  const rows: NonBuyerFeatureRow[] = [];
  for (const entity of input.entities) {
    if (entity.first_purchase_at && Date.parse(entity.first_purchase_at) <= asOf) continue;
    const events = (input.eventsByEntity.get(entity.entity_id) ?? [])
      .filter((event) => Date.parse(String(event.timestamp)) <= asOf)
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    if (!events.length) continue;
    const last = events[events.length - 1];
    const moment = Date.parse(String(last.timestamp));
    if (!Number.isFinite(moment)) continue;
    const before = events.filter((event) => Date.parse(String(event.timestamp)) <= moment);
    const names = new Set(before.map((event) => event.event_name));
    const cart = [...names].some((name) => name === "add_to_cart" || name === "ui_click_cta" || name === "cart");
    const checkout = names.has("view_checkout");
    const first = Date.parse(String(before[0].timestamp));
    const purchases = (input.ordersByEntity.get(entity.entity_id) ?? []).filter(
      (order) => order.status === "paid" && !order.is_subscription_renewal && order.countsAsOrder,
    );
    const bought = purchases.some((order) => {
      const ts = Date.parse(order.purchased_at);
      return ts > moment && ts <= moment + 30 * 86_400_000 && ts <= asOf;
    });
    const followDays = (asOf - moment) / 86_400_000;
    const censored = !bought && followDays < 30;
    rows.push({
      entity_id: entity.entity_id,
      as_of: String(last.timestamp),
      pdp_depth: before.filter((event) => event.event_name === "view_pdp" || event.event_name === "view_product").length,
      visits: new Set(before.map((event) => String(event.session_id || event.timestamp))).size,
      cart_without_checkout: cart && !checkout,
      days_since_first_seen: Math.max(0, (moment - first) / 86_400_000),
      channel: channelGroup(String(before[0].utm_source ?? ""), String(before[0].utm_medium ?? "")),
      device: String(before[0].device_type ?? "desktop"),
      censored,
      label: censored ? null : bought ? 1 : 0,
    });
  }
  return rows;
}

/** Abandoned cart in the last 7 days before the prediction moment: 1, otherwise 0. */
export function abandonedCartBaseline(events: RawEvent[], momentIso: string): 0 | 1 {
  const moment = Date.parse(momentIso);
  const start = moment - 7 * 86_400_000;
  const window = events.filter((event) => {
    const ts = Date.parse(String(event.timestamp));
    return ts >= start && ts <= moment;
  });
  const names = new Set(window.map((event) => event.event_name));
  const cart = [...names].some((name) => name === "add_to_cart" || name === "ui_click_cta" || name === "cart");
  const checkout = names.has("view_checkout") || names.has("purchase");
  return cart && !checkout ? 1 : 0;
}

const CYCLE_PRIOR = 8;

/** Same shrinkage as observedCycle: q25 → low, median → high, censored at T1. */
function cycleAt(entities: EntityRow[], t1: number, priorLow: number, priorHigh: number, cache: Map<string, number>): number {
  if (entities.length > 1500) return priorHigh;
  const day = new Date(t1).toISOString().slice(0, 10);
  const cached = cache.get(day);
  if (cached !== undefined) return cached;
  const observations: Array<{ time: number; event: boolean }> = [];
  for (const entity of entities) {
    if (!entity.first_purchase_at) continue;
    const start = Date.parse(entity.first_purchase_at);
    if (!Number.isFinite(start) || start > t1) continue;
    if (entity.second_purchase_at) {
      const second = Date.parse(entity.second_purchase_at);
      if (second >= start && second <= t1) {
        observations.push({ time: (second - start) / 86_400_000, event: true });
        continue;
      }
    }
    const follow = (t1 - start) / 86_400_000;
    if (follow >= 0) observations.push({ time: follow, event: false });
  }
  const fit = kaplanMeier(observations);
  const weight = fit.events / (fit.events + CYCLE_PRIOR);
  const dataLow = fit.q25 ?? priorLow;
  const dataHigh = fit.median ?? priorHigh;
  const low = fit.events ? Math.max(1, Math.round(weight * dataLow + (1 - weight) * priorLow)) : priorLow;
  const high = fit.events ? Math.max(low, Math.round(weight * dataHigh + (1 - weight) * priorHigh)) : priorHigh;
  cache.set(day, high);
  return high;
}

export function npsHash(row: RawNps): string | undefined {
  if (row.email_hash) return row.email_hash;
  if (row.email) return piiHmac(row.email);
  return undefined;
}

function orderDiscount(order: OrderRow): number {
  const raw = order as OrderRow & { discount?: number };
  return typeof raw.discount === "number" && Number.isFinite(raw.discount) ? raw.discount : 0;
}
