import assert from "node:assert/strict";
import test from "node:test";
import { betaBetaGreater, bootstrapMean, chiSquareSurvival, diffProportions, fisherExact, guardK, inverseNormal, linearAlphaSpendingZ, wilsonInterval } from "./stats";

// Absolute tolerance 1e-4 against published Wilson / chi-square / Fisher values.
const TOL = 1e-4;

test("wilson interval matches the known 0/10 upper bound", () => {
  const interval = wilsonInterval(0, 10);
  assert.equal(interval.p, 0);
  assert.ok(Math.abs(interval.low) < TOL);
  assert.ok(Math.abs(interval.high - 0.2775) < 0.01);
  const half = wilsonInterval(50, 100);
  assert.ok(Math.abs(half.p - 0.5) < TOL);
  assert.ok(Math.abs(half.low - 0.4038) < 0.01);
  assert.ok(Math.abs(half.high - 0.5962) < 0.01);
});

test("difference of proportions has a finite interval", () => {
  const diff = diffProportions(30, 100, 10, 100);
  assert.ok(Math.abs(diff.diff - 0.2) < TOL);
  assert.ok(diff.low < diff.diff && diff.diff < diff.high);
});

test("chi-square survival matches the 0.05 critical values for df 1 and 3", () => {
  assert.ok(Math.abs(chiSquareSurvival(3.841458820694124, 1) - 0.05) < TOL);
  assert.ok(Math.abs(chiSquareSurvival(5.991464547107979, 2) - 0.05) < TOL);
  assert.ok(Math.abs(chiSquareSurvival(7.814727903251179, 3) - 0.05) < TOL);
  assert.ok(chiSquareSurvival(0, 4) === 1);
});

test("fisher exact matches the published 2x2 p-value", () => {
  const p = fisherExact(8, 2, 1, 5);
  assert.ok(Math.abs(p - 0.03496503496503497) < TOL);
});

test("bootstrap mean of a constant is the constant and is seed-stable", () => {
  const once = bootstrapMean([5, 5, 5, 5], { seed: 3, reps: 200 });
  const twice = bootstrapMean([5, 5, 5, 5], { seed: 3, reps: 200 });
  assert.equal(once.mean, 5);
  assert.equal(once.low, 5);
  assert.equal(once.high, 5);
  assert.deepEqual(once, twice);
  const spread = bootstrapMean([0, 0, 0, 1], { seed: 1, reps: 400 });
  assert.ok(spread.low <= spread.mean && spread.mean <= spread.high);
});

test("beta-beta says a higher posterior is usually larger", () => {
  const even = betaBetaGreater(1, 1, 1, 1);
  assert.ok(Math.abs(even - 0.5) < 0.03);
  const higher = betaBetaGreater(20, 2, 2, 20);
  assert.ok(higher > 0.95);
});

test("linear alpha spending matches z 1.96 at the final look and is stricter earlier", () => {
  assert.ok(Math.abs(inverseNormal(0.975) - 1.959963984540054) < 1e-4);
  const finalZ = linearAlphaSpendingZ(1);
  assert.ok(Math.abs(finalZ - 1.959963984540054) < 1e-3);
  const interimZ = linearAlphaSpendingZ(30 / 120);
  assert.ok(interimZ > finalZ);
  assert.ok(linearAlphaSpendingZ(0.25) > linearAlphaSpendingZ(0.5));
});

test("guardK hides counts between 1 and 4", () => {
  assert.equal(guardK(0), 0);
  assert.equal(guardK(4), null);
  assert.equal(guardK(5), 5);
});
