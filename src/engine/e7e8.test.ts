import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { audienceForBrief, assertBrandKeyLink, briefAudience, collectBrandKeys } from "./brand-key";
import { powerBrief, nControlForEffect, minimumDetectableEffect } from "./experiments";
import { abandonedCartBaseline, featuresFor, featuresForNonBuyers } from "./features";
import { classifyHoldout, holdoutFromConfirmation, ittWithCompliance, liftParagraph, measureLift, parseReceivedColumn } from "./holdout";
import { confirmColumnText, klaviyoSteps, sendWindowText } from "./klaviyo";
import { LIA_NOTICE, privacyVerdict } from "./privacy";
import { buildWorkspace, observedCycle } from "./pipeline";
import { pilotChecklist } from "./pilot";
import { coViewPairs } from "./recs";
import { reasonCodes } from "./reasons";
import { assertGbmAllowed, assertModelShadowAllowed } from "./scoring-gate";
import { assignOnsite, onsiteArm, parseOnsiteOffer } from "./onsite";
import { problemCards } from "../app/cut-lede";
import { accumulateMove, benjaminiHochberg, empiricalBayesShrink, evidenceState, moveDecision, segmentReads, betaBetaGreater } from "./stats";
import { FULL_DEMO_CONFIG, fullDemoDataset } from "./full-demo";
import type { EntityRow, OrderRow, RawEvent, RunConfig, SnapshotLine } from "./types";
import { LUMIERE_CONFIG } from "./demo";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("send window uses hazard peak, not days after Placed Order", () => {
  const config: RunConfig = { ...LUMIERE_CONFIG, asOf: "2026-06-01", windowDays: 120, skuRoles: {} };
  const peak = observedCycle(
    [
      ...Array.from({ length: 40 }, (_, index) => buyer(`p${index}`, "2026-01-01T00:00:00Z", "2026-01-16T00:00:00Z", 200)),
      buyer("censor", "2026-01-01T00:00:00Z", null, 100),
    ],
    config,
  );
  assert.equal(peak.hazardPeak, 15);
  const text = sendWindowText(peak);
  assert.match(text, /день \d+–\d+ с момента покупки/);
  assert.match(text, /пик хазарда категории — день 15/);
  assert.doesNotMatch(text, /после Placed Order|дн\. после/);
  const steps = klaviyoSteps({
    pockets: [{ id: "risk", title: "", who: "", size: 40, revenue: 100, evidence: [] }],
    cycleDays: 60,
    letters: true,
    pair: null,
    cycle: peak,
  });
  assert.equal(steps[0]?.when, text);
  assert.match(steps[0]?.confirm ?? "", /received_email/);
  assert.match(confirmColumnText(), /не проверен/);
});

test("brand key lists use customer_id and never an hmac", () => {
  const data = fullDemoDataset();
  const workspace = buildWorkspace({ events: data.events, orders: data.orders, nps: data.nps, config: FULL_DEMO_CONFIG });
  assert.ok(workspace.brandKeys.length > 0);
  assert.ok(workspace.brandKeys.every((link) => link.keyKind === "customer_id"));
  assert.ok(workspace.brandKeys.every((link) => !/hmac|@/.test(link.brandKey)));
  const audience = audienceForBrief(workspace.brandKeys, null, "snap-demo");
  assert.equal(audience.covered, true);
  assert.ok(audience.treatment.length > 0 && audience.control.length > 0);
  const joined = [...audience.treatment, ...audience.control].join(" ");
  assert.doesNotMatch(joined, /hmac|@|user:/);
  const missing = briefAudience([], null);
  assert.equal(missing.covered, false);
  assert.match(missing.note, /Кому недоступно/);
  assert.throws(() => assertBrandKeyLink({ stableId: "customer_id", keyKind: "customer_id", brandKey: "u-1" }));
  assert.throws(() => assertBrandKeyLink({ stableId: "visit:hmac1:abc", keyKind: "customer_id", brandKey: "user:hmac1:abc" }));
  const onlyOrder = collectBrandKeys([{ entityId: "visit:1", orderId: "o-9", customerId: undefined }]);
  assert.equal(onlyOrder[0]?.keyKind, "order_id");
  assert.equal(onlyOrder[0]?.brandKey, "o-9");
});

