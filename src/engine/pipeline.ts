import { collectBrandKeys, type BrandKeyLink } from "./brand-key";
import { channelGroup, assertStableIdColumn } from "./channel";
import { featuresFor, type FeatureRow } from "./features";
import { piiHmac } from "./hash";
import { assignArms, bucketByScore, emptyHoldout, measureLift, type HoldoutRecord, type MeasuredLift } from "./holdout";
import { seasonalNote, type SeasonalNote } from "./seasonal";
import { compileSql, type MetricDef } from "./metrics";
import { hashRunConfig, methodologyOf } from "./methodology";
import { UnionFind, nodeKey } from "./identity";
import { experimentReadiness } from "./experiments";
import { qualityNote } from "./quality";
import { repeatWithin } from "./repeat";
import { applyInferredRenewals } from "./renewals";
import { kaplanMeier, type SurvivalPoint } from "./survival";
import {
  emptyPrior,
  fallbackRate,
  recommendFor,
  replaceBrandPrior,
  rolePairCounts,
  scoreSnapshot,
  trainRecs,
  type RecsModel,
} from "./recs";
import { normalizeSnapshotLine } from "./types";
import type {
  EntityRow,
  ExposureRow,
  MetricTable,
  OrderRow,
  PriorStore,
  RawEvent,
  RawNps,
  RawOrder,
  Recommendation,
  RunConfig,
  SnapshotLine,
} from "./types";

export interface WorkspaceInput {
  events: RawEvent[];
  orders: RawOrder[];
  nps?: RawNps[];
  config: RunConfig;
  prior?: PriorStore;
  previousSnapshot?: SnapshotLine[];
  previousOrders?: OrderRow[];
}

export interface Workspace {
  entities: EntityRow[];
  orders: OrderRow[];
  exposures: ExposureRow[];
  metrics: MetricTable[];
  sql: Record<string, string>;
  identityCoverage: number;
  orphanRevenue: number;
  lowJoin: boolean;
  lowIdentityInput: boolean;
  model: RecsModel;
  hitRate: number | null;
  hitRateLow: number | null;
  hitRateHigh: number | null;
  hitRatePopular: number | null;
  hitRatePopularLow: number | null;
  hitRatePopularHigh: number | null;
  hitRateRandom: number | null;
  hitRateRandomLow: number | null;
  hitRateRandomHigh: number | null;
  methodologyMismatch: boolean;
  measuredLift: MeasuredLift | null;
  holdout: HoldoutRecord;
  brandKeys: BrandKeyLink[];
  seasonal: SeasonalNote | null;
  modelReady: boolean;
  features: FeatureRow[];
  qualityNote: string | null;
  inferredRenewals: number;
  nps: RawNps[];
}

