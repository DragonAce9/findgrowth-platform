import { bootstrapMean, bootstrapProportion, empiricalBayesShrink } from "./stats";
import { methodologyOf } from "./methodology";
import type { OrderRow, PriorStore, Recommendation, RunConfig, SnapshotLine } from "./types";
import { normalizeSnapshotLine } from "./types";

const SUPPORT_MIN = 2;

export interface RecsModel {
  brandId: string;
  asOf: string;
  scores: Map<string, Map<string, number>>;
  skuRole: Record<string, string>;
  heroByRole: Record<string, string>;
  repeatBySku: Record<string, number>;
}

export function emptyPrior(): PriorStore {
  return { brands: {} };
}

export function trainRecs(input: {
  orders: OrderRow[];
  asOf: string;
  skuRoles: Record<string, string>;
  prior: PriorStore;
  brandId: string;
}): RecsModel {
  const asOfMs = Date.parse(input.asOf);
  const usable = input.orders.filter(
    (order) =>
      order.entity_id &&
      order.status === "paid" &&
      !order.is_subscription_renewal &&
      Date.parse(order.purchased_at) < asOfMs,
  );
  const baskets = new Map<string, Set<string>>();
  for (const order of usable) {
    const set = baskets.get(order.entity_id!) ?? new Set();
    set.add(order.sku);
    baskets.set(order.entity_id!, set);
  }
  const usersOf = new Map<string, Set<string>>();
  for (const [entity, skus] of baskets) {
    for (const sku of skus) {
      const users = usersOf.get(sku) ?? new Set();
      users.add(entity);
      usersOf.set(sku, users);
    }
  }
  const scores = new Map<string, Map<string, number>>();
  const skus = [...usersOf.keys()];
  for (const left of skus) {
    const row = new Map<string, number>();
    for (const right of skus) {
      if (left === right) continue;
      const a = usersOf.get(left)!;
      const b = usersOf.get(right)!;
      let inter = 0;
      for (const user of a) if (b.has(user)) inter += 1;
      if (inter >= SUPPORT_MIN) {
        row.set(right, laplaceLift(inter, a.size, b.size, baskets.size).lift);
      }
    }
    scores.set(left, row);
  }
  const repeatBySku: Record<string, number> = {};
  for (const sku of skus) {
    const buyers = usersOf.get(sku)!;
    let repeated = 0;
    for (const entity of buyers) {
      const bought = [...(baskets.get(entity) ?? [])];
      const times = usable.filter((order) => order.entity_id === entity && order.sku === sku).length;
      if (times >= 2 || bought.length > 1) repeated += times >= 2 ? 1 : 0;
    }
    repeatBySku[sku] = buyers.size ? repeated / buyers.size : 0;
  }
  const heroByRole: Record<string, string> = {};
  for (const [sku, role] of Object.entries(input.skuRoles)) {
    const current = heroByRole[role];
    if (!current || (repeatBySku[sku] ?? 0) > (repeatBySku[current] ?? 0)) heroByRole[role] = sku;
  }
  if (!Object.keys(heroByRole).length) {
    const top = skus.sort((a, b) => (repeatBySku[b] ?? 0) - (repeatBySku[a] ?? 0))[0];
    if (top) heroByRole.default = top;
  }
  void input.prior;
  void input.brandId;
  return {
    brandId: input.brandId,
    asOf: input.asOf,
    scores,
    skuRole: input.skuRoles,
    heroByRole,
    repeatBySku,
  };
}

export interface CoPurchase {
  left: string;
  right: string;
  leftName: string;
  rightName: string;
  n: number;
  lift: number;
  liftLow: number;
  liftHigh: number;
  confidence: number;
  kind: "basket" | "sequence";
}

