import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertStableIdColumn, channelGroup } from "./channel";
import { piiHmac } from "./hash";
import { privacyOf, privacyVerdict } from "./privacy";
import { martCatalog } from "./catalog";
import { lumiereDataset, LUMIERE_CONFIG } from "./demo";
import { assertRolloutAllowed, experimentReadiness, queryExperimentSlices } from "./experiments";
import { compiledLiveSql } from "./load-metrics";
import { promoteMetric, proposeMetric, resetLiveNames, type MetricDef } from "./metrics";
import { buildWorkspace, letterSegment, metricValue, observedCycle, playgroundRecommend, queryDiagnostic, weekWindow, writeReportSnapshot, type Workspace } from "./pipeline";
import { FULL_DEMO_CONFIG, fullDemoDataset, fullDemoFollowUp } from "./full-demo";
import { channelCuts, deliveryChannels, firstProductLines, letterRates } from "./insights";
import { audienceGapNotice, clientActions, formatBand, formatCount, formatMoney, formatPct, formatPp, weekVerdict } from "./client-copy";
import { klaviyoSteps, mondayStep, moveBans, sendWindowText } from "./klaviyo";
import { rankMoves } from "./move-rank";
import { rfmGrid, rfmPoints, voiceGrid } from "./diagnostic";
import { unitEconomics } from "./unit-econ";
import { diagnosticFor, playground, resetStore, startRun } from "./store";
import { recognizeRaw } from "./recognize";
import { emptyPrior, fallbackRate, recommendFor, rolePairCounts, trainRecs } from "./recs";
import { problemCards } from "../app/cut-lede";
import type { EntityRow, RawEvent, RawOrder, SnapshotLine } from "./types";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const baseConfig = {
  ...LUMIERE_CONFIG,
  asOf: "2026-09-01",
  windowDays: 120,
  skuRoles: { cleanser: "cleanser", serum: "serum", spf: "spf" },
};

test("stable_id rejects email and customer_id", () => {
  assert.throws(() => assertStableIdColumn("email"));
  assert.throws(() => assertStableIdColumn("customer_id"));
  assert.throws(() => assertStableIdColumn("phone"));
  assert.throws(() => assertStableIdColumn("full_name"));
  assert.doesNotThrow(() => assertStableIdColumn("anonymous_id"));
});

test("eu privacy law blocks a mailing without a recorded basis", () => {
  const research = privacyVerdict(
    privacyOf({ ...baseConfig, brandId: "rees46-cosmetics", dataOrigin: undefined, advertisingConsent: true }),
  );
  assert.equal(research.letters, false);
  assert.match(research.lawLabel, /GDPR/);
  assert.equal(research.decisions.some((item) => item.id === "local"), false);
  const operator = privacyVerdict({ origin: "operator", advertisingConsent: false, customerNotice: false });
  assert.equal(operator.letters, false);
  const notice = privacyVerdict({ origin: "operator", advertisingConsent: false, customerNotice: true });
  assert.equal(notice.letters, true);
  const consent = privacyVerdict({ origin: "operator", advertisingConsent: true, customerNotice: false });
  assert.equal(consent.letters, true);
  assert.equal(privacyVerdict(privacyOf(LUMIERE_CONFIG)).letters, false);
  assert.equal(operator.decisions.some((item) => item.id === "export" && item.allowed === false), true);
});

test("identity coverage and orphan revenue", () => {
  const events: RawEvent[] = [
    {
      event_name: "view_landing",
      timestamp: "2026-01-01T00:00:00Z",
      session_id: "s1",
      anonymous_id: "cookie-a",
      user_email: "a@test",
    },
  ];
  const orders: RawOrder[] = [
    order("1", "a@test", "2026-01-02T00:00:00Z", "serum", 80, false),
    order("2", "missing@test", "2026-01-03T00:00:00Z", "spf", 20, false),
  ];
  const workspace = buildWorkspace({ events, orders, config: baseConfig });
  assert.equal(metricValue(workspace, "identity_coverage"), 0.8);
  assert.equal(metricValue(workspace, "orphan_revenue"), 20);
});

