import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { CohortLtvTable } from "./cohort-ltv";
import { DataNotice } from "./data-notice";
import { FailedCut } from "./failed-cut";
import { EvidenceBadge } from "./evidence";
import { HoldoutVerdict } from "./holdout-verdict";
import { KeyList } from "./key-list";
import { KlaviyoPanel } from "./klaviyo-panel";
import { PilotChecklist } from "./pilot-checklist";
import { PowerNote } from "./power-note";
import { ReasonCodes } from "./reason-codes";
import { ModelCard } from "./model-card";
import { ShrinkChart } from "./shrink-chart";
import { ColumnChart, DiffScale, FunnelChart, GroupedChart, StepChart } from "./week-charts";

test("status chips and verdict blocks use the kit classes", () => {
  const html = renderToStaticMarkup(
    createElement(
      "div",
      null,
      createElement("span", { className: "status ok" }, "✓ Подтверждён"),
      createElement("span", { className: "status wait" }, "○ Не проверен"),
      createElement("span", { className: "status bad" }, "✕ Нарушен"),
      createElement("span", { className: "tag thin" }, "◐ мало данных"),
      createElement("span", { className: "tag hidden" }, "▧ скрыто"),
      createElement("section", { className: "verdict ok" }, "можно"),
      createElement("section", { className: "verdict wait" }, "ждём"),
      createElement("section", { className: "verdict bad" }, "нарушен"),
    ),
  );
  for (const marker of ["✓", "○", "✕", "◐", "▧"]) assert.match(html, new RegExp(marker));
  assert.match(html, /class="status ok"/);
  assert.match(html, /class="verdict wait"/);
  assert.match(html, /class="verdict bad"/);
  assert.equal(html.indexOf("✓"), html.search(/Подтверждён/) - 2);
});

test("data notice is three parts in order and has no task id", () => {
  const html = renderToStaticMarkup(
    createElement(DataNotice, {
      seen: "В снимок попали 20 из 40 человек сегмента.",
      why: "Снимок строится из первых двадцати покупателей, а не из сегмента хода.",
      means: "Списки «Кому / Кому не» — именно эти 20. Исправление — на стороне движка.",
    }),
  );
  assert.match(html, /⚠/);
  const seen = html.indexOf("В снимок попали");
  const why = html.indexOf("первых двадцати");
  const means = html.indexOf("Исправление");
  assert.ok(seen < why && why < means);
  assert.doesNotMatch(html, /F0\./);
});

test("key list is collapsed and does not print keys", () => {
  const html = renderToStaticMarkup(createElement(KeyList, { title: "Кому", keys: ["u-102", "u-106"] }));
  assert.match(html, /2 ключа/);
  assert.match(html, /показать/);
  assert.doesNotMatch(html, /u-102/);
  assert.match(html, /class="key-list"/);
  const empty = renderToStaticMarkup(createElement(KeyList, { title: "Кому", keys: [] }));
  assert.match(empty, /Список пуст/);
  assert.doesNotMatch(empty, /скопировать/);
});

test("a site move does not render the key wall", () => {
  const html = renderToStaticMarkup(
    createElement(KlaviyoPanel, {
      pockets: [
        { id: "drop", title: "", who: "", size: 80, revenue: 0, evidence: [], fromStage: "pdp", toStage: "cta" },
        { id: "risk", title: "", who: "", size: 40, revenue: 100, evidence: [] },
      ],
      cycleDays: 31,
      letters: false,
      pair: null,
      layout: "monday",
      audience: { treatment: ["u-1", "u-2"], control: ["u-3"], covered: true, note: "" },
    }),
  );
  assert.doesNotMatch(html, /Кому/);
  assert.doesNotMatch(html, /u-1/);
});

const lift = {
  interim: false,
  contamination: null,
  compliance: null,
  onReceived: null,
  diff: 0.2,
  low: -0.206,
  high: 0.528,
  prob: 0.803,
  treatmentN: 10,
  controlN: 10,
  ready: true,
  frozenText: "2 500 €",
  seasonalText: null,
};

test("эффект is only in the confirmed holdout verdict", () => {
  const confirmed = renderToStaticMarkup(createElement(HoldoutVerdict, { ...lift, status: "confirmed" }));
  const unchecked = renderToStaticMarkup(createElement(HoldoutVerdict, { ...lift, status: "unchecked" }));
  const violated = renderToStaticMarkup(
    createElement(HoldoutVerdict, { ...lift, status: "violated", contamination: 0.4, diff: null }),
  );
  assert.match(confirmed, /✓ Подтверждён/);
  assert.match(confirmed, /эффект/);
  assert.match(confirmed, /Заражение контроля/);
  assert.doesNotMatch(unchecked, /эффект/);
  assert.match(unchecked, /○ Не проверен/);
  assert.match(unchecked, /received_email/);
  assert.match(unchecked, /не измерено/);
  assert.doesNotMatch(violated, /эффект/);
  assert.match(violated, /✕ Нарушен/);
  assert.doesNotMatch(violated, /class="scale"/);
  assert.equal(renderToStaticMarkup(createElement(HoldoutVerdict, { ...lift, status: "unchecked", ready: false })), "");
});

