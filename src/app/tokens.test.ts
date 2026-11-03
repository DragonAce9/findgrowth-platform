import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cssPath = join(dirname(fileURLToPath(import.meta.url)), "globals.css");

function tokens(): Record<string, string> {
  const css = readFileSync(cssPath, "utf8");
  const root = css.match(/:root\s*\{([^}]+)\}/);
  assert.ok(root, "globals.css has :root");
  const found: Record<string, string> = {};
  for (const line of root[1].split("\n")) {
    const match = line.match(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/);
    if (match) found[match[1]] = match[2].toLowerCase();
  }
  return found;
}

function channel(hex: string): number {
  const value = Number.parseInt(hex, 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const raw = hex.replace("#", "");
  const r = channel(raw.slice(0, 2));
  const g = channel(raw.slice(2, 4));
  const b = channel(raw.slice(4, 6));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fore: string, back: string): number {
  const lighter = Math.max(luminance(fore), luminance(back));
  const darker = Math.min(luminance(fore), luminance(back));
  return (lighter + 0.05) / (darker + 0.05);
}

test("text colors clear WCAG AA and fills clear 3:1", () => {
  const color = tokens();
  const card = color["--card"];
  const paper = color["--paper"];
  const paper2 = color["--paper-2"];
  const textPairs: Array<[string, string]> = [
    ["--ink", "--card"],
    ["--ink", "--paper"],
    ["--ink", "--paper-2"],
    ["--ink-soft", "--card"],
    ["--ink-soft", "--paper"],
    ["--ink-soft", "--paper-2"],
    ["--muted", "--card"],
    ["--muted", "--paper"],
    ["--muted", "--paper-2"],
    ["--sage-ink", "--sage-soft"],
    ["--sage-ink", "--card"],
    ["--sage-ink", "--paper"],
    ["--gold-ink", "--gold-soft"],
    ["--gold-ink", "--card"],
    ["--gold-ink", "--paper"],
    ["--danger-ink", "--danger-soft"],
    ["--danger-ink", "--card"],
    ["--danger-ink", "--paper"],
    ["--rose-ink", "--rose-soft"],
    ["--rose-ink", "--card"],
    ["--rose-ink", "--paper"],
  ];
  for (const [fore, back] of textPairs) {
    const ratio = contrast(color[fore], color[back]);
    assert.ok(ratio >= 4.5, `${fore} on ${back} is ${ratio.toFixed(2)}, need 4.5`);
  }
  assert.ok(contrast("#ffffff", color["--rose"]) >= 4.5, "white on rose");
  for (const fill of ["--sage", "--rose", "--ink"]) {
    const ratio = contrast(color[fill], card);
    assert.ok(ratio >= 3, `${fill} on card is ${ratio.toFixed(2)}, need 3`);
  }
});

test("sand is a chart fill with a number caption, not a text color", () => {
  const css = readFileSync(cssPath, "utf8");
  const color = tokens();
  assert.equal(color["--sand"], "#38bdf8");
  assert.ok(contrast(color["--sand"], color["--card"]) < 3, "sand stays below text contrast; captions carry the number");
  assert.doesNotMatch(css, /color:\s*var\(--sand\)/);
});

test("accent tokens are fills, ink tokens are text", () => {
  const css = readFileSync(cssPath, "utf8");
  assert.doesNotMatch(css, /color:\s*var\(--(?:sage|gold|rose|danger)\)/);
  assert.doesNotMatch(css, /color:\s*#b45309/);
  assert.match(css, /--gold-ink:\s*#b45309/);
  assert.match(css, /\.verdict\.ok \{ background: var\(--sage-soft\); border-color: transparent; \}/);
  assert.match(css, /\.verdict\.no \{ background: var\(--gold-soft\); border-color: transparent; \}/);
  assert.match(css, /\.tag \{[\s\S]*font-size: 11px/);
  assert.match(css, /\.status \{[\s\S]*font-size: 12px/);
  assert.match(css, /\.kpi \.lbl \{ font-size: 12px/);
  assert.match(css, /\.kpi \.val\.text, \.unit-card \.val\.text \{ font-size: 16px/);
  assert.match(css, /button, input, select, textarea \{ font: inherit/);
});