test("holdout status, compliance and itt do not replace each other", () => {
  assert.equal(classifyHoldout({ sendsKnown: false, contamination: null, deviation: null }), "unchecked");
  assert.equal(classifyHoldout({ sendsKnown: true, contamination: 0.1, deviation: "random" }), "confirmed");
  assert.equal(classifyHoldout({ sendsKnown: true, contamination: 0.21, deviation: "random" }), "violated");
  assert.equal(classifyHoldout({ sendsKnown: true, contamination: 0.05, deviation: "selective" }), "violated");
  const parsed = parseReceivedColumn({
    rows: [
      { customer_id: "a", received_email: "1" },
      { customer_id: "b", received_email: "0" },
      { customer_id: "c", received_email: "1" },
      { customer_id: "d", received_email: "0" },
    ],
    arms: [
      { brandKey: "a", arm: "treatment" },
      { brandKey: "b", arm: "treatment" },
      { brandKey: "c", arm: "control" },
      { brandKey: "d", arm: "control" },
    ],
    deviation: "random",
  });
  assert.equal(parsed.compliance, 0.5);
  assert.equal(parsed.contamination, 0.5);
  assert.equal(parsed.status, "violated");
  const scaled = ittWithCompliance(0.04, 0.5);
  assert.equal(scaled.itt, 0.04);
  assert.equal(scaled.onReceived, 0.08);
  const record = holdoutFromConfirmation(0.04, { ...parsed, status: "confirmed", contamination: 0.1, compliance: 0.5 }, "random");
  assert.equal(record.onReceived, 0.08);
  assert.notEqual(record.onReceived, record.compliance);
});

test("the word effect appears only in holdout state 1", () => {
  const shared = { interim: false, diffText: "1 п.п.", onReceivedText: "2 п.п.", probText: "60%" };
  const confirmed = liftParagraph({ ...shared, status: "confirmed" });
  const unchecked = liftParagraph({ ...shared, status: "unchecked" });
  const violated = liftParagraph({ ...shared, status: "violated" });
  assert.match(`${confirmed.title} ${confirmed.body}`, /эффект/);
  assert.equal(confirmed.state, 1);
  assert.doesNotMatch(`${unchecked.title} ${unchecked.body}`, /эффект/);
  assert.equal(unchecked.state, 2);
  assert.match(unchecked.title, /Наблюдаемая разница между группами/);
  assert.doesNotMatch(`${violated.title} ${violated.body}`, /эффект/);
  assert.equal(violated.showNumbers, false);
  assert.match(violated.body, /новый снимок/i);
  const pockets = [
    { id: "drop", title: "", who: "", size: 80, revenue: 0, evidence: [], fromStage: "pdp", toStage: "cta" },
    { id: "risk", title: "", who: "", size: 40, revenue: 2500, evidence: [] },
  ];
  const cards = problemCards({ pockets, cycleDays: 31, letters: true, pair: null });
  for (const card of cards) assert.doesNotMatch(card.problem, /\d/);
  const reasons = reasonCodes([
    { feature: "visits", standardized: -1.2, coefficient: 0.4 },
    { feature: "recency", standardized: 1.4, coefficient: -0.2 },
    { feature: "revenue", standardized: 0.2, coefficient: 0.05 },
  ]);
  assert.ok(reasons.includes("мало визитов до покупки"));
  assert.ok(reasons.includes("давно не покупал"));
  for (const line of reasons) assert.doesNotMatch(line, /\d/);
});

test("power brief names n_control and refuses a decision when the bucket is small", () => {
  const need = nControlForEffect(0.2, 5);
  const mde = minimumDetectableEffect(0.2, { control: need, variant: need }, ["control", "variant"]);
  assert.ok(Math.abs(mde - 0.05) < 0.005);
  const small = powerBrief({ controlN: 10, repeatP: 0.2, effectPp: 5 });
  assert.match(small, /нужно \d+/);
  assert.match(small, /только накопление в байесовский приор, не решение/);
  assert.doesNotMatch(small, /predicted/);
});

