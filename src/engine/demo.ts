import type { PriorStore, RawEvent, RawNps, RawOrder, RunConfig } from "./types";

export const LUMIERE_CONFIG: RunConfig = {
  asOf: "2026-09-01",
  windowDays: 120,
  brandId: "lumiere-skin",
  tenantId: "lumiere",
  stableIdColumn: "anonymous_id",
  category: "skincare",
  replenishmentLow: 85,
  replenishmentHigh: 110,
  currency: "€",
  dataOrigin: "operator",
  advertisingConsent: false,
  customerNotice: false,
  skuRoles: {
    cleanser: "cleanser",
    serum: "serum",
    spf: "spf",
    cream: "cream",
  },
};

export function lumiereDataset(): { events: RawEvent[]; orders: RawOrder[]; nps: RawNps[] } {
  const events: RawEvent[] = [];
  const orders: RawOrder[] = [];
  const nps: RawNps[] = [];
  const rand = mulberry(42);

  for (let i = 0; i < 160; i += 1) {
    const cookie = `cookie-${i}`;
    const buyer = i < 70;
    const email = buyer ? `buyer${i}@lumiere.test` : undefined;
    const day = 10 + (i % 20);
    const month = buyer ? "03" : "08";
    const stamp = `2026-${month}-${String(day).padStart(2, "0")}T10:00:00Z`;
    const source = i % 3 === 0 ? "google" : i % 3 === 1 ? "facebook" : "";
    const medium = i % 3 === 2 ? "" : "cpc";
    events.push({
      event_name: "view_landing",
      timestamp: stamp,
      session_id: `s-${i}`,
      anonymous_id: cookie,
      user_email: email,
      utm_source: source,
      utm_medium: medium,
      device_type: i % 4 === 0 ? "mobile" : "desktop",
    });
    if (i % 5 !== 0) {
      events.push({
        event_name: "view_pdp",
        timestamp: stamp.replace("10:", "10:05:"),
        session_id: `s-${i}`,
        anonymous_id: cookie,
        user_email: email,
        device_type: i % 4 === 0 ? "mobile" : "desktop",
      });
    }
    if (i % 5 === 4) {
      events.push({
        event_name: "scroll_50",
        timestamp: stamp.replace("10:", "10:06:"),
        session_id: `s-${i}`,
        anonymous_id: cookie,
        user_email: email,
      });
    }
    if (buyer) {
      events.push({
        event_name: "ui_click_cta",
        timestamp: stamp.replace("10:", "10:07:"),
        session_id: `s-${i}`,
        anonymous_id: cookie,
        user_email: email,
      });
      events.push({
        event_name: "view_checkout",
        timestamp: stamp.replace("10:", "10:08:"),
        session_id: `s-${i}`,
        anonymous_id: cookie,
        user_email: email,
      });
      const sku = ["cleanser", "serum", "spf", "cream"][i % 4];
      orders.push({
        order_id: `o-${i}`,
        customer_id: `c-${i}`,
        email,
        created_at: `2026-03-${String(day).padStart(2, "0")}T11:00:00Z`,
        sku,
        product_name: sku,
        quantity: 1,
        revenue: 48,
        status: "paid",
        is_subscription_renewal: false,
      });
      if (i % 2 === 0) {
        const nextSku = ["serum", "spf", "cream", "cleanser"][i % 4];
        orders.push({
          order_id: `o-${i}-b`,
          email,
          created_at: `2026-05-${String((day % 27) + 1).padStart(2, "0")}T11:00:00Z`,
          sku: nextSku,
          product_name: nextSku,
          quantity: 1,
          revenue: 52,
          status: "paid",
          is_subscription_renewal: false,
        });
      }
      if (i % 11 === 0) {
        orders.push({
          order_id: `o-${i}-renew`,
          email,
          created_at: `2026-07-15T11:00:00Z`,
          sku,
          product_name: sku,
          quantity: 1,
          revenue: 40,
          status: "paid",
          is_subscription_renewal: true,
        });
      }
      if (i < 20) {
        nps.push({
          email,
          score: i % 3 === 0 ? 9 : i % 3 === 1 ? 8 : 4,
          date: "2026-08-20",
          source: "email",
          requested: true,
        });
      }
    }
    const variant = i % 2 === 0 ? "control" : "variant";
    events.push({
      event_name: "experiment_exposure",
      timestamp: `2026-07-01T09:00:00Z`,
      session_id: `s-${i}`,
      anonymous_id: cookie,
      experiment_id: "hero-cta",
      variant,
      device_type: i % 4 === 0 ? "mobile" : "desktop",
      utm_source: source,
      utm_medium: medium,
      user_type: buyer ? "buyer" : "new",
      in_holdout: false,
    });
  }

  for (let i = 0; i < 170; i += 1) {
    events.push({
      event_name: "experiment_exposure",
      timestamp: "2026-08-20T09:00:00Z",
      session_id: `bad-${i}`,
      anonymous_id: `cookie-${i % 160}`,
      experiment_id: "broken-srm",
      variant: i < 150 ? "control" : "variant",
      device_type: "desktop",
      user_type: "new",
      in_holdout: false,
    });
  }

  orders.push({
    order_id: "orphan-1",
    email: "ghost@lumiere.test",
    created_at: "2026-07-02T11:00:00Z",
    sku: "serum",
    product_name: "serum",
    quantity: 1,
    revenue: 90,
    status: "paid",
    is_subscription_renewal: false,
  });
  void rand;
  return { events, orders, nps };
}

export function lumierePrior(): PriorStore {
  return {
    brands: {
      "other-brand": { pairs: { "cleanser|serum": 40, "serum|spf": 12 } },
    },
  };
}

function mulberry(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