test("funnel is monotonic at person level", () => {
  const events: RawEvent[] = [
    visit("a", "view_landing"),
    visit("b", "view_landing"),
    visit("b", "view_pdp"),
    visit("c", "view_landing"),
    visit("c", "view_pdp"),
    visit("c", "ui_click_cta"),
    visit("c", "view_checkout"),
  ];
  const orders = [order("1", "c@test", "2026-01-02T00:00:00Z", "serum", 40, false)];
  events.push({ ...visit("c", "view_landing"), user_email: "c@test" });
  const workspace = buildWorkspace({ events, orders, config: baseConfig });
  const funnel = workspace.metrics.find((table) => table.name === "site_funnel")!;
  const purchase = funnel.rows.find((row) => row.stage === "purchase")!;
  const visitRow = funnel.rows.find((row) => row.stage === "visit")!;
  assert.equal(visitRow.lifetime, 3);
  assert.equal(purchase.lifetime, 1);
  const counts = funnel.rows.map((row) => Number(row.lifetime));
  for (let i = 1; i < counts.length; i += 1) assert.ok(counts[i] <= counts[i - 1]);
});

test("repeat counts only mature buyers inside the window", () => {
  const events = [withEmail("cookie-old", "old@test"), withEmail("cookie-new", "new@test"), withEmail("cookie-renew", "renew@test")];
  const orders = [
    order("a1", "old@test", "2026-01-01T00:00:00Z", "serum", 40, false),
    order("a2", "old@test", "2026-03-01T00:00:00Z", "spf", 40, false),
    order("b1", "new@test", "2026-08-01T00:00:00Z", "serum", 40, false),
    order("b2", "new@test", "2026-08-20T00:00:00Z", "spf", 40, false),
    order("c1", "renew@test", "2026-01-01T00:00:00Z", "cleanser", 40, false),
    order("c2", "renew@test", "2026-02-01T00:00:00Z", "cleanser", 40, true),
  ];
  const workspace = buildWorkspace({ events, orders, config: baseConfig });
  const row = workspace.metrics.find((table) => table.name === "repeat_rate")!.rows[0];
  assert.equal(row.mature, 2);
  assert.equal(row.repeated, 1);
  assert.equal(row.value, 0.5);
});

test("broken SRM blocks rollout and post-exposure slice errors", () => {
  const exposures = [
    ...Array.from({ length: 150 }, (_, i) => exposure("broken", "control", `e${i}`)),
    ...Array.from({ length: 20 }, (_, i) => exposure("broken", "variant", `v${i}`)),
  ];
  const [readiness] = experimentReadiness(exposures, "2026-09-01");
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.some((item) => item.includes("SRM")));
  assert.throws(() => assertRolloutAllowed(readiness));
  assert.throws(() => queryExperimentSlices(exposures, "broken", "reached_checkout"));
});

test("cold entity uses fallback and renewal is absent from pairs", () => {
  const orders: RawOrder[] = [
    order("1", "a@test", "2026-01-01T00:00:00Z", "cleanser", 10, false),
    order("2", "a@test", "2026-01-02T00:00:00Z", "serum", 10, false),
    order("3", "b@test", "2026-01-01T00:00:00Z", "cleanser", 10, false),
    order("4", "b@test", "2026-01-02T00:00:00Z", "serum", 10, false),
    order("5", "c@test", "2026-01-03T00:00:00Z", "spf", 10, true),
    order("6", "c@test", "2026-01-04T00:00:00Z", "cream", 10, true),
  ];
  const events = [withEmail("ca", "a@test"), withEmail("cb", "b@test"), withEmail("cc", "c@test"), withEmail("cd", "d@test")];
  events[3] = { ...events[3], user_email: "d@test" };
  orders.push(order("7", "d@test", "2026-01-05T00:00:00Z", "rare", 10, false));
  const workspace = buildWorkspace({
    events,
    orders,
    config: { ...baseConfig, skuRoles: { cleanser: "cleanser", serum: "serum", spf: "spf", cream: "cream", rare: "serum" } },
  });
  const cold = recommendFor(workspace.model, "cold", ["rare"], emptyPrior());
  assert.equal(cold.fallback_used, true);
  const pairs = rolePairCounts(workspace.orders, baseConfig.asOf, workspace.model.skuRole);
  assert.equal(pairs["cream|spf"], undefined);
  assert.ok((pairs["cleanser|serum"] ?? 0) >= 1);
  const lines = [cold];
  assert.equal(fallbackRate(lines), 1);
});