test("empirical bayes shrinks a small segment and BH marks only corrected rows", () => {
  const shrunk = empiricalBayesShrink([
    { id: "a", successes: 80, n: 100 },
    { id: "b", successes: 8, n: 10 },
    { id: "c", successes: 1, n: 10 },
  ]);
  const small = shrunk.find((row) => row.id === "c");
  assert.ok(small);
  assert.ok(small.shrunk > small.raw);
  assert.ok(small.low <= small.shrunk && small.shrunk <= small.high);
  const flags = benjaminiHochberg([0.001, 0.02, 0.2, 0.9]);
  assert.deepEqual(flags, [true, true, false, false]);
  const reads = segmentReads([
    { id: "big", successes: 50, n: 100 },
    { id: "other", successes: 50, n: 100 },
  ]);
  assert.ok(reads.every((row) => row.differs === false));
  const text = reads.map((row) => (row.differs ? "отличается от среднего" : "как среднее")).join(" ");
  assert.doesNotMatch(text, /значим/);
});

test("move posterior carries across slices and the thresholds decide", () => {
  const first = accumulateMove(null, {
    brandId: "atelier",
    moveId: "risk",
    treatmentHits: 40,
    treatmentN: 50,
    controlHits: 10,
    controlN: 50,
  });
  const second = accumulateMove(first, {
    brandId: "atelier",
    moveId: "risk",
    treatmentHits: 30,
    treatmentN: 40,
    controlHits: 8,
    controlN: 40,
  });
  assert.ok(second.treatmentAlpha > first.treatmentAlpha);
  const prob = betaBetaGreater(second.treatmentAlpha, second.treatmentBeta, second.controlAlpha, second.controlBeta);
  assert.equal(moveDecision(prob), "scale");
  assert.equal(moveDecision(0.5), "continue");
  assert.equal(moveDecision(0.05), "stop");
  const other = accumulateMove(second, {
    brandId: "other",
    moveId: "risk",
    treatmentHits: 1,
    treatmentN: 2,
    controlHits: 1,
    controlN: 2,
  });
  assert.equal(other.treatmentAlpha, 2);
});

test("evidence state keeps each threshold and one wording", () => {
  assert.equal(evidenceState(0, "people").level, "enough");
  assert.equal(evidenceState(4, "people").level, "hidden");
  assert.equal(evidenceState(5, "people").level, "enough");
  assert.equal(evidenceState(12, "lookalike").level, "thin");
  assert.equal(evidenceState(30, "lookalike").level, "enough");
  assert.equal(evidenceState(40, "experiment").level, "thin");
  assert.equal(evidenceState(1, "support").level, "hidden");
  assert.equal(evidenceState(4, "cycle").level, "thin");
  assert.match(evidenceState(4, "cycle").reason, /усадка/);
});

test("epv 100 blocks shadow and does not change the gbm gate", () => {
  assert.throws(() => assertModelShadowAllowed(99));
  assert.doesNotThrow(() => assertModelShadowAllowed(100));
  assert.throws(() => assertGbmAllowed(100));
  assert.doesNotThrow(() => assertGbmAllowed(500));
});

test("onsite contract assigns an arm only with consent", () => {
  const event = {
    event_name: "view_pdp" as const,
    timestamp: "2026-01-01T00:00:00Z",
    session_id: "s",
    anonymous_id: "anon-1",
    consent: true,
    product_id: "sku",
  };
  const shown = assignOnsite(event, "snap");
  assert.equal(shown.storedAnonymousId, "anon-1");
  assert.equal(shown.arm, onsiteArm("anon-1", "snap"));
  const hidden = assignOnsite({ ...event, consent: false }, "snap");
  assert.equal(hidden.storedAnonymousId, null);
  assert.equal(hidden.showOffer, false);
  const offer = parseOnsiteOffer({ offer_id: "o", variant_id: "v", product_id: "p", title: "Сыворотка" });
  assert.equal(offer.title, "Сыворотка");
  assert.match(LIA_NOTICE, /Таблица соответствия/);
  assert.equal(privacyVerdict({ origin: "operator", advertisingConsent: false, customerNotice: false }).decisions.find((row) => row.id === "export")?.allowed, false);
});

test("pilot checklist is honest about a file that is too small", () => {
  const data = fullDemoDataset();
  const pilot = pilotChecklist({ events: data.events, orders: data.orders });
  assert.ok(pilot.buyers > 0 && pilot.buyers < 300);
  assert.equal(pilot.items.find((item) => item.id === "buyers")?.met, false);
  assert.match(pilot.items.find((item) => item.id === "buyers")?.detail ?? "", new RegExp(String(pilot.buyers)));
  assert.equal(pilot.items.find((item) => item.id === "customer-id")?.met, false);
  assert.match(pilot.items.find((item) => item.id === "customer-id")?.detail ?? "", /Klaviyo/);
  assert.ok(pilot.nonBuyerEmailEvents > 0);
});

