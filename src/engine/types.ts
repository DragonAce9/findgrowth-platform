export type PurchaseStatus = "paid" | "cancelled" | "refunded";

export interface RawEvent {
  event_name: string;
  timestamp: string;
  session_id: string;
  [key: string]: unknown;
}

export interface RawOrder {
  order_id: string;
  customer_id?: string;
  email?: string;
  created_at: string;
  sku: string;
  product_name: string;
  quantity: number;
  revenue: number;
  status: PurchaseStatus;
  is_subscription_renewal: boolean;
  currency?: string;
  counts_as_order?: boolean;
}

export interface RawNps {
  user_id?: string;
  email?: string;
  email_hash?: string;
  stable_id?: string;
  score: number;
  date: string;
  source: "email" | "onsite" | "unsolicited";
  requested?: boolean;
}

export interface RunConfig {
  asOf: string;
  windowDays: number;
  brandId: string;
  tenantId: string;
  projectName?: string;
  stableIdColumn: string;
  category: string;
  replenishmentLow: number;
  replenishmentHigh: number;
  skuRoles: Record<string, string>;
  currency?: string;
  sampleEvery?: number;
  stageLabels?: Record<string, string>;
  dataOrigin?: "operator" | "public_research";
  advertisingConsent?: boolean;
  customerNotice?: boolean;
  formulation?: string;
  constraint?: string;
  positioning?: string;
  marketingSpend?: number;
  grossMargin?: number;
  opex?: number;
  taxRate?: number;
  cash?: number;
  /** Recorded notice that people may be profiled. Without it, scoring stays in shadow. */
  profilingNotice?: boolean;
  /** Project may contribute aggregate rows to a cross-brand training set. Default off. */
  poolingConsent?: boolean;
  methodologyVersion?: string;
  configHash?: string;
  qualityNote?: string;
}

export interface EntityRow {
  entity_id: string;
  first_seen_at: string;
  last_seen_at: string;
  first_touch_channel: string;
  device: string;
  user_type: string;
  converted: boolean;
  first_purchase_at: string | null;
  second_purchase_at: string | null;
  last_purchase_at: string | null;
  ltv: number;
  n_orders: number;
  first_sku: string | null;
  saw_pdp: boolean;
  scrolled: boolean;
  clicked_cta: boolean;
  checkout: boolean;
  purchased: boolean;
  attribution_after_purchase: boolean;
  funnel_depth: number;
  age_days: number | null;
}

export interface OrderRow {
  order_id: string;
  entity_id: string | null;
  purchased_at: string;
  sku: string;
  product_name: string;
  revenue: number;
  status: PurchaseStatus;
  is_subscription_renewal: boolean;
  orphan: boolean;
  countsAsOrder: boolean;
  /** HMAC of the email. Plaintext email is not stored on the workspace order. */
  email_hash?: string;
  /** Heuristic guess. Does not exclude the order from repeat, LTV, RFM, or pairs. */
  inferred_renewal?: boolean;
  quantity?: number;
}

export interface ExposureRow {
  experiment_id: string;
  variant: string;
  entity_id: string;
  exposed_at: string;
  device_type: string;
  channel_group: string;
  user_type: string;
  in_holdout: boolean;
  reached_checkout_after: boolean;
}

export interface MetricTable {
  name: string;
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
}

export type SnapshotBucket = "top" | "middle" | "bottom";
export type SnapshotArm = "treatment" | "control";

export interface SnapshotLine {
  entity_id: string;
  sku: string;
  rank: number;
  model_version: string;
  as_of: string;
  role: string;
  score: number;
  bucket: SnapshotBucket | null;
  arm: SnapshotArm | null;
  methodology_version: string;
  config_hash: string;
}

/** Old snapshots omit the v2 fields. Missing methodology is "1.0". */
export function normalizeSnapshotLine(line: Partial<SnapshotLine> & Pick<SnapshotLine, "entity_id" | "sku">): SnapshotLine {
  return {
    entity_id: line.entity_id,
    sku: line.sku,
    rank: line.rank ?? 0,
    model_version: line.model_version || "1.0",
    as_of: line.as_of ?? "",
    role: line.role ?? "unknown",
    score: typeof line.score === "number" ? line.score : 0,
    bucket: line.bucket ?? null,
    arm: line.arm ?? null,
    methodology_version: line.methodology_version || "1.0",
    config_hash: line.config_hash ?? "",
  };
}

export interface Recommendation {
  entity_id: string;
  sku: string;
  score: number;
  reason: "cf" | "category_popular" | "hero";
  fallback_used: boolean;
}

export interface PriorStore {
  brands: Record<string, { pairs: Record<string, number> }>;
}

export interface RunState {
  id: string;
  config: RunConfig;
  entities: EntityRow[];
  orders: OrderRow[];
  exposures: ExposureRow[];
  metrics: MetricTable[];
  sql: Record<string, string>;
  identityCoverage: number;
  orphanRevenue: number;
  lowJoin: boolean;
  lowIdentityInput: boolean;
  hitRate: number | null;
  hitRatePopular: number | null;
  modelReady: boolean;
  recommendations: Recommendation[];
  fallbackRate: number | null;
  snapshot: SnapshotLine[] | null;
}