export function buildWorkspace(input: WorkspaceInput): Workspace {
  assertStableIdColumn(input.config.stableIdColumn);
  const graph = new UnionFind();
  const visitNodes = new Set<string>();
  const eventsByVisit = new Map<string, RawEvent[]>();

  for (const event of input.events) {
    const rawStable = String(event[input.config.stableIdColumn] ?? "");
    if (!rawStable) continue;
    const visit = nodeKey("visit", rawStable);
    visitNodes.add(visit);
    graph.add(visit);
    graph.mark(visit);
    const email = event.user_email ? String(event.user_email) : "";
    const userId = event.user_id ? String(event.user_id) : "";
    const phone = event.phone ? String(event.phone) : event.user_phone ? String(event.user_phone) : "";
    if (email) graph.union(visit, nodeKey("email", email));
    if (userId) graph.union(visit, nodeKey("user", userId));
    if (phone) graph.union(visit, nodeKey("phone", phone));
    const list = eventsByVisit.get(visit) ?? [];
    list.push(event);
    eventsByVisit.set(visit, list);
  }

  const ordersByEntity = new Map<string, OrderRow[]>();
  const keyDrafts: Array<{ entityId: string | null; customerId?: string; orderId: string }> = [];
  const orders: OrderRow[] = input.orders.map((order) => {
    const emailNode = order.email ? nodeKey("email", order.email) : "";
    const userNode = order.customer_id ? nodeKey("user", order.customer_id) : "";
    const phoneRaw = (order as RawOrder & { phone?: string }).phone;
    const phoneNode = phoneRaw ? nodeKey("phone", phoneRaw) : "";
    if (emailNode) graph.add(emailNode);
    if (userNode) graph.add(userNode);
    if (phoneNode) graph.add(phoneNode);
    if (emailNode && userNode) graph.union(emailNode, userNode);
    if (emailNode && phoneNode) graph.union(emailNode, phoneNode);
    let entity: string | null = null;
    const candidates = [emailNode, userNode, phoneNode].filter(Boolean);
    for (const node of candidates) {
      if (!graph.marked(node)) continue;
      entity = graph.find(node);
      break;
    }
    const row: OrderRow = {
      order_id: order.order_id,
      entity_id: entity,
      purchased_at: order.created_at,
      sku: order.sku,
      product_name: order.product_name,
      revenue: order.revenue,
      status: order.status,
      is_subscription_renewal: order.is_subscription_renewal,
      orphan: entity === null,
      countsAsOrder: order.counts_as_order !== false,
      email_hash: order.email ? piiHmac(order.email) : undefined,
      quantity: order.quantity,
    };
    keyDrafts.push({ entityId: entity, customerId: order.customer_id, orderId: order.order_id });
    if (entity) {
      const bucket = ordersByEntity.get(entity) ?? [];
      bucket.push(row);
      ordersByEntity.set(entity, bucket);
    }
    return row;
  });
  const brandKeys = collectBrandKeys(keyDrafts);
  const inferredRenewals = applyInferredRenewals(orders);

  const visitsByRoot = new Map<string, string[]>();
  for (const visit of visitNodes) {
    const root = graph.find(visit);
    const list = visitsByRoot.get(root) ?? [];
    list.push(visit);
    visitsByRoot.set(root, list);
  }
  const eventsByEntity = new Map<string, RawEvent[]>();
  for (const [root, visits] of visitsByRoot) {
    const rows: RawEvent[] = [];
    for (const visit of visits) rows.push(...(eventsByVisit.get(visit) ?? []));
    eventsByEntity.set(root, rows);
  }

  const asOfMs = Date.parse(input.config.asOf);
  const entities: EntityRow[] = [...visitsByRoot.keys()].map((entityId) => {
    const events = (eventsByEntity.get(entityId) ?? []).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const purchases = (ordersByEntity.get(entityId) ?? [])
      .filter((order) => order.status === "paid" && !order.is_subscription_renewal && order.countsAsOrder)
      .sort((a, b) => a.purchased_at.localeCompare(b.purchased_at));
    const firstEvent = events[0];
    const firstPurchase = purchases[0] ?? null;
    const firstSeen = firstEvent ? String(firstEvent.timestamp) : firstPurchase?.purchased_at ?? input.config.asOf;
    const lastSite = [...events].reverse().find((event) => isSiteEvent(event.event_name));
    const lastSeen = lastSite ? String(lastSite.timestamp) : firstSeen;
    const afterPurchase = Boolean(firstPurchase && Date.parse(firstSeen) > Date.parse(firstPurchase.purchased_at));
    const purchaseMs = firstPurchase ? Date.parse(firstPurchase.purchased_at) : null;
    const beforePurchase = purchaseMs === null ? events : events.filter((event) => Date.parse(String(event.timestamp)) <= purchaseMs);
    const names = new Set(beforePurchase.map((event) => event.event_name));
    const sawPdp = [...names].some((name) => name === "view_pdp" || name === "view_product");
    const scrolled = beforePurchase.some((event) => String(event.event_name).startsWith("scroll"));
    const clicked = [...names].some((name) => name === "ui_click_cta" || name === "ui_click");
    const checkout = names.has("view_checkout");
    const purchased = purchases.length > 0;
    const depth = purchased ? 5 : checkout ? 4 : clicked ? 3 : sawPdp ? 2 : events.length ? 1 : 0;
    const device = String(firstEvent?.device_type ?? "desktop");
    const source = String(firstEvent?.utm_source ?? "");
    const medium = String(firstEvent?.utm_medium ?? "");
    return {
      entity_id: entityId,
      first_seen_at: firstSeen,
      last_seen_at: lastSeen,
      first_touch_channel: channelGroup(source, medium),
      device,
      user_type: purchased ? "buyer" : "visitor",
      converted: purchased,
      first_purchase_at: firstPurchase?.purchased_at ?? null,
      second_purchase_at: purchases[1]?.purchased_at ?? null,
      last_purchase_at: purchases.at(-1)?.purchased_at ?? null,
      ltv: purchases.reduce((sum, order) => sum + order.revenue, 0),
      n_orders: purchases.length,
      first_sku: firstPurchase?.sku ?? null,
      saw_pdp: sawPdp,
      scrolled,
      clicked_cta: clicked,
      checkout,
      purchased,
      attribution_after_purchase: afterPurchase,
      funnel_depth: depth,
      age_days: firstPurchase ? (asOfMs - Date.parse(firstPurchase.purchased_at)) / 86_400_000 : null,
    };
  });

  const exposures: ExposureRow[] = [];
  for (const event of input.events) {
    if (event.event_name !== "experiment_exposure") continue;
    const rawStable = String(event[input.config.stableIdColumn] ?? "");
    if (!rawStable) continue;
    const entity = graph.find(nodeKey("visit", rawStable));
    exposures.push({
      experiment_id: String(event.experiment_id ?? ""),
      variant: String(event.variant ?? "control"),
      entity_id: entity,
      exposed_at: String(event.timestamp),
      device_type: String(event.device_type ?? "desktop"),
      channel_group: channelGroup(String(event.utm_source ?? ""), String(event.utm_medium ?? "")),
      user_type: String(event.user_type ?? "new"),
      in_holdout: Boolean(event.in_holdout),
      reached_checkout_after: false,
    });
  }

  const matchedRevenue = orders.filter((order) => !order.orphan).reduce((sum, order) => sum + order.revenue, 0);
  const allRevenue = orders.reduce((sum, order) => sum + order.revenue, 0);
  const orphanRevenue = orders.filter((order) => order.orphan).reduce((sum, order) => sum + order.revenue, 0);
  const identityCoverage = allRevenue ? matchedRevenue / allRevenue : 0;
  const withStable = input.events.filter((event) => event[input.config.stableIdColumn]).length;
  const lowIdentityInput = withStable / Math.max(input.events.length, 1) < 0.5;

  const prior = input.prior ?? emptyPrior();
  const model = trainRecs({
    orders,
    asOf: input.config.asOf,
    skuRoles: input.config.skuRoles,
    prior,
    brandId: input.config.brandId,
  });
  const previousLines = (input.previousSnapshot ?? []).map((line) => normalizeSnapshotLine(line));
  const methodologyMismatch =
    previousLines.length > 0 && previousLines.some((line) => line.methodology_version !== methodologyOf(input.config));
  const scored =
    !methodologyMismatch && input.previousSnapshot
      ? scoreSnapshot({
          snapshot: previousLines,
          orders,
          windowDays: input.config.windowDays,
          asOf: input.config.asOf,
          skuRoles: input.config.skuRoles,
          config: input.config,
        })
      : null;
  const measured =
    !methodologyMismatch && previousLines.some((line) => line.arm)
      ? measureLift({
          snapshot: previousLines,
          orders,
          windowDays: input.config.windowDays,
          asOf: input.config.asOf,
        })
      : null;

  const metrics = computeMetrics(entities, orders, exposures, input.config);
  const sql: Record<string, string> = {};
  for (const def of liveDefinitions(input.config.windowDays)) sql[def.name] = compileSql(def);
  const nps = (input.nps ?? []).map((row) => {
    const emailHash = row.email ? piiHmac(row.email) : row.email_hash;
    const { email: _email, ...rest } = row;
    void _email;
    return { ...rest, email_hash: emailHash };
  });

  return {
    entities,
    orders,
    exposures,
    metrics,
    sql,
    identityCoverage,
    orphanRevenue,
    lowJoin: identityCoverage < 0.2,
    lowIdentityInput,
    model,
    hitRate: scored?.hitRate ?? null,
    hitRateLow: scored?.hitRateLow ?? null,
    hitRateHigh: scored?.hitRateHigh ?? null,
    hitRatePopular: scored?.hitRatePopular ?? null,
    hitRatePopularLow: scored?.hitRatePopularLow ?? null,
    hitRatePopularHigh: scored?.hitRatePopularHigh ?? null,
    hitRateRandom: scored?.hitRateRandom ?? null,
    hitRateRandomLow: scored?.hitRateRandomLow ?? null,
    hitRateRandomHigh: scored?.hitRateRandomHigh ?? null,
    methodologyMismatch,
    measuredLift: measured && measured.ready ? measured : null,
    holdout: emptyHoldout(),
    brandKeys,
    seasonal:
      measured && measured.ready
        ? seasonalNote({
            snapshot: previousLines,
            orders,
            windowDays: input.config.windowDays,
            asOf: input.config.asOf,
          })
        : null,
    modelReady: scored !== null,
    features: featuresFor({
      entities,
      ordersByEntity,
      eventsByEntity,
      nps,
      skuRoles: input.config.skuRoles,
      sampleEvery: input.config.sampleEvery,
      replenishmentLow: input.config.replenishmentLow,
      replenishmentHigh: input.config.replenishmentHigh,
    }),
    qualityNote: qualityNote(orders, input.previousOrders),
    inferredRenewals,
    nps,
  };
}