test("extra t1 features ignore events after the purchase", () => {
  const config: RunConfig = { ...LUMIERE_CONFIG, asOf: "2026-09-01", skuRoles: { serum: "serum" } };
  const events: RawEvent[] = [
    { event_name: "view_pdp", timestamp: "2026-01-01T00:00:00Z", session_id: "s1", anonymous_id: "c", user_email: "a@test" },
    { event_name: "remove_from_cart", timestamp: "2026-01-01T00:10:00Z", session_id: "s1", anonymous_id: "c", user_email: "a@test" },
    { event_name: "view_pdp", timestamp: "2026-02-01T00:00:00Z", session_id: "s2", anonymous_id: "c", user_email: "a@test" },
  ];
  const orders = [
    {
      order_id: "1",
      email: "a@test",
      created_at: "2026-01-02T00:00:00Z",
      sku: "serum",
      product_name: "serum",
      quantity: 2,
      revenue: 40,
      status: "paid" as const,
      is_subscription_renewal: false,
    },
  ];
  const workspace = buildWorkspace({ events, orders, config });
  const row = workspace.features[0];
  assert.equal(row.pdp_depth, 1);
  assert.equal(row.cart_returns, 1);
  assert.equal(row.first_basket_lines, 2);
  assert.equal(row.weekday, new Date("2026-01-02T00:00:00Z").getUTCDay());
  assert.equal(row.as_of, row.t1);
  const baseInput = {
    entities: workspace.entities,
    ordersByEntity: new Map([[row.entity_id, [line("2026-01-02T00:00:00Z")]]]),
    eventsByEntity: new Map([[row.entity_id, events]]),
    nps: [],
    skuRoles: { serum: "serum" },
    replenishmentLow: config.replenishmentLow,
    replenishmentHigh: config.replenishmentHigh,
  };
  const clean = featuresFor(baseInput);
  const leaked = featuresFor({
    ...baseInput,
    entities: workspace.entities.map((entity) =>
      entity.entity_id === row.entity_id ? { ...entity, second_purchase_at: "2026-08-01T00:00:00Z" } : entity,
    ),
    ordersByEntity: new Map([
      [
        row.entity_id,
        [line("2026-01-02T00:00:00Z"), { ...line("2026-08-01T00:00:00Z"), sku: "spf" }],
      ],
    ]),
  });
  assert.equal(leaked[0].pdp_depth, clean[0].pdp_depth);
  assert.equal(leaked[0].cart_returns, clean[0].cart_returns);
  assert.equal(leaked[0].first_basket_lines, clean[0].first_basket_lines);
  assert.equal(leaked[0].days_versus_cycle, clean[0].days_versus_cycle);
  const sampled = featuresFor({
    entities: workspace.entities,
    ordersByEntity: new Map([[row.entity_id, [line("2026-01-02T00:00:00Z")]]]),
    eventsByEntity: new Map([[row.entity_id, events]]),
    nps: [],
    skuRoles: {},
    sampleEvery: 180,
  });
  assert.equal(sampled[0].visits_before_t1, null);
  assert.equal(sampled[0].pdp_depth, null);
  assert.equal(sampled[0].cart_returns, null);
  assert.equal(sampled[0].first_basket_lines, 2);
});

test("non-buyer features censor short follow-up and ignore later events", () => {
  const entity = visitor("v1");
  const early: RawEvent[] = [
    { event_name: "view_pdp", timestamp: "2026-08-01T00:00:00Z", session_id: "s", anonymous_id: "v1" },
    { event_name: "add_to_cart", timestamp: "2026-08-01T00:05:00Z", session_id: "s", anonymous_id: "v1" },
  ];
  const later: RawEvent[] = [...early, { event_name: "view_pdp", timestamp: "2026-08-20T00:00:00Z", session_id: "s2", anonymous_id: "v1" }];
  const asOf = "2026-08-10T00:00:00Z";
  const row = featuresForNonBuyers({
    entities: [entity],
    eventsByEntity: new Map([["v1", early]]),
    ordersByEntity: new Map(),
    asOf,
  })[0];
  assert.equal(row.censored, true);
  assert.equal(row.label, null);
  assert.equal(row.cart_without_checkout, true);
  const leaked = featuresForNonBuyers({
    entities: [entity],
    eventsByEntity: new Map([["v1", later]]),
    ordersByEntity: new Map(),
    asOf,
  })[0];
  assert.equal(leaked.pdp_depth, row.pdp_depth);
  assert.equal(leaked.as_of, row.as_of);
  assert.equal(abandonedCartBaseline(early, "2026-08-01T00:05:00Z"), 1);
  assert.equal(abandonedCartBaseline([{ ...early[0], event_name: "view_checkout" }, early[1]], "2026-08-01T00:05:00Z"), 0);
});