test("second run fills hit rate against popularity", () => {
  const roles = { serum: "serum", spf: "spf", cleanser: "cleanser" };
  const earlyOrders = [
    order("1", "a@test", "2026-01-01T00:00:00Z", "cleanser", 10, false),
    order("2", "a@test", "2026-01-10T00:00:00Z", "serum", 10, false),
  ];
  const earlyEvents = [withEmail("ca", "a@test")];
  const first = buildWorkspace({
    events: earlyEvents,
    orders: earlyOrders,
    config: { ...baseConfig, asOf: "2026-02-01" },
  });
  assert.equal(first.hitRate, null);
  const prior = emptyPrior();
  const written = writeReportSnapshot({
    workspace: first,
    config: { ...baseConfig, asOf: "2026-02-01" },
    pockets: queryDiagnostic(first, { ...baseConfig, asOf: "2026-02-01" }),
    prior,
  });
  assert.equal(written.snapshot.length > 0, true);
  const laterOrders = [
    ...earlyOrders,
    order("3", "a@test", "2026-03-01T00:00:00Z", written.snapshot[0].sku, 10, false),
  ];
  const snapshot: SnapshotLine[] = written.snapshot;
  const second = buildWorkspace({
    events: earlyEvents,
    orders: laterOrders,
    config: { ...baseConfig, asOf: "2026-07-01" },
    previousSnapshot: snapshot,
  });
  assert.equal(typeof second.hitRate, "number");
  assert.equal(typeof second.hitRatePopular, "number");
  assert.ok((second.hitRate ?? 0) >= 0);
});

test("author cannot sign the golden number or overwrite a live name", () => {
  resetLiveNames();
  const draft: MetricDef = {
    name: "draft_ratio",
    description: "draft",
    owner: "layer-agent",
    domain: "loyalty",
    status: "draft",
    grain: "entity",
    measure: { op: "count" },
    dimensions: [],
    filters: [],
    window: null,
  };
  const proposed = proposeMetric(draft, []);
  assert.throws(() => promoteMetric(proposed, 1, "layer-agent", 1));
  const live = promoteMetric(proposed, 1, "reviewer", 1);
  assert.equal(live.status, "live");
  assert.throws(() => proposeMetric({ ...draft, status: "draft" }, [live]));
});

test("catalog holds seventy marts and live yaml compiles to sql", () => {
  assert.equal(martCatalog().length, 70);
  const sql = compiledLiveSql(join(root, "methodology/metrics"));
  assert.match(sql.identity_coverage, /SELECT/);
  assert.match(sql.repeat_rate, /dim_entity/);
});

test("site drop comes first and the two letters do not overlap", () => {
  const asOf = "2026-06-01";
  const entities: EntityRow[] = [];
  for (let i = 0; i < 25; i += 1) {
    entities.push(buyer(`lost-${i}`, "2026-03-01T00:00:00Z", "2026-03-31T00:00:00Z", "2026-03-31T00:00:00Z", 2));
  }
  for (let i = 0; i < 10; i += 1) {
    entities.push(buyer(`once-${i}`, "2026-04-01T00:00:00Z", null, "2026-04-01T00:00:00Z", 1));
  }
  const workspace = {
    entities,
    metrics: [
      {
        name: "site_funnel",
        columns: ["stage", "lifetime"],
        rows: [
          { stage: "visit", lifetime: 40 },
          { stage: "pdp", lifetime: 40 },
          { stage: "cta", lifetime: 12 },
          { stage: "checkout", lifetime: 8 },
          { stage: "purchase", lifetime: 8 },
        ],
      },
    ],
  } as unknown as Workspace;
  const config = { ...baseConfig, asOf };
  const pockets = queryDiagnostic(workspace, config);
  assert.equal(pockets[0]?.id, "drop");
  assert.equal(pockets[0]?.fromStage, "pdp");
  assert.equal(pockets[0]?.size, 28);
  assert.equal(pockets.find((pocket) => pocket.id === "risk")?.size, 10);
  assert.equal(pockets.find((pocket) => pocket.id === "lost")?.size, 25);
  const cycle = observedCycle(entities, config);
  assert.equal(cycle.fromData, true);
  assert.equal(cycle.high, 49);
});

