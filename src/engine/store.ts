import { hashRunConfig, METHODOLOGY_VERSION } from "./methodology";
import { buildWorkspace, playgroundRecommend, queryDiagnostic, writeReportSnapshot, type Workspace } from "./pipeline";
import { recognizeRaw, type Recognition } from "./recognize";
import { emptyPrior } from "./recs";
import { buildReport, type FrenchReport } from "./report";
import type { PriorStore, RawEvent, RawNps, RawOrder, Recommendation, RunConfig, SnapshotLine } from "./types";

export interface StoredRun {
  id: string;
  projectId: string;
  config: RunConfig;
  workspace: Workspace;
  report: FrenchReport | null;
  prior: PriorStore;
  snapshot: SnapshotLine[] | null;
  recognition?: Recognition;
}

const globalStore = globalThis as typeof globalThis & {
  __findgrowth?: {
    runs: Map<string, StoredRun>;
    priors: Record<string, PriorStore>;
    snapshots: Record<string, SnapshotLine[]>;
    seq: number;
    budget: number;
    bytes: Map<string, number>;
  };
};

const DEFAULT_BUDGET = 32 * 1024 * 1024;

const memory = (globalStore.__findgrowth ??= {
  runs: new Map<string, StoredRun>(),
  priors: {},
  snapshots: {},
  seq: 1,
  budget: DEFAULT_BUDGET,
  bytes: new Map<string, number>(),
});
memory.priors ??= {};
memory.snapshots ??= {};
memory.bytes ??= new Map();
memory.budget ??= DEFAULT_BUDGET;

export function resetStore(): void {
  memory.runs.clear();
  memory.bytes.clear();
  memory.priors = {};
  memory.snapshots = {};
  memory.seq = 1;
}

export function setRunCacheBudget(bytes: number): void {
  memory.budget = bytes;
  evict();
}

export function cachedRunCount(): number {
  return memory.runs.size;
}

export function forgetProjects(projectIds: string[]): void {
  const drop = new Set(projectIds);
  for (const [id, run] of memory.runs) {
    if (!drop.has(run.projectId)) continue;
    memory.runs.delete(id);
    memory.bytes.delete(id);
    delete memory.snapshots[run.projectId];
    delete memory.priors[run.projectId];
  }
}

function priorOf(projectId: string): PriorStore {
  return (memory.priors[projectId] ??= emptyPrior());
}

export function startRun(input: {
  id?: string;
  projectId?: string;
  events: RawEvent[];
  orders: RawOrder[];
  nps?: RawNps[];
  config: RunConfig;
  previousSnapshot?: SnapshotLine[] | null;
  previousOrders?: import("./types").OrderRow[];
}): StoredRun {
  const projectId = input.projectId ?? `local:${input.config.brandId}`;
  const config = {
    ...input.config,
    methodologyVersion: input.config.methodologyVersion || METHODOLOGY_VERSION,
  };
  config.configHash = hashRunConfig(config);
  const previous = input.previousSnapshot === undefined ? memory.snapshots[projectId] : (input.previousSnapshot ?? undefined);
  const prior = priorOf(projectId);
  const workspace = buildWorkspace({
    events: input.events,
    orders: input.orders,
    nps: input.nps,
    config,
    prior,
    previousSnapshot: previous,
    previousOrders: input.previousOrders,
  });
  const id = input.id ?? `run-${memory.seq++}`;
  const stored: StoredRun = {
    id,
    projectId,
    config,
    workspace,
    report: null,
    prior,
    snapshot: null,
    recognition: recognizeRaw({
      events: input.events,
      orders: input.orders,
      nps: input.nps,
      stableIdColumn: input.config.stableIdColumn,
      declaredCurrency: input.config.currency,
    }),
  };
  memory.runs.delete(id);
  memory.runs.set(id, stored);
  memory.bytes.set(id, runBytes(stored));
  evict();
  return stored;
}

export function diagnosticFor(runId: string): StoredRun {
  const stored = must(runId);
  if (stored.report && typeof stored.report.cycleHigh === "number") return stored;
  const prior = priorOf(stored.projectId);
  const pockets = queryDiagnostic(stored.workspace, stored.config);
  const written = writeReportSnapshot({
    workspace: stored.workspace,
    config: stored.config,
    pockets,
    prior,
  });
  stored.snapshot = written.snapshot;
  stored.prior = prior;
  memory.snapshots[stored.projectId] = written.snapshot;
  stored.report = buildReport({
    workspace: stored.workspace,
    config: stored.config,
    pockets,
    recommendations: written.recommendations,
    fallbackRate: written.fallback,
  });
  return stored;
}

export function setBrandLimits(
  runId: string,
  limits: { formulation: string; constraint: string; positioning: string },
): void {
  const stored = must(runId);
  const clip = (value: string) => value.trim().slice(0, 240);
  stored.config = {
    ...stored.config,
    formulation: clip(limits.formulation),
    constraint: clip(limits.constraint),
    positioning: clip(limits.positioning),
  };
}

export function setUnitAssumptions(
  runId: string,
  input: {
    marketingSpend?: number;
    grossMargin?: number;
    opex?: number;
    taxRate?: number;
    cash?: number;
  },
): void {
  const stored = must(runId);
  stored.config = {
    ...stored.config,
    marketingSpend: input.marketingSpend,
    grossMargin: input.grossMargin,
    opex: input.opex,
    taxRate: input.taxRate,
    cash: input.cash,
  };
}

export function playground(runId: string, entityId: string): Recommendation {
  const stored = must(runId);
  return playgroundRecommend(stored.workspace, entityId, priorOf(stored.projectId));
}

export function getRun(runId: string): StoredRun | undefined {
  const run = memory.runs.get(runId);
  if (!run || run.config.brandId === "lumiere-skin") return undefined;
  touch(runId);
  return run;
}

export function projectRuns(projectId: string): StoredRun[] {
  return [...memory.runs.values()].filter((run) => run.projectId === projectId);
}

export function brandRuns(brandId: string): StoredRun[] {
  return [...memory.runs.values()].filter((run) => run.config.brandId === brandId);
}

export function latestRun(): StoredRun | undefined {
  return [...memory.runs.values()].reverse().find((run) => run.config.brandId !== "lumiere-skin");
}

export function latestProjectRun(projectId: string): StoredRun | undefined {
  return [...memory.runs.values()].reverse().find((run) => run.projectId === projectId);
}

function must(runId: string): StoredRun {
  const stored = memory.runs.get(runId);
  if (!stored) throw new Error(`Run ${runId} introuvable`);
  touch(runId);
  return stored;
}

function touch(id: string): void {
  const run = memory.runs.get(id);
  if (!run) return;
  memory.runs.delete(id);
  memory.runs.set(id, run);
}

function runBytes(run: StoredRun): number {
  return 2048 + run.workspace.entities.length * 480 + run.workspace.orders.length * 240 + (run.workspace.features?.length ?? 0) * 160;
}

export function rememberRun(stored: StoredRun): void {
  memory.runs.delete(stored.id);
  memory.runs.set(stored.id, stored);
  memory.bytes.set(stored.id, runBytes(stored));
  evict();
}

function evict(): void {
  let used = 0;
  for (const size of memory.bytes.values()) used += size;
  while (used > memory.budget && memory.runs.size > 1) {
    const oldest = memory.runs.keys().next().value;
    if (!oldest) break;
    used -= memory.bytes.get(oldest) ?? 0;
    memory.runs.delete(oldest);
    memory.bytes.delete(oldest);
  }
}
