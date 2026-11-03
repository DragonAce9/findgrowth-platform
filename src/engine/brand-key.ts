import { assignArms } from "./holdout";
import type { SnapshotLine } from "./types";

export type BrandKeyKind = "customer_id" | "order_id";

export interface BrandKeyLink {
  stableId: string;
  keyKind: BrandKeyKind;
  brandKey: string;
}

export interface BriefAudience {
  treatment: string[];
  control: string[];
  covered: boolean;
  note: string;
}

const FORBIDDEN_STABLE = new Set(["email", "customer_id", "phone", "name", "full_name", "user_email"]);

/** The brand key is the brand's own field. It is never an HMAC and never the visit id. */
export function assertBrandKeyLink(link: BrandKeyLink): void {
  const stable = link.stableId.trim();
  const key = link.brandKey.trim();
  if (!stable || FORBIDDEN_STABLE.has(stable.toLowerCase())) {
    throw new Error("email, customer_id, phone and name cannot be a stable_id.");
  }
  if (link.keyKind !== "customer_id" && link.keyKind !== "order_id") {
    throw new Error("Brand key kind must be customer_id or order_id.");
  }
  if (!key || key === stable) {
    throw new Error("Brand key is stored beside stable_id, not in its place.");
  }
  if (key.includes("@") || /hmac1:/i.test(key) || /^user:/i.test(key)) {
    throw new Error("Brand key cannot be an email or an HMAC.");
  }
}

export function collectBrandKeys(
  rows: Array<{ entityId: string | null; customerId?: string; orderId: string }>,
): BrandKeyLink[] {
  const byStable = new Map<string, BrandKeyLink>();
  for (const row of rows) {
    if (!row.entityId) continue;
    const customer = cleanKey(row.customerId);
    const orderId = cleanKey(row.orderId);
    const next: BrandKeyLink | null = customer
      ? { stableId: row.entityId, keyKind: "customer_id", brandKey: customer }
      : orderId
        ? { stableId: row.entityId, keyKind: "order_id", brandKey: orderId }
        : null;
    if (!next) continue;
    assertBrandKeyLink(next);
    const current = byStable.get(row.entityId);
    if (!current || (current.keyKind === "order_id" && next.keyKind === "customer_id")) byStable.set(row.entityId, next);
  }
  return [...byStable.values()].sort((a, b) => a.stableId.localeCompare(b.stableId));
}

/**
 * Two lists by the brand's own key. HMAC user:hmac1:… never appears.
 * No key for an armed person → the brief stays "what and how", without "whom".
 */
export function briefAudience(
  keys: BrandKeyLink[],
  snapshot: Array<Pick<SnapshotLine, "entity_id" | "arm">> | null,
): BriefAudience {
  const byEntity = new Map(keys.map((link) => [link.stableId, link.brandKey]));
  const armed = (snapshot ?? []).filter((line) => line.arm === "treatment" || line.arm === "control");
  if (!keys.length || (armed.length && armed.some((line) => !byEntity.has(line.entity_id)))) {
    return {
      treatment: [],
      control: [],
      covered: false,
      note: "Кому недоступно: в файле нет ключа бренда (customer_id или номер заказа). Ниже только что сделать и как подтвердить. Адреса не выгружаются.",
    };
  }
  const treatment: string[] = [];
  const control: string[] = [];
  if (armed.length) {
    for (const line of armed) {
      const key = byEntity.get(line.entity_id);
      if (!key) continue;
      if (line.arm === "treatment") treatment.push(key);
      else control.push(key);
    }
  } else {
    return {
      treatment: [],
      control: [],
      covered: false,
      note: "Кому недоступно: группы письма ещё не назначены. Ниже только что сделать и как подтвердить. Адреса не выгружаются.",
    };
  }
  return {
    treatment: uniqueSorted(treatment),
    control: uniqueSorted(control),
    covered: treatment.length + control.length > 0,
    note: "Списки по ключу бренда. Адреса, телефоны и имена не выгружаются.",
  };
}

/** Use snapshot arms when they exist. Otherwise assign 50/50 on the brand-key rows. */
export function audienceForBrief(keys: BrandKeyLink[], snapshot: SnapshotLine[] | null, snapshotId: string): BriefAudience {
  const armed = (snapshot ?? []).filter((line) => line.arm === "treatment" || line.arm === "control");
  if (armed.length) return briefAudience(keys, armed);
  const lines: SnapshotLine[] = keys.map((link) => ({
    entity_id: link.stableId,
    sku: "",
    rank: 0,
    model_version: "1.0",
    as_of: "",
    role: "unknown",
    score: 0,
    bucket: "middle",
    arm: null,
    methodology_version: "1.0",
    config_hash: "",
  }));
  assignArms(lines, snapshotId);
  return briefAudience(keys, lines);
}

function cleanKey(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.includes("@") || /hmac1:/i.test(trimmed) || /^user:/i.test(trimmed)) return "";
  if (FORBIDDEN_STABLE.has(trimmed.toLowerCase())) return "";
  return trimmed;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