function liveDefinitions(windowDays: number): MetricDef[] {
  return [
    {
      name: "identity_coverage",
      description: "coverage",
      owner: "platform",
      domain: "identity",
      status: "live",
      grain: "order",
      measure: { op: "ratio", numerator: { op: "sum", field: "matched_revenue" }, denominator: { op: "sum", field: "revenue" } },
      dimensions: [],
      filters: [],
      window: null,
    },
    {
      name: "repeat_rate",
      description: "repeat",
      owner: "platform",
      domain: "loyalty",
      status: "live",
      grain: "entity",
      measure: { op: "window", days: windowDays, inner: { op: "ratio", numerator: { op: "count" }, denominator: { op: "count" } } },
      dimensions: [],
      filters: [],
      window: windowDays,
    },
  ];
}

function computeMetrics(
  entities: EntityRow[],
  orders: OrderRow[],
  exposures: ExposureRow[],
  config: RunConfig,
): MetricTable[] {
  const matched = orders.filter((order) => !order.orphan).reduce((sum, order) => sum + order.revenue, 0);
  const total = orders.reduce((sum, order) => sum + order.revenue, 0);
  const orphan = total - matched;
  const weight = config.sampleEvery && config.sampleEvery > 1 ? config.sampleEvery : 1;
  const estimate = weight > 1;
  const scale = (value: number) => value * weight;
  const repeat = repeatWithin(entities, config.windowDays);
  const channels = new Map<string, { users: number; orders: number; revenue: number }>();
  for (const entity of entities) {
    if (entity.attribution_after_purchase) continue;
    const row = channels.get(entity.first_touch_channel) ?? { users: 0, orders: 0, revenue: 0 };
    row.users += weight;
    if (entity.converted) {
      row.orders += entity.n_orders * weight;
      row.revenue += entity.ltv * weight;
    }
    channels.set(entity.first_touch_channel, row);
  }
  const stages = ["visit", "pdp", "cta", "checkout", "purchase"];
  const funnelRows = stages.map((stage, index) => ({
    stage,
    lifetime: scale(entities.filter((entity) => entity.funnel_depth >= index + 1).length),
    last_90d: scale(
      entities.filter((entity) => {
        const recent = Date.parse(config.asOf) - Date.parse(entity.first_seen_at) <= 90 * 86_400_000;
        return recent && entity.funnel_depth >= index + 1;
      }).length,
    ),
    estimate,
  }));
  const exposureCounts = new Map<string, number>();
  const seen = new Set<string>();
  for (const row of [...exposures].sort((a, b) => a.exposed_at.localeCompare(b.exposed_at))) {
    const key = `${row.experiment_id}:${row.entity_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bucket = `${row.experiment_id}|${row.variant}|${row.in_holdout}`;
    exposureCounts.set(bucket, (exposureCounts.get(bucket) ?? 0) + 1);
  }
  return [
    {
      name: "identity_coverage",
      columns: ["value"],
      rows: [{ value: total ? matched / total : 0 }],
    },
    {
      name: "orphan_revenue",
      columns: ["value"],
      rows: [{ value: orphan }],
    },
    {
      name: "attribution_first_touch",
      columns: ["channel_group", "users", "orders", "revenue"],
      rows: [...channels.entries()].map(([channel, row]) => ({
        channel_group: channel,
        users: row.users,
        orders: row.orders,
        revenue: row.revenue,
      })),
    },
    {
      name: "site_funnel",
      columns: ["stage", "lifetime", "last_90d"],
      rows: funnelRows,
    },
    {
      name: "repeat_rate",
      columns: ["mature", "repeated", "value"],
      rows: [{ mature: repeat.n, repeated: repeat.successes, value: repeat.p, low: repeat.low, high: repeat.high, estimate }],
    },
    {
      name: "experiment_exposures",
      columns: ["experiment_id", "variant", "in_holdout", "n"],
      rows: [...exposureCounts.entries()].map(([bucket, n]) => {
        const [experiment_id, variant, holdout] = bucket.split("|");
        return { experiment_id, variant, in_holdout: holdout === "true", n };
      }),
    },
  ];
}

export function metricValue(workspace: Workspace, name: string): number {
  const table = workspace.metrics.find((item) => item.name === name);
  const value = table?.rows[0]?.value;
  return typeof value === "number" ? value : 0;
}

export interface ObservedCycle {
  low: number;
  high: number;
  n: number;
  fromData: boolean;
  hazardPeak: number | null;
  curve: SurvivalPoint[];
  median: number | null;
  q25: number | null;
}

/** Pseudo-counts pulling a small Kaplan–Meier estimate toward the category prior. Not a hard switch at 20 pairs. */
const CYCLE_PRIOR = 8;

export function observedCycle(entities: EntityRow[], config: RunConfig): ObservedCycle {
  const asOf = Date.parse(config.asOf);
  const observations: Array<{ time: number; event: boolean }> = [];
  for (const entity of entities) {
    if (!entity.first_purchase_at) continue;
    const start = Date.parse(entity.first_purchase_at);
    if (!Number.isFinite(start) || start > asOf) continue;
    if (entity.second_purchase_at) {
      const second = Date.parse(entity.second_purchase_at);
      if (second >= start && second <= asOf) {
        observations.push({ time: (second - start) / 86_400_000, event: true });
        continue;
      }
    }
    const follow = entity.age_days !== null ? entity.age_days : (asOf - start) / 86_400_000;
    if (follow >= 0) observations.push({ time: follow, event: false });
  }
  const fit = kaplanMeier(observations);
  const weight = fit.events / (fit.events + CYCLE_PRIOR);
  const dataLow = fit.q25 ?? config.replenishmentLow;
  const dataHigh = fit.median ?? config.replenishmentHigh;
  const low = fit.events ? Math.max(1, Math.round(weight * dataLow + (1 - weight) * config.replenishmentLow)) : config.replenishmentLow;
  const high = fit.events
    ? Math.max(low, Math.round(weight * dataHigh + (1 - weight) * config.replenishmentHigh))
    : config.replenishmentHigh;
  return {
    low,
    high,
    n: fit.events,
    fromData: weight >= 0.5 && fit.median !== null,
    hazardPeak: fit.hazardPeak,
    curve: fit.curve,
    median: fit.median,
    q25: fit.q25,
  };
}

export interface FunnelGap {
  from: string;
  to: string;
  fromN: number;
  toN: number;
  drop: number;
}

export interface WeekWindow {
  from: string;
  to: string;
  visits: number;
  payments: number;
  newBuyers: number;
  repeatPayments: number;
}

export function weekWindow(entities: EntityRow[], orders: OrderRow[], asOf: string): WeekWindow {
  const to = asOf.slice(0, 10);
  const from = new Date(Date.parse(to) - 6 * 86_400_000).toISOString().slice(0, 10);
  const inWeek = (iso: string) => {
    const day = iso.slice(0, 10);
    return day >= from && day <= to;
  };
  const visits = entities.filter((entity) => inWeek(entity.last_seen_at || entity.first_seen_at)).length;
  const paid = orders.filter(
    (order) => order.status === "paid" && !order.is_subscription_renewal && order.countsAsOrder && inWeek(order.purchased_at),
  );
  const firstPaid = new Map<string, string>();
  const dated = [...orders].sort((a, b) => a.purchased_at.localeCompare(b.purchased_at));
  for (const order of dated) {
    if (order.status !== "paid" || order.is_subscription_renewal || !order.countsAsOrder || !order.entity_id) continue;
    if (!firstPaid.has(order.entity_id)) firstPaid.set(order.entity_id, order.purchased_at);
  }
  const newBuyers = new Set(
    paid.filter((order) => order.entity_id && firstPaid.get(order.entity_id) === order.purchased_at).map((order) => order.entity_id),
  ).size;
  const repeatPayments = paid.filter((order) => order.entity_id && firstPaid.get(order.entity_id) !== order.purchased_at).length;
  return { from, to, visits, payments: paid.length, newBuyers, repeatPayments };
}

function isSiteEvent(name: string): boolean {
  return name.startsWith("view_") || name.startsWith("scroll") || name.startsWith("ui_click") || name === "remove_from_cart";
}

export function funnelGap(rows: MetricTable["rows"]): FunnelGap {
  let best: FunnelGap = { from: "", to: "", fromN: 0, toN: 0, drop: 0 };
  for (let index = 1; index < rows.length; index += 1) {
    const fromN = Number(rows[index - 1]?.lifetime ?? 0);
    const toN = Number(rows[index]?.lifetime ?? 0);
    const drop = fromN - toN;
    if (drop > best.drop) {
      best = { from: String(rows[index - 1]?.stage ?? ""), to: String(rows[index]?.stage ?? ""), fromN, toN, drop };
    }
  }
  return best;
}

export interface Pocket {
  id: string;
  title: string;
  who: string;
  size: number;
  revenue: number;
  evidence: string[];
  fromStage?: string;
  toStage?: string;
  fromCount?: number;
  toCount?: number;
  friction?: number;
}

function recencyDays(entity: EntityRow, asOf: string): number | null {
  if (!entity.last_purchase_at) return null;
  return (Date.parse(asOf) - Date.parse(entity.last_purchase_at)) / 86_400_000;
}

export function queryDiagnostic(workspace: Workspace, config: RunConfig): Pocket[] {
  const cycle = observedCycle(workspace.entities, config);
  const buyers = workspace.entities.filter((entity) => entity.converted && entity.last_purchase_at);
  const past = (entity: EntityRow) => {
    const recency = recencyDays(entity, config.asOf);
    return recency !== null && recency > cycle.high;
  };
  const lost = buyers.filter((entity) => past(entity) && entity.n_orders >= 2);
  const risk = buyers.filter((entity) => past(entity) && entity.n_orders < 2);
  const friction = workspace.entities.filter(
    (entity) => !entity.converted && entity.saw_pdp && entity.scrolled && !entity.clicked_cta,
  );
  const gap = funnelGap(workspace.metrics.find((table) => table.name === "site_funnel")?.rows ?? []);
  const pockets: Pocket[] = [];
  if (gap.drop > 0) {
    pockets.push({
      id: "drop",
      title: "Plus grand décrochage du site",
      who: `${gap.from} ${gap.fromN} → ${gap.to} ${gap.toN}`,
      size: gap.drop,
      revenue: 0,
      evidence: ["site_funnel"],
      fromStage: gap.from,
      toStage: gap.to,
      fromCount: gap.fromN,
      toCount: gap.toN,
      friction: friction.length,
    });
  }
  if (risk.length) {
    pockets.push({
      id: "risk",
      title: "Un seul achat au-delà du cycle",
      who: "un seul achat, récence au-delà du cycle observé",
      size: risk.length,
      revenue: risk.reduce((sum, entity) => sum + entity.ltv, 0),
      evidence: ["recency"],
    });
  }
  if (lost.length) {
    pockets.push({
      id: "lost",
      title: "Déjà rachetés, silencieux",
      who: "au moins deux achats, récence au-delà du cycle observé",
      size: lost.length,
      revenue: lost.reduce((sum, entity) => sum + entity.ltv, 0),
      evidence: ["rfm", "repeat_rate"],
    });
  }
  return pockets.slice(0, 3);
}

/** People the Monday letter is about: one purchase past the cycle, else the repeaters past the cycle. Not the site drop. */
export function letterSegment(workspace: Workspace, config: RunConfig): EntityRow[] {
  const cycle = observedCycle(workspace.entities, config);
  const buyers = workspace.entities.filter((entity) => entity.converted && entity.last_purchase_at);
  const past = (entity: EntityRow) => {
    const recency = recencyDays(entity, config.asOf);
    return recency !== null && recency > cycle.high;
  };
  const risk = buyers.filter((entity) => past(entity) && entity.n_orders < 2);
  if (risk.length) return risk;
  return buyers.filter((entity) => past(entity) && entity.n_orders >= 2);
}

export function writeReportSnapshot(input: {
  workspace: Workspace;
  config: RunConfig;
  pockets: Pocket[];
  prior: PriorStore;
}): { recommendations: Recommendation[]; fallback: number; snapshot: SnapshotLine[] } {
  const segment = letterSegment(input.workspace, input.config);
  const buyers = input.workspace.entities.filter((entity) => entity.converted);
  // A Monday letter segment is snapshotted in full. The first-twenty slice stays only when that segment is empty, so a later cut can still score hit rate.
  const chosen = segment.length ? segment : buyers.slice(0, 20);
  const recommendations: Recommendation[] = chosen.map((entity) => {
    const owned = input.workspace.orders
      .filter(
        (order) =>
          order.entity_id === entity.entity_id &&
          order.status === "paid" &&
          !order.is_subscription_renewal &&
          Date.parse(order.purchased_at) < Date.parse(input.config.asOf),
      )
      .map((order) => order.sku);
    return recommendFor(input.workspace.model, entity.entity_id, owned, input.prior);
  });
  const snapshot: SnapshotLine[] = recommendations.map((line, index) => ({
    entity_id: line.entity_id,
    sku: line.sku,
    rank: index + 1,
    model_version: "item-item-v1",
    as_of: input.config.asOf,
    role: input.config.skuRoles[line.sku] ?? "unknown",
    score: line.score,
    bucket: null,
    arm: null,
    methodology_version: methodologyOf(input.config),
    config_hash: input.config.configHash || hashRunConfig(input.config),
  }));
  bucketByScore(snapshot);
  assignArms(snapshot, `${input.config.brandId}:${input.config.asOf}`);
  replaceBrandPrior(
    input.prior,
    input.config.brandId,
    rolePairCounts(input.workspace.orders, input.config.asOf, input.config.skuRoles),
  );
  return { recommendations, fallback: fallbackRate(recommendations), snapshot };
}

export function playgroundRecommend(
  workspace: Workspace,
  entityId: string,
  prior: PriorStore,
): Recommendation {
  const owned = workspace.orders
    .filter((order) => order.entity_id === entityId && order.status === "paid" && !order.is_subscription_renewal)
    .map((order) => order.sku);
  return recommendFor(workspace.model, entityId, owned, prior);
}
