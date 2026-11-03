import { readFileSync } from "node:fs";
import { buildWorkspace, queryDiagnostic } from "../src/engine/pipeline";
import { experimentReadiness } from "../src/engine/experiments";
import { LUMIERE_CONFIG } from "../src/engine/demo";
import type { RawEvent, RawOrder } from "../src/engine/types";

const root = new URL("../data/rees46-cosmetics/", import.meta.url);
const events = JSON.parse(readFileSync(new URL("events.json", root), "utf8")) as RawEvent[];
const orders = readFileSync(new URL("orders.csv", root), "utf8")
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .filter(Boolean)
  .map((line) => {
    const [order_id, customer_id, created_at, sku, product_name, quantity, revenue, status, renewal] = line.split(",");
    return {
      order_id,
      customer_id,
      created_at,
      sku,
      product_name,
      quantity: Number(quantity),
      revenue: Number(revenue),
      status: (status || "paid") as RawOrder["status"],
      is_subscription_renewal: renewal === "true",
    } satisfies RawOrder;
  });

const asOf = [...orders.map((order) => order.created_at), ...events.map((event) => String(event.timestamp))]
  .reduce((max, value) => (value.slice(0, 10) > max ? value.slice(0, 10) : max), "");

const started = Date.now();
const workspace = buildWorkspace({
  events,
  orders,
  config: {
    ...LUMIERE_CONFIG,
    asOf,
    stableIdColumn: "user_session",
    brandId: "rees46-cosmetics",
    skuRoles: {},
  },
});
const pockets = queryDiagnostic(workspace, { ...LUMIERE_CONFIG, asOf, stableIdColumn: "user_session", brandId: "rees46-cosmetics", skuRoles: {} });
const experiments = experimentReadiness(workspace.exposures, asOf);
const funnel = workspace.metrics.find((table) => table.name === "site_funnel");
const repeat = workspace.metrics.find((table) => table.name === "repeat_rate")?.rows[0];
const channels = workspace.metrics.find((table) => table.name === "attribution_first_touch");

console.log(JSON.stringify({
  seconds: Math.round((Date.now() - started) / 100) / 10,
  asOf,
  events: events.length,
  orders: orders.length,
  entities: workspace.entities.length,
  buyers: workspace.entities.filter((entity) => entity.converted).length,
  coverage: workspace.identityCoverage,
  orphanRevenue: workspace.orphanRevenue,
  repeat,
  funnel: funnel?.rows,
  channels: channels?.rows,
  pockets: pockets.map((pocket) => ({ id: pocket.id, size: pocket.size, revenue: Math.round(pocket.revenue) })),
  experiments: experiments.length,
}, null, 2));
