import type { RawEvent, RawOrder } from "./types";

export interface PilotCheck {
  id: string;
  label: string;
  met: boolean;
  detail: string;
}

export interface PilotChecklist {
  buyers: number;
  repeatPurchases: number;
  nonBuyerEmailEvents: number;
  spanDays: number;
  customerIdOrders: number;
  sentWithKey: number;
  openedWithKey: number;
  items: PilotCheck[];
}

const WINDOW_DAYS = 120;

/** Counts already produced by recognize. Nothing here is filled in when the file lacks the field. */
export function pilotChecklist(input: { events: RawEvent[]; orders: RawOrder[] }, windowDays = WINDOW_DAYS): PilotChecklist {
  const buyers = new Map<string, number>();
  let customerIdOrders = 0;
  for (const order of input.orders) {
    if (order.counts_as_order === false || order.is_subscription_renewal) continue;
    if (order.status === "cancelled" || order.status === "refunded") continue;
    if (filled(order.customer_id)) customerIdOrders += 1;
    const key = buyerKey(order);
    if (!key) continue;
    buyers.set(key, (buyers.get(key) ?? 0) + 1);
  }
  let repeatPurchases = 0;
  for (const count of buyers.values()) if (count >= 2) repeatPurchases += count - 1;

  const buyerEmails = new Set<string>();
  const buyerIds = new Set<string>();
  for (const order of input.orders) {
    if (order.counts_as_order === false || order.is_subscription_renewal) continue;
    if (order.status === "cancelled" || order.status === "refunded") continue;
    if (filled(order.email)) buyerEmails.add(order.email.trim().toLowerCase());
    if (filled(order.customer_id)) buyerIds.add(order.customer_id.trim());
  }
  let nonBuyerEmailEvents = 0;
  let sentWithKey = 0;
  let openedWithKey = 0;
  const stamps: number[] = [];
  for (const event of input.events) {
    const ts = Date.parse(String(event.timestamp ?? ""));
    if (Number.isFinite(ts)) stamps.push(ts);
    const email = typeof event.user_email === "string" ? event.user_email.trim().toLowerCase() : "";
    const userId = typeof event.user_id === "string" ? event.user_id.trim() : "";
    const customer = typeof event.customer_id === "string" ? event.customer_id.trim() : "";
    if (email && !buyerEmails.has(email) && !(userId && buyerIds.has(userId))) nonBuyerEmailEvents += 1;
    const keyed = Boolean(userId || customer);
    if (keyed && (event.event_name === "email_sent" || event.event_name === "message_sent")) sentWithKey += 1;
    if (keyed && (event.event_name === "email_open" || event.event_name === "email_opened")) openedWithKey += 1;
  }
  for (const order of input.orders) {
    const ts = Date.parse(order.created_at);
    if (Number.isFinite(ts)) stamps.push(ts);
  }
  const spanDays = stamps.length >= 2 ? (Math.max(...stamps) - Math.min(...stamps)) / 86_400_000 : 0;
  const buyerCount = buyers.size;
  const windowsMet = spanDays + 1e-9 >= windowDays * 2;
  const items: PilotCheck[] = [
    {
      id: "buyers",
      label: "Не меньше 300 покупателей",
      met: buyerCount >= 300,
      detail: `В файле ${buyerCount} покупателей. Продления не входят.`,
    },
    {
      id: "repeats",
      label: "Не меньше 100 повторных покупок",
      met: repeatPurchases >= 100,
      detail: `Повторных покупок ${repeatPurchases}. Продления не входят.`,
    },
    {
      id: "nonbuyer-email",
      label: "Почта у непокупателей",
      met: nonBuyerEmailEvents > 0,
      detail: nonBuyerEmailEvents
        ? `Событий с почтой у непокупателей: ${nonBuyerEmailEvents}.`
        : "Событий с почтой у непокупателей нет.",
    },
    {
      id: "windows",
      label: "Не меньше двух окон по 120 дней",
      met: windowsMet,
      detail: `От первой до последней даты ${Math.round(spanDays)} дней.`,
    },
    {
      id: "customer-id",
      label: "customer_id в заказах и в Klaviyo",
      met: false,
      detail:
        customerIdOrders > 0
          ? `customer_id есть у ${customerIdOrders} заказов. Выгрузки Klaviyo в файле нет, вторая половина галочки не ставится.`
          : "customer_id в заказах нет. Выгрузки Klaviyo в файле нет.",
    },
    {
      id: "sends",
      label: "Желательно: отправка и открытие с тем же ключом",
      met: sentWithKey > 0 && openedWithKey > 0,
      detail: `Отправок с ключом ${sentWithKey}, открытий с ключом ${openedWithKey}.`,
    },
  ];
  return {
    buyers: buyerCount,
    repeatPurchases,
    nonBuyerEmailEvents,
    spanDays,
    customerIdOrders,
    sentWithKey,
    openedWithKey,
    items,
  };
}

function buyerKey(order: RawOrder): string {
  if (filled(order.customer_id)) return `id:${order.customer_id.trim()}`;
  if (filled(order.email)) return `email:${order.email.trim().toLowerCase()}`;
  return "";
}

function filled(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
