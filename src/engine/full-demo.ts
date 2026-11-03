import type { RawEvent, RawNps, RawOrder, RunConfig, SnapshotLine } from "./types";

export const FULL_DEMO_CONFIG: RunConfig = {
  asOf: "2026-09-01",
  windowDays: 120,
  brandId: "demo-full",
  tenantId: "demo",
  projectName: "Atelier",
  stableIdColumn: "anonymous_id",
  category: "cosmetics",
  replenishmentLow: 30,
  replenishmentHigh: 90,
  skuRoles: { serum: "serum", cream: "cream", spf: "spf", mask: "mask" },
  currency: "€",
  dataOrigin: "operator",
  advertisingConsent: true,
  customerNotice: true,
  formulation: "Сыворотка и крем на одной основе. SPF наносится отдельно.",
  constraint: "Не обещать лечебный эффект. Не писать тем, кто отписался.",
  positioning: "Уход для своего покупателя. Тон спокойный, без сравнения с масс-маркетом.",
  marketingSpend: 1200,
  grossMargin: 0.65,
  opex: 1800,
  taxRate: 0.25,
  cash: 12000,
  stageLabels: {
    visit: "Зашли",
    pdp: "Смотрели товар",
    cta: "Положили в корзину",
    checkout: "Оформили",
    purchase: "Купили",
  },
};

const CHANNELS = [
  { source: "google", medium: "cpc", campaign: "brand-search" },
  { source: "instagram", medium: "cpc", campaign: "spring-ig" },
  { source: "google", medium: "organic", campaign: "" },
  { source: "newsletter", medium: "email", campaign: "replenishment" },
  { source: "", medium: "", campaign: "" },
  { source: "blog", medium: "referral", campaign: "" },
];

const PRODUCTS = [
  { sku: "serum", name: "Сыворотка" },
  { sku: "cream", name: "Крем" },
  { sku: "spf", name: "SPF" },
  { sku: "mask", name: "Маска" },
];