test("co-view lift on rees46 is recorded from the file", () => {
  const path = join(root, "data/rees46-cosmetics/events.json");
  assert.equal(existsSync(path), true);
  const events = JSON.parse(readFileSync(path, "utf8")) as Array<{
    event_name: string;
    product_id?: string;
    user_id?: string;
    session_id?: string;
    user_session?: string;
  }>;
  assert.equal(events.length, 86519);
  const report = coViewPairs(events, 5);
  assert.equal(report.views, 51080);
  assert.equal(report.signal, true);
  assert.ok(report.pairs.length > 0);
  assert.ok(report.pairs.every((pair) => pair.n >= 2 && pair.liftLow > 1));
  assert.equal(report.qualified, 38);
  assert.equal(report.pairs[0]?.n, 7);
  assert.ok(Math.abs(report.maxLift - 2.09589761645176) < 1e-9);
});

test("measureLift stays on assignment when compliance is known", () => {
  const lines: SnapshotLine[] = ["a", "b", "c", "d"].map((id, index) => ({
    entity_id: id,
    sku: "serum",
    rank: index,
    model_version: "1.0",
    as_of: "2026-01-01",
    role: "serum",
    score: 0,
    bucket: "middle",
    arm: index < 2 ? "treatment" : "control",
    methodology_version: "1.0",
    config_hash: "",
  }));
  const orders: OrderRow[] = lines
    .filter((line) => line.arm === "treatment")
    .map((line) => ({
      order_id: line.entity_id,
      entity_id: line.entity_id,
      purchased_at: "2026-02-01T00:00:00Z",
      sku: "serum",
      product_name: "serum",
      revenue: 10,
      status: "paid",
      is_subscription_renewal: false,
      orphan: false,
      countsAsOrder: true,
    }));
  const lift = measureLift({ snapshot: lines, orders, windowDays: 60, asOf: "2026-03-15" });
  assert.ok(lift && lift.diff !== 0);
  const scaled = ittWithCompliance(lift.diff, 0.5);
  assert.equal(scaled.itt, lift.diff);
  assert.ok(scaled.onReceived !== null && scaled.onReceived !== lift.diff);
});

function buyer(id: string, first: string, second: string | null, age: number): EntityRow {
  return {
    entity_id: id,
    first_seen_at: first,
    last_seen_at: second ?? first,
    first_touch_channel: "direct",
    device: "desktop",
    user_type: "buyer",
    converted: true,
    first_purchase_at: first,
    second_purchase_at: second,
    last_purchase_at: second ?? first,
    ltv: 40,
    n_orders: second ? 2 : 1,
    first_sku: "serum",
    saw_pdp: true,
    scrolled: false,
    clicked_cta: true,
    checkout: true,
    purchased: true,
    attribution_after_purchase: false,
    funnel_depth: 5,
    age_days: age,
  };
}

function visitor(id: string): EntityRow {
  return {
    entity_id: id,
    first_seen_at: "2026-08-01T00:00:00Z",
    last_seen_at: "2026-08-01T00:05:00Z",
    first_touch_channel: "direct",
    device: "desktop",
    user_type: "visitor",
    converted: false,
    first_purchase_at: null,
    second_purchase_at: null,
    last_purchase_at: null,
    ltv: 0,
    n_orders: 0,
    first_sku: null,
    saw_pdp: true,
    scrolled: false,
    clicked_cta: true,
    checkout: false,
    purchased: false,
    attribution_after_purchase: false,
    funnel_depth: 3,
    age_days: null,
  };
}

function line(at: string): OrderRow {
  return {
    order_id: at,
    entity_id: "x",
    purchased_at: at,
    sku: "serum",
    product_name: "serum",
    revenue: 40,
    status: "paid",
    is_subscription_renewal: false,
    orphan: false,
    countsAsOrder: true,
    quantity: 2,
  };
}
