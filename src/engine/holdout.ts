import { createHash } from "node:crypto";
import { armSalt } from "./hash";
import { betaBetaGreater, diffProportions, linearAlphaSpendingZ, linearSpentAlpha, wilsonInterval } from "./stats";
import type { OrderRow, SnapshotLine } from "./types";

export type Arm = "treatment" | "control";
export type ScoreBucket = "top" | "middle" | "bottom";

export function assignArms(lines: SnapshotLine[], snapshotId: string, salt = armSalt()): SnapshotLine[] {
  const groups = new Map<string, SnapshotLine[]>();
  for (const line of lines) {
    const key = line.bucket ?? "none";
    const list = groups.get(key) ?? [];
    list.push(line);
    groups.set(key, list);
  }
  for (const group of groups.values()) {
    const ranked = [...group].sort((a, b) => armHash(a.entity_id, snapshotId, salt).localeCompare(armHash(b.entity_id, snapshotId, salt)));
    const cut = Math.floor(ranked.length / 2);
    ranked.forEach((line, index) => {
      line.arm = index < cut ? "treatment" : "control";
    });
  }
  return lines;
}

export function bucketByScore(lines: Array<SnapshotLine & { score: number }>): void {
  const ranked = [...lines].sort((a, b) => b.score - a.score || a.entity_id.localeCompare(b.entity_id));
  const n = ranked.length;
  ranked.forEach((line, index) => {
    const pct = n <= 1 ? 0 : index / n;
    line.bucket = pct < 0.2 ? "top" : pct >= 0.8 ? "bottom" : "middle";
  });
}

export interface MeasuredLift {
  treatmentN: number;
  controlN: number;
  treatmentHits: number;
  controlHits: number;
  treatmentRepeat: number;
  controlRepeat: number;
  diff: number;
  low: number;
  high: number;
  probTreatmentGreater: number;
  frozenRevenue: number;
  ready: boolean;
  /** True when the look is at least 30 days after the snapshot and the full window is still open. */
  interim: boolean;
  /** Elapsed days / windowDays, capped at 1. The final look is 1. */
  information: number;
  /** α(t) = 0.05 · information. The Wilson interval uses the matching critical z. */
  spentAlpha: number;
  z: number;
}

/**
 * Observed repeat after the snapshot, split by arm.
 * Returns null until day 30, or when arms were not assigned.
 * A look from day 30 before windowDays is interim: the interval uses linear alpha spending.
 * The screen must show this measured difference, never a predicted lift.
 */
export function measureLift(input: {
  snapshot: SnapshotLine[];
  orders: OrderRow[];
  windowDays: number;
  asOf: string;
}): MeasuredLift | null {
  const armed = input.snapshot.filter((line) => line.arm === "treatment" || line.arm === "control");
  if (!armed.length) return null;
  const start = Date.parse(armed[0].as_of);
  const asOf = Date.parse(input.asOf);
  if (!Number.isFinite(start) || !Number.isFinite(asOf) || asOf < start) return emptyLift(false);
  const elapsedDays = (asOf - start) / 86_400_000;
  const full = elapsedDays + 1e-9 >= input.windowDays;
  // Planned interim look is day 30. Earlier than that, the result stays unread.
  // Any look from day 30 until the window closes is interim and spends only α · t.
  const interimLook = !full && elapsedDays + 1e-9 >= 30 && input.windowDays > 30;
  if (!full && !interimLook) return emptyLift(false);
  const information = full ? 1 : Math.min(elapsedDays / input.windowDays, 0.999);
  const z = linearAlphaSpendingZ(information);
  const end = full ? start + input.windowDays * 86_400_000 : asOf;
  const buyers = new Set<string>();
  let revenue = 0;
  let paid = 0;
  for (const order of input.orders) {
    if (!order.entity_id || order.status !== "paid" || order.is_subscription_renewal || !order.countsAsOrder) continue;
    const ts = Date.parse(order.purchased_at);
    if (ts <= start || ts > end) continue;
    buyers.add(order.entity_id);
    revenue += order.revenue;
    paid += 1;
  }
  const treatment = uniqueArm(armed, "treatment");
  const control = uniqueArm(armed, "control");
  const treatmentHits = treatment.filter((id) => buyers.has(id)).length;
  const controlHits = control.filter((id) => buyers.has(id)).length;
  const diff = diffProportions(treatmentHits, treatment.length, controlHits, control.length, z);
  const treatmentRepeat = treatment.length ? treatmentHits / treatment.length : 0;
  const controlRepeat = control.length ? controlHits / control.length : 0;
  const aov = paid ? revenue / paid : 0;
  const observedRepeat = wilsonInterval(controlHits, control.length).p;
  return {
    treatmentN: treatment.length,
    controlN: control.length,
    treatmentHits,
    controlHits,
    treatmentRepeat,
    controlRepeat,
    diff: diff.diff,
    low: diff.low,
    high: diff.high,
    probTreatmentGreater: betaBetaGreater(1 + treatmentHits, 1 + Math.max(treatment.length - treatmentHits, 0), 1 + controlHits, 1 + Math.max(control.length - controlHits, 0)),
    frozenRevenue: control.length * observedRepeat * aov,
    ready: true,
    interim: interimLook,
    information,
    spentAlpha: linearSpentAlpha(information),
    z,
  };
}

function uniqueArm(lines: SnapshotLine[], arm: Arm): string[] {
  return [...new Set(lines.filter((line) => line.arm === arm).map((line) => line.entity_id))];
}