test("few second purchases keep the configured cycle", () => {
  const cycle = observedCycle(
    [buyer("a", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z", "2026-02-01T00:00:00Z", 2)],
    baseConfig,
  );
  assert.equal(cycle.fromData, false);
  assert.equal(cycle.high, 101);
});

test("lumiere demo has one ready test and one broken SRM", () => {
  const data = lumiereDataset();
  const workspace = buildWorkspace({ events: data.events, orders: data.orders, nps: data.nps, config: LUMIERE_CONFIG });
  const readiness = experimentReadiness(workspace.exposures, LUMIERE_CONFIG.asOf);
  const ready = readiness.filter((item) => item.ready);
  const broken = readiness.find((item) => item.experiment_id === "broken-srm");
  assert.equal(ready.length, 1);
  assert.equal(broken?.ready, false);
  const entity = workspace.entities.find((row) => row.n_orders === 1);
  assert.ok(entity);
  const rec = playgroundRecommend(workspace, entity!.entity_id, emptyPrior());
  assert.equal(typeof rec.fallback_used, "boolean");
  void trainRecs;
});

test("raw recognition names what the file contains and the cart gap by brand", () => {
  const data = lumiereDataset();
  const lumiere = recognizeRaw({
    events: data.events,
    orders: data.orders,
    nps: data.nps,
    stableIdColumn: "anonymous_id",
    declaredCurrency: "€",
  });
  const byId = Object.fromEntries(lumiere.items.map((item) => [item.id, item]));
  assert.equal(byId.email.found, true);
  assert.equal(byId.channel.found, true);
  assert.equal(byId.experiment.found, true);
  assert.equal(byId.scroll.found, true);
  assert.equal(byId.nps.found, true);
  assert.equal(byId.remove.found, false);
  assert.equal(byId.consent.found, false);
  assert.equal(byId.currency.found, false);
  assert.match(byId.currency.detail, /€/);
  assert.equal(lumiere.brandSteps.length, 0);
  const lumiereSlot = (id: string) => lumiere.groups.flatMap((group) => group.slots).find((slot) => slot.id === id);
  assert.equal(lumiereSlot("source")?.found, true);
  assert.equal(lumiereSlot("scroll")?.found, true);
  assert.equal(lumiereSlot("review")?.found, true);
  assert.equal(lumiereSlot("campaign")?.found, false);
  assert.equal(lumiereSlot("sent")?.value, "Нет в файле");
  assert.equal(lumiereSlot("country")?.found, false);

  const events: RawEvent[] = [];
  const addBrand = (brand: string, viewers: number, carts: number) => {
    for (let index = 0; index < viewers; index += 1) {
      const user = `${brand}-${index}`;
      events.push({
        event_name: "view_pdp",
        timestamp: "2020-01-01T00:00:00Z",
        session_id: user,
        user_id: user,
        brand,
      });
      if (index < carts) {
        events.push({
          event_name: "ui_click_cta",
          timestamp: "2020-01-01T00:01:00Z",
          session_id: user,
          user_id: user,
          brand,
        });
      }
    }
  };
  addBrand("kapous", 200, 40);
  addBrand("irisk", 200, 120);
  const shop = recognizeRaw({
    events,
    orders: [
      order("1", "", "2020-01-02T00:00:00Z", "999", 40, false),
      {
        ...order("2", "", "2020-01-02T00:00:00Z", "kapous", 60, false),
        product_name: "kapous",
        quantity: 8,
      },
    ],
    stableIdColumn: "user_session",
  });
  const brand = shop.items.find((item) => item.id === "brand");
  assert.equal(brand?.found, true);
  assert.match(brand?.detail ?? "", /номер/);
  assert.equal(shop.brandSteps[0]?.brand, "kapous");
  assert.equal(shop.brandSteps[0]?.cartRate, 0.2);
  assert.equal(shop.brandSteps[1]?.brand, "irisk");
  assert.equal(shop.brandSteps[1]?.cartRate, 0.6);
  assert.equal(shop.items.find((item) => item.id === "channel")?.found, false);
  assert.equal(shop.items.find((item) => item.id === "remove")?.found, false);
  const shopSlot = (id: string) => shop.groups.flatMap((group) => group.slots).find((slot) => slot.id === id);
  assert.equal(shopSlot("view")?.found, true);
  assert.equal(shopSlot("sent")?.value, "Нет в файле");
  assert.equal(shopSlot("campaign")?.found, false);
});

test("full demo fills every field the platform is waiting for", () => {
  const data = fullDemoDataset();
  const recognition = recognizeRaw({
    events: data.events,
    orders: data.orders,
    nps: data.nps,
    stableIdColumn: "anonymous_id",
    declaredCurrency: "€",
  });
  const missing = recognition.groups.flatMap((group) => group.slots).filter((slot) => !slot.found);
  assert.deepEqual(
    missing.map((slot) => slot.id),
    [],
  );
});

test("first product line and channel cut stay with the buyers in the file", () => {
  const mature = { ...buyer("a", "2026-03-01", "2026-04-01", "2026-04-01", 2), first_sku: "serum", age_days: 180, first_touch_channel: "paid_search" };
  const once = { ...buyer("b", "2026-03-02", null, "2026-03-02", 1), first_sku: "serum", age_days: 170, first_touch_channel: "paid_search" };
  const early = { ...buyer("c", "2026-08-01", null, "2026-08-01", 1), first_sku: "cream", age_days: 10, first_touch_channel: "email" };
  const orders = [lineOrder("serum", "Сыворотка", "2026-03-01"), lineOrder("cream", "Крем", "2026-08-01")];
  const lines = firstProductLines([mature, once, early], orders, 120);
  assert.deepEqual(lines, [{ name: "Сыворотка", mature: 2, repeated: 1 }]);
  const cuts = channelCuts([mature, once, early]);
  assert.equal(cuts.find((cut) => cut.channel === "paid_search")?.again, 1);
  assert.equal(cuts.find((cut) => cut.channel === "paid_search")?.once, 1);
  assert.equal(cuts.find((cut) => cut.channel === "email")?.once, 1);
});

test("second cut of the same brand scores the previous list", () => {
  resetStore();
  const data = fullDemoDataset();
  const first = startRun({ events: data.events, orders: data.orders, nps: data.nps, config: { ...FULL_DEMO_CONFIG } });
  assert.equal(first.workspace.hitRate, null);
  const written = diagnosticFor(first.id);
  const follow = fullDemoFollowUp(
    written.snapshot ?? [],
    written.workspace.orders.map((row) => ({ order_id: row.order_id, entity_id: row.entity_id })),
  );
  const second = startRun({
    events: follow.events,
    orders: follow.orders,
    nps: follow.nps,
    config: { ...FULL_DEMO_CONFIG, asOf: "2027-01-15" },
  });
  assert.equal(typeof second.workspace.hitRate, "number");
  assert.ok((second.workspace.hitRate ?? 0) > 0);
  const snapshot = second.snapshot;
  const entity = second.workspace.entities.find((row) => row.converted);
  assert.ok(entity);
  playground(second.id, entity.entity_id);
  assert.equal(second.snapshot, snapshot);
  const letters = letterRates(written.recognition!);
  assert.ok(letters && letters.sent > 0 && letters.opened > 0);
});

test("klaviyo advice is two separate flows after the card, and mail stays off without consent", () => {
  const pockets = [
    { id: "drop", title: "", who: "", size: 80, revenue: 0, evidence: [], fromStage: "pdp", toStage: "cta" },
    { id: "risk", title: "", who: "", size: 40, revenue: 100, evidence: [] },
    { id: "lost", title: "", who: "", size: 40, revenue: 200, evidence: [] },
  ];
  const pair = { leftName: "SPF", rightName: "Крем", n: 10 };
  const on = klaviyoSteps({ pockets, cycleDays: 31, letters: true, pair, stageLabels: { pdp: "Смотрели товар", cta: "Положили в корзину" } });
  assert.deepEqual(on.map((step) => step.id), ["risk", "drop", "lost"]);
  assert.equal(on.find((step) => step.id === "drop")?.send, false);
  assert.equal(on.find((step) => step.id === "risk")?.send, true);
  assert.match(on.find((step) => step.id === "risk")?.who ?? "", /Заказ оформлен \(Placed Order\) = 1/);
  assert.match(on.find((step) => step.id === "lost")?.who ?? "", /Заказ оформлен \(Placed Order\) ≥ 2/);
  assert.match(on.find((step) => step.id === "risk")?.subject ?? "", /Крем/);
  assert.match(on.find((step) => step.id === "risk")?.product ?? "", /Крем/);
  assert.match(on.find((step) => step.id === "risk")?.watch ?? "", /не пересекается/);
  assert.equal(mondayStep(on, true)?.id, "risk");
  assert.equal(mondayStep(on, false)?.id, "drop");
  const off = klaviyoSteps({ pockets, cycleDays: 31, letters: false, pair: null });
  assert.deepEqual(off.map((step) => step.id), ["drop", "risk", "lost"]);
  assert.equal(off.find((step) => step.id === "risk")?.send, false);
  assert.match(off.find((step) => step.id === "risk")?.product ?? "", /не подставлять/);
});

test("week window is seven days to asOf and silent revenue outranks the site drop", () => {
  const data = fullDemoDataset();
  const workspace = buildWorkspace({
    events: data.events,
    orders: data.orders,
    nps: data.nps,
    config: FULL_DEMO_CONFIG,
  });
  const week = weekWindow(workspace.entities, workspace.orders, FULL_DEMO_CONFIG.asOf);
  assert.equal(week.from, "2026-08-26");
  assert.equal(week.to, "2026-09-01");
  assert.equal(week.visits, 0);
  assert.equal(week.payments, 0);
  assert.equal(week.newBuyers, 0);
  assert.equal(week.repeatPayments, 0);
  const pockets = queryDiagnostic(workspace, FULL_DEMO_CONFIG);
  const once = pockets.find((pocket) => pocket.id === "risk");
  const again = pockets.find((pocket) => pocket.id === "lost");
  const drop = pockets.find((pocket) => pocket.id === "drop");
  assert.ok(once && again && drop);
  assert.ok(once.revenue > 0);
  assert.ok(again.revenue > 0);
  assert.equal(drop.revenue, 0);
  const written = writeReportSnapshot({ workspace, config: FULL_DEMO_CONFIG, pockets, prior: emptyPrior() });
  assert.equal(written.snapshot.length, letterSegment(workspace, FULL_DEMO_CONFIG).length);
  assert.equal(written.snapshot.length, once.size);
  const treatment = written.snapshot.filter((line) => line.arm === "treatment").length;
  const control = written.snapshot.filter((line) => line.arm === "control").length;
  assert.equal(treatment + control, written.snapshot.length);
  assert.ok(treatment > 0 && control > 0);
  assert.ok(Math.abs(treatment - control) <= 3);
  const steps = klaviyoSteps({
    pockets,
    cycleDays: 31,
    letters: true,
    pair: { leftName: "SPF", rightName: "Крем", n: 10 },
  });
  assert.equal(mondayStep(steps, true)?.id, "risk");
  assert.equal(mondayStep(steps, false)?.id, "drop");
});

test("one move rank: email first by paid money, drop of people is not first", () => {
  const pockets = [
    { id: "drop", title: "", who: "", size: 80, revenue: 0, evidence: [], fromStage: "pdp", toStage: "cta" },
    { id: "risk", title: "", who: "", size: 40, revenue: 2500, evidence: [] },
    { id: "lost", title: "", who: "", size: 40, revenue: 3940, evidence: [] },
  ];
  const lettersOn = true;
  const ranked = rankMoves(pockets, lettersOn).map((pocket) => pocket.id);
  assert.deepEqual(ranked, ["risk", "drop", "lost"]);
  const steps = klaviyoSteps({
    pockets,
    cycleDays: 31,
    letters: lettersOn,
    pair: { leftName: "SPF", rightName: "Крем", n: 10 },
  });
  const actions = clientActions(pockets, {
    cycle: "31",
    asOf: "1 сентября 2026",
    currency: "€",
    letters: lettersOn,
  });
  const cards = problemCards({
    pockets,
    cycleDays: 31,
    letters: lettersOn,
    letterReason: "",
    pair: { leftName: "SPF", rightName: "Крем", n: 10 },
    currency: "€",
  });
  assert.deepEqual(steps.map((step) => step.id), ranked);
  assert.deepEqual(actions.map((action) => action.id), ranked);
  assert.deepEqual(cards.map((card) => card.id), ranked);
  assert.equal(mondayStep(steps, lettersOn)?.id, "risk");
  assert.equal(actions[0]?.id, "risk");
  assert.equal(cards[0]?.id, "risk");
  assert.equal(cards[0]?.lane, "main");
  const blocked = clientActions(pockets, {
    cycle: "31",
    asOf: "1 сентября 2026",
    letters: false,
  });
  assert.equal(blocked[0]?.id, "drop");
  assert.doesNotMatch(blocked.find((action) => action.id === "risk")?.why ?? "", /GDPR|ePrivacy|ст\./);
  const lawCards = problemCards({
    pockets,
    cycleDays: 31,
    letters: false,
    letterReason: "Рекламное письмо нельзя. GDPR, ст. 5. Согласия нет (ePrivacy, ст. 13).",
    pair: { leftName: "SPF", rightName: "Крем", n: 10 },
    currency: "€",
  });
  for (const card of lawCards) {
    assert.doesNotMatch(card.solution, /GDPR|ePrivacy|ст\./);
    assert.doesNotMatch(card.solution, /Крем|SPF/);
    assert.doesNotMatch(card.problem, /\d/);
  }
  assert.doesNotMatch(cards.find((card) => card.id === "risk")?.what ?? "", /€/);
  assert.match(cards.find((card) => card.id === "risk")?.result ?? "", /2\s?500/);
  const verdict = weekVerdict({
    letters: true,
    cycleDays: 31,
    once: { size: 40, revenue: 2500 },
    pair: { leftName: "SPF", rightName: "Крем", n: 10 },
    hitRate: null,
    allPastCycle: true,
    buyersN: 80,
    currency: "€",
  });
  assert.ok(verdict.length <= 420);
  assert.doesNotMatch(verdict, /тема|GDPR|ePrivacy/);
  const bans = moveBans({
    letters: true,
    featured: steps[0],
    steps,
    constraint: "без скидки в теме",
  });
  assert.ok(bans.every((ban) => /^Не /.test(ban)));
  assert.ok(bans.some((ban) => /скидк/i.test(ban)));
  assert.ok(bans.every((ban) => !/GDPR|ePrivacy|Крем|SPF/.test(ban)));
  assert.deepEqual(
    klaviyoSteps({ pockets, cycleDays: 31, letters: false, pair: null }).map((step) => step.id),
    ["drop", "risk", "lost"],
  );
});

test("diagnostic pack splits recency from frequency and keeps unanswered nps aside", () => {
  const buyers = [
    { ...buyer("a", "2026-03-01", "2026-04-01", "2026-08-20", 2), age_days: 180 },
    { ...buyer("b", "2026-03-02", null, "2026-03-02", 1), age_days: 180 },
  ];
  const orders = [
    { ...lineOrder("serum", "Сыворотка", "2026-03-01"), entity_id: "a", email_hash: piiHmac("a@t") },
    { ...lineOrder("serum", "Сыворотка", "2026-03-02"), entity_id: "b", email_hash: piiHmac("b@t") },
  ];
  const packConfig = { ...baseConfig, replenishmentLow: 30, replenishmentHigh: 90 };
  const cells = rfmGrid(buyers, packConfig);
  assert.ok(cells.some((cell) => cell.n > 0));
  const points = rfmPoints(buyers, packConfig);
  assert.equal(points.length, 2);
  assert.equal(points.filter((point) => point.repeat).length, 1);
  assert.ok(points.every((point) => point.recency >= 0 && point.ltv > 0));
  const voice = voiceGrid(buyers, orders, [
    { email: "a@t", score: 9, date: "2026-08-20", source: "email", requested: true },
  ]);
  assert.equal(voice.find((cell) => cell.band === "promoter")?.n, 1);
  assert.equal(voice.find((cell) => cell.band === "never")?.n, 1);
  const data = fullDemoDataset();
  const recognition = recognizeRaw({
    events: data.events,
    orders: data.orders,
    nps: data.nps,
    stableIdColumn: "anonymous_id",
  });
  const channels = deliveryChannels(recognition);
  assert.ok((channels.find((row) => row.channel === "email")?.n ?? 0) > 0);
  assert.ok((channels.find((row) => row.channel === "sms")?.n ?? 0) > 0);
  assert.equal(channels.find((row) => row.channel === "whatsapp")?.n, 0);
  assert.equal(channels.every((row) => row.send === false), true);
  assert.equal(channelGroup("instagram", "cpc"), "instagram");
});

test("unit economics keeps observed ltv and waits for operator spend", () => {
  const visitor = {
    ...buyer("v", "2026-03-01", null, "2026-03-01", 0),
    converted: false,
    purchased: false,
    n_orders: 0,
    ltv: 0,
    funnel_depth: 1,
    age_days: null,
    first_purchase_at: null,
    last_purchase_at: null,
  };
  const once = { ...buyer("a", "2026-03-01", null, "2026-03-01", 1), ltv: 40, age_days: 180, funnel_depth: 5 };
  const again = { ...buyer("b", "2026-03-01", "2026-04-01", "2026-04-01", 2), ltv: 80, age_days: 180, funnel_depth: 5 };
  const empty = unitEconomics([visitor, once, again], baseConfig);
  assert.equal(empty.visitors, 3);
  assert.equal(empty.buyers, 2);
  assert.equal(empty.revenue, 120);
  assert.equal(empty.observedLtv, 60);
  assert.equal(empty.repeat, 0.5);
  assert.equal(empty.derived.length, 0);
  assert.equal(empty.pnl, null);
  assert.equal(empty.aarrr.find((step) => step.id === "refer")?.n, null);
  const filled = unitEconomics([visitor, once, again], {
    ...baseConfig,
    marketingSpend: 100,
    grossMargin: 0.5,
    opex: 20,
    taxRate: 0.2,
    cash: 500,
  });
  assert.equal(filled.derived.find((card) => card.id === "cac")?.value, 50);
  assert.equal(filled.derived.find((card) => card.id === "cltv")?.value, 30);
  assert.equal(filled.derived.find((card) => card.id === "ltvcac")?.value, 0.6);
  assert.equal(filled.pnl?.find((line) => line.id === "net")?.value, -60);
  assert.equal(filled.burn, 60);
  assert.equal(filled.cards.find((card) => card.id === "ltv")?.value, 60);
  assert.equal(filled.cards.some((card) => card.id === "mrr"), false);
});

test("unit panel lives under studio assumptions, not week brief or spec", () => {
  const week = readFileSync(join(root, "src/app/page.tsx"), "utf8");
  const brief = readFileSync(join(root, "src/app/agents/retention-diagnostic/page.tsx"), "utf8");
  const studio = readFileSync(join(root, "src/app/studio/page.tsx"), "utf8");
  const spec = readFileSync(join(root, "src/app/spec/page.tsx"), "utf8");
  assert.match(studio, /saveUnitAssumptions[\s\S]*<UnitPanel/);
  assert.doesNotMatch(studio, /showAarrr=\{false\}/);
  assert.equal((studio.match(/<UnitPanel/g) ?? []).length, 1);
  assert.doesNotMatch(week, /UnitPanel|DiagnosticPack|RecognitionPanel/);
  assert.doesNotMatch(brief, /UnitPanel|DiagnosticPack|KlaviyoPanel|clientActions/);
  assert.doesNotMatch(spec, /UnitPanel|DiagnosticPack|RFM/);
});

function lineOrder(sku: string, name: string, day: string): import("./types").OrderRow {
  return {
    order_id: `${sku}-${day}`,
    entity_id: "x",
    purchased_at: `${day}T00:00:00Z`,
    sku,
    product_name: name,
    revenue: 40,
    status: "paid",
    is_subscription_renewal: false,
    orphan: false,
    countsAsOrder: true,
  };
}

function buyer(id: string, first: string, second: string | null, last: string, orders: number): EntityRow {
  return {
    entity_id: id,
    first_seen_at: first,
    last_seen_at: last ?? first,
    first_touch_channel: "direct",
    device: "desktop",
    user_type: "buyer",
    converted: true,
    first_purchase_at: first,
    second_purchase_at: second,
    last_purchase_at: last,
    ltv: 40,
    n_orders: orders,
    first_sku: "serum",
    saw_pdp: true,
    scrolled: false,
    clicked_cta: true,
    checkout: true,
    purchased: true,
    attribution_after_purchase: false,
    funnel_depth: 5,
    age_days: 100,
  };
}

function order(
  id: string,
  email: string,
  at: string,
  sku: string,
  revenue: number,
  renewal: boolean,
): RawOrder {
  return {
    order_id: id,
    email,
    created_at: at,
    sku,
    product_name: sku,
    quantity: 1,
    revenue,
    status: "paid",
    is_subscription_renewal: renewal,
  };
}

function visit(id: string, name: string): RawEvent {
  return {
    event_name: name,
    timestamp: "2026-01-01T00:00:00Z",
    session_id: id,
    anonymous_id: id,
    user_email: `${id}@test`,
  };
}

test("numbers use one formatter: space before percent, comma, minus, currency", () => {
  const nbsp = "\u00A0";
  assert.equal(formatBand(0.5, 0.393, 0.607), `50${nbsp}% (39,3${nbsp}%–60,7${nbsp}%)`);
  assert.equal(formatPp(0.2, -0.206, 0.528), "+20 п.п., интервал от \u221220,6 до +52,8 п.п.");
  assert.equal(formatCount(1250820), `1${nbsp}250${nbsp}820`);
  assert.equal(formatMoney(55, ""), "55 у. е.");
  assert.equal(formatPct(0.803), `80,3${nbsp}%`);
  assert.equal(formatPp(0.2, -0.206, 0.528).includes("-"), false);
});

test("send window does not print a zero-width day when the median is missing", () => {
  const missing = sendWindowText({ low: 96, high: 96, hazardPeak: 121, fromData: false, priorLow: 30, priorHigh: 90 });
  assert.match(missing, /из приора категории/);
  assert.match(missing, /за пределами окна/);
  assert.doesNotMatch(missing, /день (\d+)–\1(?!\d)/);
  const inside = sendWindowText({ low: 96, high: 96, hazardPeak: 40, fromData: false, priorLow: 30, priorHigh: 90 });
  assert.match(inside, /день 30–90 из приора категории/);
  assert.doesNotMatch(inside, /день 96–96/);
});

test("audience notice names both counts and no task id", () => {
  const notice = audienceGapNotice(20, 40);
  const text = `${notice.seen} ${notice.why} ${notice.means}`;
  assert.match(notice.seen, /20/);
  assert.match(notice.seen, /40/);
  assert.match(notice.why, /ключа бренда/);
  assert.doesNotMatch(notice.why, /двадцати/);
  assert.match(notice.means, /эти 20/);
  assert.doesNotMatch(text, /F0\./);
});

function withEmail(cookie: string, email: string): RawEvent {
  return {
    event_name: "view_landing",
    timestamp: "2026-01-01T00:00:00Z",
    session_id: cookie,
    anonymous_id: cookie,
    user_email: email,
  };
}

function exposure(experiment: string, variant: string, entity: string) {
  return {
    experiment_id: experiment,
    variant,
    entity_id: entity,
    exposed_at: "2026-08-01T00:00:00Z",
    device_type: "desktop",
    channel_group: "direct",
    user_type: "new",
    in_holdout: false,
    reached_checkout_after: false,
  };
}