export function topCoPurchases(orders: OrderRow[], asOf: string, limit = 5): CoPurchase[] {
  const asOfMs = Date.parse(asOf);
  const names = new Map<string, string>();
  const baskets = new Map<string, Set<string>>();
  for (const order of orders) {
    if (!order.entity_id || order.status !== "paid" || order.is_subscription_renewal) continue;
    if (Date.parse(order.purchased_at) >= asOfMs) continue;
    const named = order.product_name && !/^\d+$/.test(order.product_name) ? order.product_name : order.sku;
    if (!names.has(named)) names.set(named, named);
    const set = baskets.get(order.entity_id) ?? new Set();
    set.add(named);
    baskets.set(order.entity_id, set);
  }
  const counts = new Map<string, number>();
  for (const skus of baskets.values()) {
    const list = [...skus].sort();
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const key = `${list[i]}|${list[j]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const support = new Map<string, number>();
  for (const skus of baskets.values()) {
    for (const sku of skus) support.set(sku, (support.get(sku) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, n]) => {
      const [left, right] = key.split("|");
      const stats = laplaceLift(n, support.get(left) ?? 0, support.get(right) ?? 0, Math.max(baskets.size, 1));
      return { left, right, leftName: names.get(left) ?? left, rightName: names.get(right) ?? right, n, ...stats, kind: "basket" as const };
    })
    .filter((pair) => pair.n >= SUPPORT_MIN && pair.liftLow > 1)
    .sort((a, b) => b.lift - a.lift || b.n - a.n || a.left.localeCompare(b.left))
    .slice(0, limit);
}

/** First paid sku → the next different purchase. Renewals stay out. Separate from same-basket pairs. */
export function sequentialPairs(orders: OrderRow[], asOf: string, limit = 5): CoPurchase[] {
  const asOfMs = Date.parse(asOf);
  const names = new Map<string, string>();
  const byEntity = new Map<string, OrderRow[]>();
  for (const order of orders) {
    if (!order.entity_id || order.status !== "paid" || order.is_subscription_renewal || !order.countsAsOrder) continue;
    if (Date.parse(order.purchased_at) >= asOfMs) continue;
    const named = order.product_name && !/^\d+$/.test(order.product_name) ? order.product_name : order.sku;
    names.set(order.sku, named);
    const list = byEntity.get(order.entity_id) ?? [];
    list.push(order);
    byEntity.set(order.entity_id, list);
  }
  const counts = new Map<string, number>();
  const leftCount = new Map<string, number>();
  const rightCount = new Map<string, number>();
  let buyers = 0;
  for (const list of byEntity.values()) {
    const sorted = [...list].sort((a, b) => a.purchased_at.localeCompare(b.purchased_at));
    const first = sorted[0];
    const second = sorted.find((order) => order.sku !== first.sku && order.purchased_at !== first.purchased_at);
    if (!second) continue;
    buyers += 1;
    leftCount.set(first.sku, (leftCount.get(first.sku) ?? 0) + 1);
    rightCount.set(second.sku, (rightCount.get(second.sku) ?? 0) + 1);
    const key = `${first.sku}|${second.sku}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, n]) => {
      const [left, right] = key.split("|");
      const stats = laplaceLift(n, leftCount.get(left) ?? 0, rightCount.get(right) ?? 0, Math.max(buyers, 1));
      return {
        left,
        right,
        leftName: names.get(left) ?? left,
        rightName: names.get(right) ?? right,
        n,
        ...stats,
        kind: "sequence" as const,
      };
    })
    .filter((pair) => pair.n >= SUPPORT_MIN && pair.liftLow > 1)
    .sort((a, b) => b.lift - a.lift || b.n - a.n || a.left.localeCompare(b.left))
    .slice(0, limit);
}

export interface CoViewEvent {
  event_name: string;
  product_id?: string;
  user_id?: string;
  session_id?: string;
  user_session?: string;
}

export interface CoViewReport {
  views: number;
  people: number;
  pairs: CoPurchase[];
  signal: boolean;
  /** Pairs that still clear the shrunk lower bound. Independent of `limit`. */
  qualified: number;
  maxLift: number;
}

const VIEW_NAMES = new Set(["view", "view_pdp", "view_product"]);

/**
 * Item-item co-view. The co-occurrence count still has to be at least 2, as for purchases.
 * The rate (co-viewers / viewers of the rarer item) is then shrunk with the same
 * empirical Bayes prior as segment rates. Lift is the posterior mean divided by that
 * pooled rate, so two items seen together by two people cannot post a Laplace spike.
 */
