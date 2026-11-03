import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { hashRunConfig, METHODOLOGY_VERSION } from "./methodology";
import { tickJobs } from "./job-queue";
import { enqueueJob, replaceBrandKeys, saveCut, updateCutJob } from "./platform-db";
import { buildWorkspace, type Workspace, type WorkspaceInput } from "./pipeline";
import { recognizeRaw } from "./recognize";
import { rememberRun } from "./store";
import type { RawEvent, RawNps, RawOrder, RunConfig } from "./types";

/**
 * Cut build seam.
 * scheduleCutBuild returns immediately. The HTTP action must not await it.
 * The work runs in worker_threads when the TypeScript loader is available (tsx, tests).
 * Next's server has no TS loader for worker_threads, so the same function falls back to
 * buildWorkspace on a later turn of the event loop. Sync startRun stays for tests and for
 * hydrating a cut that is already done. Redis / a separate process is E6 and is not started here.
 * The action returns after queueing. v2.test.ts times that queue/return path against 300 ms.
 * buildWorkspace runs on a later turn and is outside that timer.
 * The durable state is a row in the SQLite jobs table. Redis is not contacted unless FG_REDIS_URL is set.
 */
export interface CutBuildRequest {
  cutId: string;
  projectId: string;
  events: RawEvent[];
  orders: RawOrder[];
  nps: RawNps[];
  config: RunConfig;
  previousOrders?: WorkspaceInput["previousOrders"];
  previousSnapshot?: WorkspaceInput["previousSnapshot"];
}

const pendingBuilds = new Map<string, CutBuildRequest>();

export function scheduleCutBuild(request: CutBuildRequest): void {
  updateCutJob(request.cutId, "queued");
  pendingBuilds.set(request.cutId, request);
  const jobId = `build:${request.cutId}`;
  enqueueJob({ id: jobId, kind: "cut-build", payload: { cutId: request.cutId }, maxAttempts: 2 });
  if (process.env.FG_REDIS_URL) {
    void import("./job-redis").then((mod) => mod.mirrorJob(jobId)).catch(() => undefined);
  }
  setImmediate(() => {
    void tickJobs({ "cut-build": runQueuedCut });
  });
}

async function runQueuedCut(payload: unknown): Promise<void> {
  const cutId = String((payload as { cutId?: string } | null)?.cutId ?? "");
  const request = pendingBuilds.get(cutId);
  if (!request) throw new Error(`build ${cutId} is not queued in this process`);
  await runCutBuild(request);
  pendingBuilds.delete(cutId);
}

export async function runCutBuild(request: CutBuildRequest): Promise<void> {
  updateCutJob(request.cutId, "running");
  try {
    const config = {
      ...request.config,
      methodologyVersion: request.config.methodologyVersion || METHODOLOGY_VERSION,
    };
    config.configHash = hashRunConfig(config);
    const input: WorkspaceInput = {
      events: request.events,
      orders: request.orders,
      nps: request.nps,
      config,
      previousOrders: request.previousOrders,
      previousSnapshot: request.previousSnapshot ?? undefined,
    };
    const workspace = await buildWorkspaceOffThread(input);
    replaceBrandKeys(request.projectId, workspace.brandKeys);
    const recognition = recognizeRaw({
      events: request.events,
      orders: request.orders,
      nps: request.nps,
      stableIdColumn: config.stableIdColumn,
      declaredCurrency: config.currency,
    });
    rememberRun({
      id: request.cutId,
      projectId: request.projectId,
      config,
      workspace,
      report: null,
      prior: { brands: {} },
      snapshot: null,
      recognition,
    });
    saveCut({
      id: request.cutId,
      projectId: request.projectId,
      asOf: config.asOf,
      config,
      events: request.events,
      orders: request.orders,
      nps: request.nps,
      snapshot: null,
      recognition,
      features: workspace.features,
      jobStatus: "done",
      jobError: null,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    updateCutJob(request.cutId, "failed", error instanceof Error ? error.message : String(error));
  }
}

export function buildWorkspaceOffThread(input: WorkspaceInput): Promise<Workspace> {
  return new Promise<Workspace>((resolve, reject) => {
    let settled = false;
    const finish = (workspace: Workspace) => {
      if (settled) return;
      settled = true;
      resolve(workspace);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    try {
      const worker = new Worker(pathToFileURL(join(process.cwd(), "src/engine/build-worker.ts")), {
        execArgv: process.execArgv,
      });
      const timer = setTimeout(() => {
        void worker.terminate();
        fail(new Error("worker timeout"));
      }, 20_000);
      worker.on("message", (message: { ok: boolean; workspace?: Workspace; error?: string }) => {
        clearTimeout(timer);
        void worker.terminate();
        if (message.ok && message.workspace) finish(reviveWorkspace(message.workspace));
        else fail(new Error(message.error || "worker failed"));
      });
      worker.on("error", (error) => {
        clearTimeout(timer);
        fail(error);
      });
      worker.postMessage(input);
    } catch (error) {
      fail(error);
    }
  }).catch(() => buildWorkspace(input));
}

function reviveWorkspace(workspace: Workspace): Workspace {
  const scores = workspace.model?.scores;
  if (scores && !(scores instanceof Map)) {
    const revived = new Map<string, Map<string, number>>();
    for (const [sku, row] of Object.entries(scores as unknown as Record<string, Record<string, number>>)) {
      revived.set(sku, new Map(Object.entries(row)));
    }
    workspace.model.scores = revived;
  }
  return workspace;
}
