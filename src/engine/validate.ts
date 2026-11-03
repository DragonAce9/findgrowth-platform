import { z } from "zod";
import { csvRecords } from "./csv";
import type { RawEvent, RawOrder } from "./types";

const purchaseStatus = z.enum(["paid", "cancelled", "refunded"]);

export const rawEventSchema = z
  .object({
    event_name: z.string().min(1),
    timestamp: z.string().min(1),
    session_id: z.string(),
  })
  .passthrough();

export const rawOrderSchema = z
  .object({
    order_id: z.string().min(1),
    customer_id: z.string().optional(),
    email: z.string().optional(),
    created_at: z.string().min(1),
    sku: z.string().min(1),
    product_name: z.string(),
    quantity: z.number(),
    revenue: z.number(),
    status: purchaseStatus,
    is_subscription_renewal: z.boolean(),
    currency: z.string().optional(),
    counts_as_order: z.boolean().optional(),
  })
  .passthrough();

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

export function parseEventsJson(text: string): RawEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UploadError("Файл событий не читается: это не JSON.");
  }
  const rows = Array.isArray(parsed) ? parsed : null;
  if (!rows) throw new UploadError("Файл событий не читается: нужен массив JSON.");
  const events: RawEvent[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const result = rawEventSchema.safeParse(rows[index]);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new UploadError(`Файл событий, строка ${index + 1}: ${issue?.path.join(".") || "поле"} — ${issue?.message ?? "не сходится"}.`);
    }
    events.push(result.data as RawEvent);
  }
  return events;
}

export function parseOrdersCsv(text: string): RawOrder[] {
  let records: Array<Record<string, string>>;
  try {
    records = csvRecords(text);
  } catch {
    throw new UploadError("Файл заказов не читается: CSV сломан.");
  }
  if (!records.length) throw new UploadError("Файл заказов пуст.");
  const orders: RawOrder[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const row = records[index];
    const candidate = {
      order_id: row.order_id ?? "",
      customer_id: row.customer_id || undefined,
      email: row.email || undefined,
      created_at: row.created_at ?? "",
      sku: row.sku ?? "",
      product_name: row.product_name || row.sku || "",
      quantity: numberOr(row.quantity, 1),
      revenue: numberOr(row.revenue, Number.NaN),
      status: row.status || "paid",
      is_subscription_renewal: row.is_subscription_renewal === "true" || row.is_subscription_renewal === "1",
      currency: row.currency || undefined,
      counts_as_order: row.counts_as_order === undefined || row.counts_as_order === "" ? undefined : row.counts_as_order !== "false",
      phone: row.phone || undefined,
    };
    const result = rawOrderSchema.safeParse(candidate);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new UploadError(
        `Файл заказов, строка ${index + 2}: ${issue?.path.join(".") || "поле"} — ${issue?.message ?? "не сходится"}.`,
      );
    }
    orders.push(result.data as RawOrder);
  }
  return orders;
}

function numberOr(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}
