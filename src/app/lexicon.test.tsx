import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { deviceLabel, metricCaption, RU_TERMS } from "@/engine/client-copy";
import { powerBrief } from "@/engine/experiments";
import { klaviyoSteps, moveBans, sendWindowText } from "@/engine/klaviyo";
import { KlaviyoPanel } from "./klaviyo-panel";
import { ShrinkChart } from "./shrink-chart";

const ALLOW = [
  "PR-AUC",
  "Brier",
  "PSI",
  "LTV",
  "P&L",
  "COGS",
  "OPEX",
  "EBIT",
  "CAC",
  "ROAS",
  "Klaviyo",
  "GDPR",
  "ePrivacy",
  "Inter",
  "ARPU",
  "Instagram",
];

function visibleLatin(html: string): string {
  const text = html
    .replace(/<code>[\s\S]*?<\/code>/g, " ")
    .replace(/<[^>]+>/g, " ");
  let rest = text;
  for (const word of ALLOW) rest = rest.split(word).join(" ");
  return rest;
}

test("rendered copy has no latin outside code and the allowlist", () => {
  const pockets = [
    { id: "drop", title: "", who: "", size: 80, revenue: 0, evidence: [], fromStage: "pdp", toStage: "cta" },
    { id: "risk", title: "", who: "", size: 40, revenue: 2500, evidence: [] },
    { id: "lost", title: "", who: "", size: 12, revenue: 800, evidence: [] },
  ];
  const steps = klaviyoSteps({
    pockets,
    cycleDays: 31,
    letters: true,
    pair: { leftName: "Сыворотка", rightName: "Крем", n: 10 },
    cycle: { low: 31, high: 41, hazardPeak: 31, fromData: true },
  });
  const bans = moveBans({ letters: true, featured: steps[0], steps });
  const html = renderToStaticMarkup(
    createElement(
      "div",
      null,
      createElement(KlaviyoPanel, {
        pockets,
        cycleDays: 31,
        letters: true,
        pair: { leftName: "Сыворотка", rightName: "Крем", n: 10 },
        layout: "monday",
        currency: "€",
        audience: { treatment: ["k1", "k2"], control: ["k3"], covered: true, note: "" },
        power: powerBrief({ controlN: 10, repeatP: 0.5, effectPp: 5 }),
      }),
      createElement("p", null, deviceLabel("mobile"), " ", deviceLabel("desktop"), " ", deviceLabel("tablet")),
      createElement("p", null, metricCaption("identity_coverage"), " ", metricCaption("not_a_metric")),
      createElement("p", null, sendWindowText({ low: 96, high: 96, hazardPeak: 121, fromData: false, priorLow: 30, priorHigh: 90 })),
      createElement("p", null, bans.join(" ")),
      createElement("p", null, Object.values(RU_TERMS).join(" ")),
      createElement(ShrinkChart, {
        title: "Устройства",
        rule: "lookalike",
        rows: [
          { id: "mobile", label: "телефон", successes: 40, n: 97 },
          { id: "tablet", label: "планшет", successes: 8, n: 20 },
        ],
      }),
    ),
  );
  const latin = visibleLatin(html);
  assert.doesNotMatch(latin, /[A-Za-z]{2,}/, latin);
  assert.match(html, /<code>Placed Order<\/code>/);
  assert.match(html, /телефон/);
  assert.match(html, /подпись не задана/);
  assert.doesNotMatch(html, /В control/);
});

test("app source does not put the old english labels in visible copy", () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const files = walk(root).filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"));
  const bad = /Placed Order|В control|label:\s*row\.device|>Flow |два flow|Acquire \/ Activate/;
  for (const file of files) {
    if (file.endsWith("term.tsx")) continue;
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, bad, file);
  }
});

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else found.push(path);
  }
  return found;
}