export function coViewPairs(events: CoViewEvent[], limit = 5): CoViewReport {
  const baskets = new Map<string, Set<string>>();
  let views = 0;
  for (const event of events) {
    if (!VIEW_NAMES.has(event.event_name)) continue;
    const product = event.product_id?.trim();
    if (!product) continue;
    const who = event.user_id?.trim() || event.user_session?.trim() || event.session_id?.trim();
    if (!who) continue;
    views += 1;
    const set = baskets.get(who) ?? new Set();
    set.add(product);
    baskets.set(who, set);
  }
  const counts = new Map<string, number>();
  for (const skus of baskets.values()) {
    const list = [...skus].sort();
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const key = `${list[i]}|${list[j]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const support = new Map<string, number>();
  for (const skus of baskets.values()) {
    for (const sku of skus) support.set(sku, (support.get(sku) ?? 0) + 1);
  }
  const drafts = [...counts.entries()]
    .map(([key, n]) => {
      const [left, right] = key.split("|");
      const leftN = support.get(left) ?? 0;
      const rightN = support.get(right) ?? 0;
      return { left, right, n, supportN: Math.min(leftN, rightN) };
    })
    .filter((pair) => pair.n >= SUPPORT_MIN && pair.supportN > 0);
  const shrunk = empiricalBayesShrink(drafts.map((pair) => ({ id: `${pair.left}|${pair.right}`, successes: pair.n, n: pair.supportN })));
  const totalS = drafts.reduce((sum, pair) => sum + pair.n, 0);
  const totalN = drafts.reduce((sum, pair) => sum + pair.supportN, 0);
  const mu = totalN ? totalS / totalN : 0.5;
  const qualified = drafts
    .map((pair, index) => {
      const row = shrunk[index];
      const lift = mu > 0 ? row.shrunk / mu : 1;
      const liftLow = mu > 0 ? row.low / mu : 0;
      const liftHigh = mu > 0 ? row.high / mu : 1;
      return {
        left: pair.left,
        right: pair.right,
        leftName: pair.left,
        rightName: pair.right,
        n: pair.n,
        lift,
        liftLow,
        liftHigh,
        confidence: row.shrunk,
        kind: "basket" as const,
      };
    })
    .filter((pair) => pair.liftLow > 1)
    .sort((a, b) => b.lift - a.lift || b.n - a.n || a.left.localeCompare(b.left));
  return {
    views,
    people: baskets.size,
    pairs: qualified.slice(0, limit),
    signal: qualified.length > 0,
    qualified: qualified.length,
    maxLift: qualified[0]?.lift ?? 0,
  };
}

function laplaceLift(both: number, left: number, right: number, n: number): {
  lift: number;
  liftLow: number;
  liftHigh: number;
  confidence: number;
} {
  const alpha = 1;
  const lift = ((both + alpha) * (n + alpha)) / ((left + alpha) * (right + alpha));
  const se2 = 1 / Math.max(both, 0.5) - 1 / Math.max(left, 0.5) - 1 / Math.max(right, 0.5) + 1 / Math.max(n, 1);
  const se = Math.sqrt(Math.max(se2, 0));
  const logLift = Math.log(Math.max(lift, 1e-9));
  const z = 1.959963984540054;
  return {
    lift,
    liftLow: Math.exp(logLift - z * se),
    liftHigh: Math.exp(logLift + z * se),
    confidence: (both + alpha) / (left + alpha),
  };
}

export function rolePairCounts(orders: OrderRow[], asOf: string, skuRoles: Record<string, string>): Record<string, number> {
  const asOfMs = Date.parse(asOf);
  const baskets = new Map<string, Set<string>>();
  for (const order of orders) {
    if (!order.entity_id || order.status !== "paid" || order.is_subscription_renewal) continue;
    if (Date.parse(order.purchased_at) >= asOfMs) continue;
    const role = skuRoles[order.sku];
    if (!role) continue;
    const set = baskets.get(order.entity_id) ?? new Set();
    set.add(role);
    baskets.set(order.entity_id, set);
  }
  const pairs: Record<string, number> = {};
  for (const roles of baskets.values()) {
    const list = [...roles].sort();
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const key = `${list[i]}|${list[j]}`;
        pairs[key] = (pairs[key] ?? 0) + 1;
      }
    }
  }
  return pairs;
}

export function replaceBrandPrior(store: PriorStore, brandId: string, pairs: Record<string, number>): void {
  store.brands[brandId] = { pairs };
}

export function recommendFor(
  model: RecsModel,
  entityId: string,
  ownedSkus: string[],
  prior: PriorStore,
): Recommendation {
  const owned = new Set(ownedSkus);
  let best: Recommendation | null = null;
  for (const sku of owned) {
    const neighbors = model.scores.get(sku);
    if (!neighbors) continue;
    for (const [other, score] of neighbors) {
      if (owned.has(other)) continue;
      if (!best || score > best.score) {
        best = { entity_id: entityId, sku: other, score, reason: "cf", fallback_used: false };
      }
    }
  }
  if (best) return best;
  const role = ownedSkus.map((sku) => model.skuRole[sku]).find(Boolean) ?? "serum";
  const pool = poolPairs(prior, model.brandId);
  const categorySku = skuForRole(model, role, owned, pool);
  if (categorySku) {
    return {
      entity_id: entityId,
      sku: categorySku,
      score: 0.1,
      reason: "category_popular",
      fallback_used: true,
    };
  }
  const hero = model.heroByRole[role] ?? model.heroByRole.default ?? ownedSkus[0] ?? "serum";
  return {
    entity_id: entityId,
    sku: hero,
    score: model.repeatBySku[hero] ?? 0,
    reason: "hero",
    fallback_used: true,
  };
}

function skuForRole(model: RecsModel, role: string, owned: Set<string>, pool: Record<string, number>): string | null {
  let bestRole = "";
  let best = 0;
  for (const [key, count] of Object.entries(pool)) {
    const [a, b] = key.split("|");
    if (a !== role && b !== role) continue;
    if (count > best) {
      best = count;
      bestRole = a === role ? b : a;
    }
  }
  if (!bestRole) return null;
  const sku = Object.entries(model.skuRole).find(([id, skuRole]) => skuRole === bestRole && !owned.has(id));
  return sku?.[0] ?? null;
}

function poolPairs(prior: PriorStore, exceptBrand: string): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const [brand, body] of Object.entries(prior.brands)) {
    if (brand === exceptBrand) continue;
    for (const [key, count] of Object.entries(body.pairs)) totals[key] = (totals[key] ?? 0) + count;
  }
  return totals;
}

export interface SnapshotScore {
  hitRate: number;
  hitRateLow: number;
  hitRateHigh: number;
  hitRatePopular: number;
  hitRatePopularLow: number;
  hitRatePopularHigh: number;
  hitRateRandom: number;
  hitRateRandomLow: number;
  hitRateRandomHigh: number;
  methodologyMismatch: boolean;
}

export function scoreSnapshot(input: {
  snapshot: SnapshotLine[];
  orders: OrderRow[];
  windowDays: number;
  asOf: string;
  skuRoles: Record<string, string>;
  config?: Pick<RunConfig, "methodologyVersion">;
}): SnapshotScore | null {
  if (!input.snapshot.length) return null;
  const lines = input.snapshot.map((line) => normalizeSnapshotLine(line));
  const current = input.config ? methodologyOf(input.config) : methodologyOf({});
  const methodologyMismatch = lines.some((line) => line.methodology_version !== current);
  if (methodologyMismatch) return null;
  const start = Date.parse(lines[0].as_of);
  const end = start + input.windowDays * 86_400_000;
  if (Date.parse(input.asOf) < end) return null;
  const purchases = new Map<string, Set<string>>();
  const before = new Map<string, Map<string, number>>();
  const catalog = new Set<string>();
  for (const order of input.orders) {
    if (!order.entity_id || order.status !== "paid" || order.is_subscription_renewal || !order.countsAsOrder) continue;
    const ts = Date.parse(order.purchased_at);
    if (ts < start) {
      catalog.add(order.sku);
      const role = input.skuRoles[order.sku] ?? "unknown";
      const counts = before.get(role) ?? new Map();
      counts.set(order.sku, (counts.get(order.sku) ?? 0) + 1);
      before.set(role, counts);
    }
    if (ts <= start || ts > end) continue;
    const set = purchases.get(order.entity_id) ?? new Set();
    set.add(order.sku);
    purchases.set(order.entity_id, set);
  }
  const hits: number[] = [];
  const popularHits: number[] = [];
  const randomHits: number[] = [];
  const catalogSize = Math.max(catalog.size, 1);
  for (const line of lines) {
    const bought = purchases.get(line.entity_id) ?? new Set();
    hits.push(bought.has(line.sku) ? 1 : 0);
    const popular = topSku(before.get(line.role));
    popularHits.push(popular && bought.has(popular) ? 1 : 0);
    let overlap = 0;
    for (const sku of bought) if (catalog.has(sku)) overlap += 1;
    randomHits.push(catalog.size ? overlap / catalogSize : 0);
  }
  const hit = bootstrapProportion(hits, { seed: 7, reps: 400 });
  const popular = bootstrapProportion(popularHits, { seed: 11, reps: 400 });
  const random = bootstrapMean(randomHits, { seed: 13, reps: 400 });
  return {
    hitRate: hit.mean,
    hitRateLow: hit.low,
    hitRateHigh: hit.high,
    hitRatePopular: popular.mean,
    hitRatePopularLow: popular.low,
    hitRatePopularHigh: popular.high,
    hitRateRandom: random.mean,
    hitRateRandomLow: random.low,
    hitRateRandomHigh: random.high,
    methodologyMismatch: false,
  };
}

function topSku(counts: Map<string, number> | undefined): string | null {
  if (!counts) return null;
  let best = "";
  let n = -1;
  for (const [sku, count] of counts) {
    if (count > n) {
      best = sku;
      n = count;
    }
  }
  return best || null;
}

export function fallbackRate(lines: Recommendation[]): number {
  if (!lines.length) return 0;
  return lines.filter((line) => line.fallback_used).length / lines.length;
}