test("diff scale marks zero when the interval crosses it", () => {
  const cross = renderToStaticMarkup(createElement(DiffScale, { diff: 0.2, low: -0.206, high: 0.528 }));
  assert.match(cross, /<line /);
  assert.match(cross, /задевает ноль/);
  assert.match(cross, /Шкала разницы повтора/);
  const above = renderToStaticMarkup(createElement(DiffScale, { diff: 0.2, low: 0.05, high: 0.3 }));
  assert.doesNotMatch(above, /задевает ноль/);
  assert.equal(renderToStaticMarkup(createElement(DiffScale, { diff: null, low: 0, high: 0 })), "");
});

test("evidence badge is empty when the count is enough", () => {
  assert.equal(renderToStaticMarkup(createElement(EvidenceBadge, { n: 20, rule: "people" })), "");
  assert.match(renderToStaticMarkup(createElement(EvidenceBadge, { n: 3, rule: "people" })), /скрыто/);
  assert.match(renderToStaticMarkup(createElement(EvidenceBadge, { n: 10, rule: "lookalike" })), /мало данных/);
});

test("a column with a band draws three whisker lines", () => {
  const html = renderToStaticMarkup(
    createElement(ColumnChart, {
      title: "Проверка",
      columns: [{ label: "А", value: 50, fill: "var(--sage)", band: [25, 70] }],
    }),
  );
  assert.match(html, /с интервалами/);
  const lines = html.match(/<line /g) ?? [];
  assert.ok(lines.length >= 3);
});

test("power note says a decision is possible only when control is large enough", () => {
  const small = renderToStaticMarkup(
    createElement(PowerNote, { controlN: 10, repeatP: 0.5, repeatN: 40, repeatText: "50 %" }),
  );
  assert.match(small, /накопление в приор/);
  assert.doesNotMatch(small, /В control/);
  const large = renderToStaticMarkup(
    createElement(PowerNote, { controlN: 5000, repeatP: 0.5, repeatN: 40, repeatText: "50 %" }),
  );
  assert.match(large, /решение возможно/);
});

test("reason codes prose has no digits", () => {
  const html = renderToStaticMarkup(
    createElement(ReasonCodes, { bucket: "top", reasons: ["давно не покупал", "чек 12", "первый товар — крем"] }),
  );
  assert.match(html, /скорее вернётся/);
  assert.match(html, /давно не покупал/);
  assert.doesNotMatch(html, /\d/);
  assert.equal(renderToStaticMarkup(createElement(ReasonCodes, { bucket: null, reasons: [] })), "");
});

test("cohort 365 stays visible when nobody has lived a year", () => {
  const html = renderToStaticMarkup(
    createElement(CohortLtvTable, {
      currency: "EUR",
      cohorts: [
        { horizon: 90, n: 80, ltv: 81, low: 75, high: 86 },
        { horizon: 180, n: 20, ltv: 81, low: 76, high: 85 },
        { horizon: 365, n: 0, ltv: 0, low: 0, high: 0 },
      ],
    }),
  );
  assert.match(html, /365 дней/);
  assert.match(html, /ни один покупатель не прожил 365 дней/);
  assert.match(html, /СКРЫТО/);
});

test("pilot footer names gaps without digits", () => {
  const html = renderToStaticMarkup(
    createElement(PilotChecklist, {
      pilot: {
        buyers: 4,
        repeatPurchases: 0,
        nonBuyerEmailEvents: 1,
        spanDays: 10,
        customerIdOrders: 0,
        sentWithKey: 0,
        openedWithKey: 0,
        items: [
          { id: "buyers", label: "Не меньше 300 покупателей", met: false, detail: "В файле 4" },
          { id: "repeats", label: "Повторы", met: false, detail: "0" },
          { id: "nonbuyer-email", label: "Почта", met: true, detail: "есть" },
          { id: "windows", label: "Период", met: false, detail: "10 дней" },
          { id: "customer-id", label: "customer_id в заказах", met: false, detail: "нет" },
          { id: "sends", label: "Желательно", met: true, detail: "есть" },
        ],
      },
    }),
  );
  assert.match(html, /2 из 6/);
  assert.match(html, /Не готов/);
  const footer = html.match(/Что донести:[^<]*/)?.[0] ?? "";
  assert.doesNotMatch(footer, /\d/);
  assert.match(footer, /покупателей/);
});

