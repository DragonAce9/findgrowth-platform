import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { tickJobs } from "./job-queue";
import { closeDb, enqueueJob, insertModel, latestModelForProject, readJob } from "./platform-db";
import {
  applyShadowScores,
  decideChampion,
  observedRepeatByBucket,
  populationStabilityIndex,
  PSI_WARN,
  renderModelCard,
} from "./registry";
import type { OrderRow, SnapshotLine } from "./types";

test("shadow scores do not change the offer or the arm, and a later cut is monotone", () => {
  const lines: SnapshotLine[] = ["a", "b", "c", "d", "e", "f"].map((id, index) => ({
    entity_id: id,
    sku: "serum",
    rank: index + 1,
    model_version: "item-item-v1",
    as_of: "2026-01-01",
    role: "serum",
    score: 0,
    bucket: null,
    arm: index % 2 === 0 ? "treatment" : "control",
    methodology_version: "2.0",
    config_hash: "h",
  }));
  const shadow = applyShadowScores(
    lines,
    [
      { entity_id: "a", score: 0.9, bucket: "top" },
      { entity_id: "b", score: 0.8, bucket: "top" },
      { entity_id: "c", score: 0.5, bucket: "middle" },
      { entity_id: "d", score: 0.4, bucket: "middle" },
      { entity_id: "e", score: 0.1, bucket: "bottom" },
      { entity_id: "f", score: 0.05, bucket: "bottom" },
    ],
    "en-shadow-1",
  );
  assert.deepEqual(
    shadow.map((line) => line.sku),
    lines.map((line) => line.sku),
  );
  assert.deepEqual(
    shadow.map((line) => line.arm),
    lines.map((line) => line.arm),
  );
  assert.ok(shadow.every((line) => line.model_version === "en-shadow-1"));
  const later = shadow.map((line) => ({ ...line, as_of: "2026-02-01" }));
  const orders = ["a", "b", "c"].map((id, index) => order(id, `2026-03-0${index + 1}`));
  const summary = observedRepeatByBucket(later, orders);
  const top = summary.find((row) => row.bucket === "top");
  const bottom = summary.find((row) => row.bucket === "bottom");
  assert.ok(top && bottom && top.n > 0 && bottom.n > 0);
  assert.ok(top.repeated / top.n > bottom.repeated / bottom.n);
});

test("champion promotion and the Brier kill-switch both leave an audit line", () => {
  const dir = mkdtempSync(join(tmpdir(), "fg-model-"));
  process.env.FG_DB_PATH = join(dir, "platform.sqlite");
  closeDb();
  const killed = decideChampion({
    candidate: { prAuc: 0.9, brier: 0.4 },
    champion: { prAuc: 0.5, brier: 0.2 },
    baselineBrier: 0.2,
    brierMargin: 0.05,
  });
  assert.equal(killed.status, "challenger");
  assert.equal(killed.killed, true);
  const lost = decideChampion({
    candidate: { prAuc: 0.4, brier: 0.2 },
    champion: { prAuc: 0.6, brier: 0.2 },
    baselineBrier: 0.25,
    brierMargin: 0.05,
  });
  assert.equal(lost.status, "challenger");
  assert.equal(lost.killed, false);
  const won = decideChampion({
    candidate: { prAuc: 0.7, brier: 0.18 },
    champion: { prAuc: 0.6, brier: 0.2 },
    baselineBrier: 0.25,
    brierMargin: 0.05,
  });
  assert.equal(won.status, "champion");
  insertModel({
    id: "m_win",
    tenantId: "tenant",
    projectId: "project",
    version: "en-1",
    modelType: "elastic-net-logistic",
    status: won.status,
    artifactPath: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    metricsJson: JSON.stringify({ pr_auc: { value: 0.7, low: 0.6, high: 0.8 }, brier: { value: 0.18, low: 0.1, high: 0.25 } }),
    cardJson: JSON.stringify({ synthetic: true, mode: "shadow", psi: 0.4 }),
    audit: won.audit,
  });
  const stored = latestModelForProject("project");
  assert.ok(stored);
  assert.equal(stored.audit, won.audit);
  const line = renderModelCard(stored);
  assert.match(line, /en-1/);
  assert.match(line, /чемпион/);
  assert.match(line, /синтетическая/);
  assert.match(line, /PSI/);
  assert.equal(renderModelCard(latestModelForProject("missing") ?? null), "Карточки модели для этого проекта нет.");
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test("PSI warns when the second cut is shifted", () => {
  const calm = Array.from({ length: 40 }, (_, index) => index / 40);
  const same = populationStabilityIndex(calm, calm.map((value) => value + 0.001));
  const shifted = populationStabilityIndex(calm, calm.map((value) => value + 5));
  assert.ok(same < PSI_WARN);
  assert.ok(shifted > PSI_WARN);
  assert.match(renderModelCard({
    version: "s",
    status: "shadow",
    modelType: "elastic-net",
    metrics: null,
    card: { synthetic: true, psi: shifted },
    audit: null,
  }), /0,25/);
});

test("a thrown job is retried with backoff and does not kill the process", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fg-jobs-"));
  process.env.FG_DB_PATH = join(dir, "platform.sqlite");
  closeDb();
  const start = "2026-01-01T00:00:00.000Z";
  enqueueJob({ id: "boom", kind: "boom", payload: { n: 1 }, maxAttempts: 3, now: start });
  let calls = 0;
  await tickJobs(
    {
      boom() {
        calls += 1;
        throw new Error("job exploded");
      },
    },
    { now: start, backoffMs: 1000 },
  );
  assert.equal(calls, 1);
  const first = readJob("boom");
  assert.equal(first?.status, "queued");
  assert.equal(first?.attempts, 1);
  assert.ok((first?.runAfter ?? "") > start);
  await tickJobs({ boom() { calls += 1; throw new Error("job exploded"); } }, { now: "2026-01-01T00:00:00.500Z", backoffMs: 1000 });
  assert.equal(calls, 1);
  await tickJobs({ boom() { calls += 1; throw new Error("job exploded"); } }, { now: first?.runAfter, backoffMs: 1000 });
  assert.equal(calls, 2);
  const second = readJob("boom");
  assert.equal(second?.status, "queued");
  await tickJobs({ boom() { calls += 1; throw new Error("job exploded"); } }, { now: second?.runAfter, backoffMs: 1000 });
  assert.equal(readJob("boom")?.status, "failed");
  enqueueJob({ id: "ok", kind: "ok", payload: null, maxAttempts: 1, now: "2026-01-02T00:00:00.000Z" });
  await tickJobs({ ok() { calls += 1; } }, { now: "2026-01-02T00:00:00.000Z" });
  assert.equal(readJob("ok")?.status, "done");
  assert.equal(calls, 4);
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

function order(entityId: string, day: string): OrderRow {
  return {
    order_id: `${entityId}-${day}`,
    entity_id: entityId,
    purchased_at: `${day}T00:00:00Z`,
    sku: "spf",
    product_name: "spf",
    revenue: 10,
    status: "paid",
    is_subscription_renewal: false,
    orphan: false,
    countsAsOrder: true,
  };
}
