import { formatPct } from "./client-copy";
import type { Recognition } from "./recognize";
import type { EntityRow, OrderRow, RunConfig } from "./types";

export interface ProductLine {
  name: string;
  mature: number;
  repeated: number;
}

export interface ChannelCut {
  channel: string;
  once: number;
  again: number;
}

export interface LetterRates {
  sent: number;
  opened: number;
  unsub: number;
}

export function firstProductLines(entities: EntityRow[], orders: OrderRow[], windowDays: number): ProductLine[] {
  const names = new Map<string, string>();
  const dated = [...orders].sort((a, b) => a.purchased_at.localeCompare(b.purchased_at));
  for (const order of dated) {
    if (order.status !== "paid" || order.is_subscription_renewal || !order.countsAsOrder) continue;
    if (names.has(order.sku)) continue;
    const named = order.product_name && !/^\d+$/.test(order.product_name) ? order.product_name : order.sku;
    names.set(order.sku, named);
  }
  const grouped = new Map<string, ProductLine>();
  for (const entity of entities) {
    if (!entity.converted || !entity.first_sku || entity.age_days === null || entity.age_days < windowDays) continue;
    const name = names.get(entity.first_sku) ?? entity.first_sku;
    const row = grouped.get(name) ?? { name, mature: 0, repeated: 0 };
    row.mature += 1;
    if (entity.n_orders >= 2) row.repeated += 1;
    grouped.set(name, row);
  }
  const ranked = [...grouped.values()].sort((a, b) => b.mature - a.mature || a.name.localeCompare(b.name));
  const floor = ranked.some((row) => row.mature >= 8) ? 8 : ranked.some((row) => row.mature >= 3) ? 3 : 1;
  return ranked
    .filter((row) => row.mature >= floor)
    .slice(0, 6)
    .sort((a, b) => b.repeated / b.mature - a.repeated / a.mature || a.name.localeCompare(b.name));
}

export function channelCuts(entities: EntityRow[]): ChannelCut[] {
  const grouped = new Map<string, ChannelCut>();
  for (const entity of entities) {
    if (!entity.converted || entity.attribution_after_purchase) continue;
    const channel = entity.first_touch_channel || "direct";
    const row = grouped.get(channel) ?? { channel, once: 0, again: 0 };
    if (entity.n_orders >= 2) row.again += 1;
    else row.once += 1;
    grouped.set(channel, row);
  }
  return [...grouped.values()].sort((a, b) => b.once + b.again - (a.once + a.again) || a.channel.localeCompare(b.channel));
}

export function letterRates(recognition: Recognition): LetterRates | null {
  const group = recognition.groups?.find((item) => item.id === "letters");
  if (!group) return null;
  const read = (id: string) => {
    const slot = group.slots.find((item) => item.id === id);
    if (!slot?.found) return 0;
    const value = Number(String(slot.value).replace(/[^\d]/g, ""));
    return Number.isFinite(value) ? value : 0;
  };
  const rates = { sent: read("sent"), opened: read("opened"), unsub: read("unsub") };
  if (rates.sent + rates.opened + rates.unsub === 0) return null;
  return rates;
}

export function brandLimits(config: RunConfig): Array<{ title: string; text: string }> {
  const rows = [
    { title: "Состав", text: config.formulation ?? "" },
    { title: "Ограничение", text: config.constraint ?? "" },
    { title: "Позиционирование", text: config.positioning ?? "" },
  ];
  return rows.filter((row) => row.text.trim().length > 0);
}

export function hitSentence(
  hitRate: number | null,
  hitRatePopular: number | null,
  windowDays: number,
  extra?: {
    low: number;
    high: number;
    random: number | null;
    randomLow?: number | null;
    randomHigh?: number | null;
    popularLow?: number | null;
    popularHigh?: number | null;
  },
): string {
  if (hitRate === null || hitRatePopular === null) {
    return windowDays >= 0
      ? "Второго среза нет. Сравнить покупки из прошлого списка с частым товаром роли ещё нечем."
      : "Второго среза нет.";
  }
  const band = extra ? ` (${formatPct(extra.low)}\u2013${formatPct(extra.high)})` : "";
  const popularBand =
    extra?.popularLow !== null && extra?.popularLow !== undefined && extra?.popularHigh !== null && extra?.popularHigh !== undefined
      ? ` (${formatPct(extra.popularLow)}\u2013${formatPct(extra.popularHigh)})`
      : "";
  const randomBand =
    extra?.randomLow !== null && extra?.randomLow !== undefined && extra?.randomHigh !== null && extra?.randomHigh !== undefined
      ? ` (${formatPct(extra.randomLow)}\u2013${formatPct(extra.randomHigh)})`
      : "";
  const random =
    extra?.random !== null && extra?.random !== undefined && randomBand
      ? ` Случайный товар из прошлого окна: ${formatPct(extra.random)}${randomBand}.`
      : "";
  return `Прошлый список купили в ${formatPct(hitRate)}${band} случаев. Частый товар роли по покупкам до этого окна: ${formatPct(hitRatePopular)}${popularBand}.${random} Это измеренные доли, не прогноз.`;
}

export function letterDraft(input: {
  kind: "once" | "again";
  pair: { leftName: string; rightName: string; n: number } | null;
  formulation?: string;
  constraint?: string;
  positioning?: string;
}): { subject: string; body: string } {
  const product = input.pair
    ? `${input.pair.rightName} после ${input.pair.leftName}`
    : "товар из последней покупки";
  if (input.kind === "once") {
    return {
      subject: `Следующий шаг ухода — ${product}`,
      body: `Напомнить первую покупку и поставить ${product}. Внизу бесплатный отказ.`,
    };
  }
  return {
    subject: `Вы уже брали — и ${product}`,
    body: "Письмо короче первого. Без скидки в теме. Внизу бесплатный отказ.",
  };
}

export function deliveryChannels(recognition: Recognition): Array<{ channel: string; n: number; send: boolean }> {
  const counts = recognition.eventCounts ?? {};
  const rows = [
    { channel: "email", n: counts.email_sent ?? 0 },
    { channel: "sms", n: counts.sms_sent ?? 0 },
    { channel: "push", n: counts.push_sent ?? 0 },
    { channel: "whatsapp", n: counts.whatsapp_sent ?? counts.wa_sent ?? 0 },
  ];
  return rows.map((row) => ({ ...row, send: false }));
}