test("step chart draws a greenwood polygon and a median only when it exists", () => {
  const point = { time: 10, atRisk: 8, events: 1, censored: 0, survival: 0.8, low: 0.5, high: 0.95, hazard: 0.1 };
  const html = renderToStaticMarkup(
    createElement(StepChart, {
      curve: [point],
      median: 41,
      hazardPeak: 31,
      window: { low: 31, high: 41, fromData: true },
      prior: { low: 30, high: 90 },
      n: 40,
      size: "small",
    }),
  );
  assert.match(html, /<polygon /);
  assert.match(html, /stroke-dasharray="4 4"/);
  const noMedian = renderToStaticMarkup(
    createElement(StepChart, {
      curve: [point],
      median: null,
      hazardPeak: 31,
      window: { low: 30, high: 90, fromData: false },
      prior: { low: 30, high: 90 },
      n: 4,
    }),
  );
  assert.doesNotMatch(noMedian, /stroke-dasharray="4 4"/);
});

test("shrink chart shows the raw bar, the shrunk whisker, and a thin chip", () => {
  const html = renderToStaticMarkup(
    createElement(ShrinkChart, {
      title: "Устройства",
      rule: "lookalike",
      rows: [
        { id: "mobile", label: "телефон", successes: 40, n: 97 },
        { id: "desktop", label: "компьютер", successes: 41, n: 101 },
        { id: "tablet", label: "планшет", successes: 8, n: 20 },
        { id: "tiny", label: "скрытый", successes: 1, n: 3 },
      ],
    }),
  );
  assert.match(html, /с интервалами/);
  assert.match(html, /мало данных/);
  assert.match(html, /планшет/);
  assert.match(html, /n 20/);
  assert.match(html, /stroke-dasharray="4 4"/);
  assert.match(html, /таких групп нет/);
  assert.match(html, /height="18"/);
  assert.match(html, /скрыто/);
  const allHidden = renderToStaticMarkup(
    createElement(GroupedChart, {
      title: "Пусто",
      groups: [{ label: "А", evidence: "hidden", bars: [] }],
    }),
  );
  assert.match(allHidden, /Все столбцы скрыты/);
  assert.doesNotMatch(allHidden, /<svg/);
});

test("model card draws recorded calibration and does not invent a bin interval", () => {
  const html = renderToStaticMarkup(
    createElement(ModelCard, {
      row: {
        version: "en-1",
        status: "shadow",
        modelType: "elastic-net",
        metrics: { pr_auc: { value: 0.41, low: 0.36, high: 0.47 }, brier: { value: 0.19 } },
        card: { calibration: [{ predicted: 0.2, observed: 0.25 }], synthetic: true },
        audit: null,
      },
    }),
  );
  assert.match(html, /Калибровка по бинам/);
  assert.match(html, /Предсказано/);
  assert.match(html, /Интервала по бинам в карточке нет/);
  assert.match(html, /PSI и решение чемпиона/);
  assert.doesNotMatch(html, /с интервалами/);
  assert.match(renderToStaticMarkup(createElement(ModelCard, { row: null })), /Карточки модели для этого проекта нет/);
});

test("every plot svg has a title and an aria-label", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "week-charts.tsx"), "utf8");
  const svgs = source.match(/<svg\b[^>]*>/g) ?? [];
  assert.ok(svgs.length >= 8);
  for (const svg of svgs) {
    assert.match(svg, /aria-label=/);
    assert.match(svg, /role="img"/);
  }
  const funnel = renderToStaticMarkup(
    createElement(FunnelChart, {
      rows: [
        { stage: "pdp", lifetime: 100 },
        { stage: "purchase", lifetime: 40 },
      ],
      labels: { pdp: "Смотрели товар", purchase: "Купили" },
    }),
  );
  assert.match(funnel, /aria-label="Люди по шагам сайта"/);
  assert.match(funnel, /<title>Люди по шагам сайта<\/title>/);
  assert.match(funnel, /Смотрели товар/);
  assert.match(funnel, /%/);
  assert.doesNotMatch(funnel, /с интервалами/);
});

test("a failed cut shows the recorded reason or the empty-reason sentence", () => {
  const named = renderToStaticMarkup(createElement(FailedCut, { error: "В файле заказов нет столбца purchased_at" }));
  assert.match(named, /Срез не посчитался/);
  assert.match(named, /⚠ В файле заказов нет столбца purchased_at/);
  assert.doesNotMatch(named, /Error:|at /);
  const empty = renderToStaticMarkup(createElement(FailedCut, { error: "  " }));
  assert.match(empty, /⚠ Причина не записана: откройте файл и проверьте колонки заказов/);
});
