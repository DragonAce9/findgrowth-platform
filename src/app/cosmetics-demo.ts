import { fullDemoDataset, FULL_DEMO_CONFIG } from "@/engine/full-demo";
import { getRun, latestRun, startRun, type StoredRun } from "@/engine/store";
import type { RawOrder } from "@/engine/types";

export function loadFullDemo(): StoredRun {
  const data = fullDemoDataset();
  return startRun({
    events: data.events,
    orders: data.orders,
    nps: data.nps,
    config: { ...FULL_DEMO_CONFIG },
  });
}

export function resolveExportRun(runId?: string): StoredRun {
  if (runId) {
    const run = getRun(runId);
    if (run) return run;
  }
  return latestRun() ?? loadFullDemo();
}

export function parseOrders(text: string): RawOrder[] {
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