export function fullDemoDataset(): { events: RawEvent[]; orders: RawOrder[]; nps: RawNps[] } {
  const events: RawEvent[] = [];
  const orders: RawOrder[] = [];
  const nps: RawNps[] = [];

  for (let i = 0; i < 200; i += 1) {
    const id = `v-${i}`;
    const email = `client${i}@shop.test`;
    const bucket = i % 5;
    const buyer = bucket === 1 || bucket === 2;
    const day = String((i % 20) + 1).padStart(2, "0");
    const stamp = `2026-${buyer ? "03" : "08"}-${day}T10:00:00Z`;
    const channel = CHANNELS[i % CHANNELS.length];
    const device = i % 3 === 0 ? "mobile" : i % 3 === 1 ? "desktop" : "tablet";
    const browser = ["Chrome", "Safari", "Firefox"][i % 3];
    const country = ["FR", "DE", "BE"][i % 3];
    const city = ["Paris", "Berlin", "Brussels"][i % 3];
    const product = PRODUCTS[i % PRODUCTS.length];
    const base = {
      session_id: `s-${i}`,
      anonymous_id: id,
      user_email: email,
      user_id: `u-${i}`,
      utm_source: channel.source,
      utm_medium: channel.medium,
      utm_campaign: channel.campaign,
      device_type: device,
      browser,
      country,
      city,
      advertising_consent: "yes",
      analytics_storage: "Yes",
      brand: "atelier",
    };

    events.push({ event_name: "view_landing", timestamp: stamp, ...base });
    events.push({ event_name: "view_pdp", timestamp: stamp.replace("T10:", "T10:05:"), ...base });
    if (bucket === 4) {
      events.push({ event_name: "scroll_90", timestamp: stamp.replace("T10:", "T10:06:"), ...base });
    }
    if (bucket === 3) {
      events.push({ event_name: "ui_click_cta", timestamp: stamp.replace("T10:", "T10:07:"), ...base });
      events.push({ event_name: "remove_from_cart", timestamp: stamp.replace("T10:", "T10:08:"), ...base });
    }
    if (buyer) {
      events.push({ event_name: "ui_click_cta", timestamp: stamp.replace("T10:", "T10:07:"), ...base });
      events.push({ event_name: "view_checkout", timestamp: stamp.replace("T10:", "T10:08:"), ...base });
      orders.push({
        order_id: `o-${i}`,
        email,
        customer_id: `u-${i}`,
        created_at: `2026-03-${day}T11:00:00Z`,
        sku: product.sku,
        product_name: product.name,
        quantity: 2 + (i % 3),
        revenue: 40 + (i % 4) * 15,
        status: "paid",
        is_subscription_renewal: false,
        currency: "EUR",
      });
      if (bucket === 1) {
        const next = PRODUCTS[(i + 1) % PRODUCTS.length];
        orders.push({
          order_id: `o-${i}-2`,
          email,
          customer_id: `u-${i}`,
          created_at: `2026-04-${day}T11:00:00Z`,
          sku: next.sku,
          product_name: next.name,
          quantity: 1,
          revenue: 36,
          status: "paid",
          is_subscription_renewal: false,
          currency: "EUR",
        });
      }
      if (i % 20 === 1) {
        orders.push({
          order_id: `o-${i}-renew`,
          email,
          customer_id: `u-${i}`,
          created_at: "2026-08-01T11:00:00Z",
          sku: product.sku,
          product_name: product.name,
          quantity: 1,
          revenue: 28,
          status: "paid",
          is_subscription_renewal: true,
          currency: "EUR",
        });
      }
      events.push({ event_name: "email_sent", timestamp: "2026-08-10T09:00:00Z", ...base });
      if (i % 2 === 0) events.push({ event_name: "email_open", timestamp: "2026-08-10T12:00:00Z", ...base });
      if (i % 17 === 1) events.push({ event_name: "email_unsubscribe", timestamp: "2026-08-11T09:00:00Z", ...base });
      if (i % 11 === 0) events.push({ event_name: "sms_sent", timestamp: "2026-08-12T09:00:00Z", ...base });
      if (i % 13 === 0) events.push({ event_name: "push_sent", timestamp: "2026-08-12T10:00:00Z", ...base });
      if (i < 30) {
        nps.push({ email, score: i % 3 === 0 ? 9 : i % 3 === 1 ? 8 : 4, date: "2026-08-20", source: "email", requested: true });
      }
    }
    events.push({
      event_name: "experiment_exposure",
      timestamp: "2026-07-01T09:00:00Z",
      ...base,
      experiment_id: "hero-cta",
      variant: i % 2 === 0 ? "control" : "variant",
    });
  }

  orders.push({
    order_id: "o-orphan",
    email: "ghost@shop.test",
    customer_id: "u-ghost",
    created_at: "2026-04-02T11:00:00Z",
    sku: "serum",
    product_name: "Сыворотка",
    quantity: 1,
    revenue: 42,
    status: "paid",
    is_subscription_renewal: false,
    currency: "EUR",
  });

  return { events, orders, nps };
}

const PRODUCT_NAME: Record<string, string> = {
  serum: "Сыворотка",
  cream: "Крем",
  spf: "SPF",
  mask: "Маска",
};

export function fullDemoFollowUp(
  snapshot: SnapshotLine[],
  links: Array<{ order_id: string; entity_id: string | null }>,
): { events: RawEvent[]; orders: RawOrder[]; nps: RawNps[] } {
  const base = fullDemoDataset();
  const rawById = new Map(base.orders.map((order) => [order.order_id, order]));
  const whoByEntity = new Map<string, { email: string; customer_id?: string }>();
  for (const link of links) {
    if (!link.entity_id || whoByEntity.has(link.entity_id)) continue;
    const raw = rawById.get(link.order_id);
    if (!raw?.email) continue;
    whoByEntity.set(link.entity_id, { email: raw.email, customer_id: raw.customer_id });
  }
  const extra: RawOrder[] = [];
  snapshot.forEach((line, index) => {
    if (index % 2 !== 0) return;
    const who = whoByEntity.get(line.entity_id);
    if (!who) return;
    extra.push({
      order_id: `o-follow-${index}`,
      email: who.email,
      customer_id: who.customer_id,
      created_at: "2026-10-20T11:00:00Z",
      sku: line.sku,
      product_name: PRODUCT_NAME[line.sku] ?? line.sku,
      quantity: 1,
      revenue: 36,
      status: "paid",
      is_subscription_renewal: false,
      currency: "EUR",
    });
  });
  return { events: base.events, orders: [...base.orders, ...extra], nps: base.nps };
}
