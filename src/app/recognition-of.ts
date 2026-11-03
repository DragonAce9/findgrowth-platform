import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RECOGNITION_VERSION, recognizeRaw, type Recognition } from "@/engine/recognize";
import type { StoredRun } from "@/engine/store";
import type { RawEvent, RawOrder } from "@/engine/types";

export function recognitionOf(stored: StoredRun): Recognition {
  if (stored.recognition?.version === RECOGNITION_VERSION) return stored.recognition;
  if (stored.config.brandId === "rees46-cosmetics") {
    const dir = join(process.cwd(), "data/rees46-cosmetics");
    const eventsPath = join(dir, "events.json");
    const ordersPath = join(dir, "orders.csv");
    if (existsSync(eventsPath) && existsSync(ordersPath)) {
      const events = JSON.parse(readFileSync(eventsPath, "utf8")) as RawEvent[];
      const orders = parseOrders(readFileSync(ordersPath, "utf8"));
      stored.recognition = recognizeRaw({
        events,
        orders,
        stableIdColumn: stored.config.stableIdColumn,
        declaredCurrency: stored.config.currency,
      });
      return stored.recognition;
    }
  }
  stored.recognition = recognizeRaw({
    events: [],
    orders: [],
    stableIdColumn: stored.config.stableIdColumn,
    declaredCurrency: stored.config.currency,
  });
  return stored.recognition;
}

function parseOrders(text: string): RawOrder[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",").map((cell) => cell.trim());
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = line.split(",");
    const row = Object.fromEntries(header.map((key, index) => [key, cells[index]?.trim() ?? ""]));
    return {
      order_id: row.order_id,
      email: row.email,
      customer_id: row.customer_id,
      created_at: row.created_at,
      sku: row.sku,
      product_name: row.product_name || row.sku,
      quantity: Number(row.quantity || 1),
      revenue: Number(row.revenue || 0),
      status: (row.status || "paid") as RawOrder["status"],
      is_subscription_renewal: row.is_subscription_renewal === "true",
    };
  });
}