function emptyLift(ready: boolean): MeasuredLift {
  return {
    treatmentN: 0,
    controlN: 0,
    treatmentHits: 0,
    controlHits: 0,
    treatmentRepeat: 0,
    controlRepeat: 0,
    diff: 0,
    low: 0,
    high: 0,
    probTreatmentGreater: 0.5,
    frozenRevenue: 0,
    ready,
    interim: false,
    information: 0,
    spentAlpha: 0,
    z: linearAlphaSpendingZ(1),
  };
}

function armHash(entityId: string, snapshotId: string, salt: string): string {
  return createHash("sha256").update(`${entityId}|${snapshotId}|${salt}`).digest("hex");
}

export type HoldoutState = "confirmed" | "unchecked" | "violated";
export type HoldoutDeviation = "random" | "selective";

export const CONTAMINATION_LIMIT = 0.2;
export const CONFIRM_COLUMN = "received_email";

export interface HoldoutRecord {
  status: HoldoutState;
  contamination: number | null;
  compliance: number | null;
  deviation: HoldoutDeviation | null;
  /** ITT / c. Never replaces the ITT difference. */
  onReceived: number | null;
}

export function emptyHoldout(): HoldoutRecord {
  return { status: "unchecked", contamination: null, compliance: null, deviation: null, onReceived: null };
}

/** No send data stays unchecked. Selective deviation or pc > 20% is violated. */
export function classifyHoldout(input: {
  sendsKnown: boolean;
  contamination: number | null;
  deviation: HoldoutDeviation | null;
}): HoldoutState {
  if (!input.sendsKnown) return "unchecked";
  if (input.deviation === "selective") return "violated";
  if (input.contamination !== null && input.contamination > CONTAMINATION_LIMIT) return "violated";
  if (input.deviation !== "random") return "unchecked";
  return "confirmed";
}

/** ITT stays the assignment difference. c scales a second number and does not replace it. */
export function ittWithCompliance(itt: number, compliance: number | null): { itt: number; onReceived: number | null } {
  if (compliance === null || !(compliance > 0)) return { itt, onReceived: null };
  return { itt, onReceived: itt / compliance };
}

export interface ArmCompliance {
  treatment: number;
  control: number;
  compliance: number;
  contamination: number;
  status: HoldoutState;
}

/** One column of the next slice: received_email by brand key. Not a connector. */
export function parseReceivedColumn(input: {
  rows: Array<Record<string, string>>;
  arms: Array<{ brandKey: string; arm: "treatment" | "control" }>;
  deviation: HoldoutDeviation | null;
  column?: string;
}): ArmCompliance {
  const column = input.column ?? CONFIRM_COLUMN;
  const received = new Map<string, boolean>();
  for (const row of input.rows) {
    const key = String(row.customer_id ?? row.order_id ?? row.brand_key ?? "").trim();
    if (!key || !(column in row)) continue;
    received.set(key, truthy(row[column]));
  }
  const rate = (arm: "treatment" | "control") => {
    const group = input.arms.filter((line) => line.arm === arm);
    if (!group.length) return 0;
    const hits = group.filter((line) => received.get(line.brandKey) === true).length;
    return hits / group.length;
  };
  const treatment = rate("treatment");
  const control = rate("control");
  const known = input.rows.some((row) => column in row);
  return {
    treatment,
    control,
    compliance: treatment,
    contamination: control,
    status: classifyHoldout({ sendsKnown: known, contamination: control, deviation: input.deviation }),
  };
}

export function holdoutFromConfirmation(itt: number, parsed: ArmCompliance, deviation: HoldoutDeviation | null): HoldoutRecord {
  const scaled = ittWithCompliance(itt, parsed.status === "unchecked" ? null : parsed.compliance);
  return {
    status: parsed.status,
    contamination: parsed.status === "unchecked" ? null : parsed.contamination,
    compliance: parsed.status === "unchecked" ? null : parsed.compliance,
    deviation,
    onReceived: parsed.status === "confirmed" ? scaled.onReceived : null,
  };
}

export function liftParagraph(input: {
  status: HoldoutState;
  interim: boolean;
  diffText: string;
  onReceivedText: string | null;
  probText: string;
}): { state: 1 | 2 | 3; title: string; body: string; showNumbers: boolean } {
  if (input.status === "violated") {
    return {
      state: 3,
      title: "Холдаут нарушен",
      body: "Группы разошлись. Лифт здесь не называем. Снимите новый снимок и назначьте группы заново.",
      showNumbers: false,
    };
  }
  if (input.status === "confirmed") {
    const second = input.onReceivedText ? ` Второе число, оценка на получивших: ${input.onReceivedText}.` : "";
    return {
      state: 1,
      title: input.interim ? "Измеренный эффект · промежуточный" : "Измеренный эффект",
      body: `Разница повтора ${stop(input.diffText)}${second} Вероятность, что письмо дало повтор чаще: ${input.probText}. Это вероятность, не доля людей.`,
      showNumbers: true,
    };
  }
  return {
    state: 2,
    title: input.interim ? "Наблюдаемая разница между группами · промежуточный" : "Наблюдаемая разница между группами",
    body: `Разница повтора ${stop(input.diffText)} Вероятность, что письмо дало повтор чаще: ${input.probText}. Это вероятность, не доля людей.`,
    showNumbers: true,
  };
}

function stop(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

function truthy(value: string | undefined): boolean {
  const text = (value ?? "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "да";
}
