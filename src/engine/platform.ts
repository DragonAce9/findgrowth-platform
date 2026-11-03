import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fullDemoDataset, fullDemoFollowUp, FULL_DEMO_CONFIG } from "./full-demo";
import { hashPassword, newToken, verifyPassword } from "./passwords";
import {
  deleteSession,
  deleteUser,
  findProject,
  findProjectByBrand,
  findSession,
  findUserByEmail,
  findUserById,
  insertProject,
  insertSession,
  insertUser,
  latestCutMeta,
  listCutMeta,
  listProjects,
  loadCut,
  newId,
  nowIso,
  saveCut,
  updateCutConfig,
  updateCutSnapshot,
  cutJob,
  type JobStatus,
  type ProjectRow,
  type UserRow,
} from "./platform-db";
import { scheduleCutBuild } from "./jobs";
import { forgetProjects, diagnosticFor, getRun, projectRuns, startRun, type StoredRun } from "./store";
import type { OrderRow, RawEvent, RawNps, RawOrder, RunConfig, SnapshotLine } from "./types";
import { parseOrdersCsv } from "./validate";

const SESSION_DAYS = 30;

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function registerUser(emailRaw: string, password: string): Promise<{ user: UserRow; token: string; project: ProjectRow }> {
  const email = normalizeEmail(emailRaw);
  if (!validEmail(email)) throw new AuthError("bad");
  if (password.length < 8) throw new AuthError("short");
  if (findUserByEmail(email)) throw new AuthError("taken");
  const user: UserRow = {
    id: newId("u"),
    email,
    passwordHash: await hashPassword(password),
    createdAt: nowIso(),
  };
  insertUser(user);
  const token = openSession(user.id);
  const project = seedAtelierProject(user.id);
  return { user, token, project };
}

export async function loginUser(emailRaw: string, password: string): Promise<{ user: UserRow; token: string }> {
  const email = normalizeEmail(emailRaw);
  const user = findUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) throw new AuthError("auth");
  return { user, token: openSession(user.id) };
}

export function openSession(userId: string): string {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  insertSession({ token, userId, expiresAt: expires });
  return token;
}

export function userFromSession(token: string | undefined): UserRow | undefined {
  if (!token) return undefined;
  const session = findSession(token);
  if (!session) return undefined;
  if (session.expiresAt < nowIso()) {
    deleteSession(token);
    return undefined;
  }
  return findUserById(session.userId);
}

export function logoutSession(token: string | undefined): void {
  if (token) deleteSession(token);
}

export function removeAccount(userId: string): void {
  const ids = listProjects(userId).map((project) => project.id);
  deleteUser(userId);
  forgetProjects(ids);
}

export function ownedProject(userId: string, projectId: string | undefined): ProjectRow | undefined {
  if (!projectId) return undefined;
  const project = findProject(projectId);
  if (!project || project.ownerUserId !== userId) return undefined;
  return project;
}

export function userProjects(userId: string): ProjectRow[] {
  return listProjects(userId);
}

export function createEmptyProject(userId: string, name: string): ProjectRow {
  const trimmed = name.trim().slice(0, 80) || "Новый проект";
  const project: ProjectRow = {
    id: newId("p"),
    ownerUserId: userId,
    name: trimmed,
    brandId: `p-${newId("b")}`,
    demo: false,
    createdAt: nowIso(),
  };
  insertProject(project);
  return project;
}

/** The first demo slice (1 September 2026), not whichever cut was added last. */
export function demoSliceId(projectId: string): string | undefined {
  const cuts = listCutMeta(projectId).filter((cut) => cut.asOf === FULL_DEMO_CONFIG.asOf);
  if (!cuts.length) return undefined;
  return cuts.reduce((earliest, cut) => (cut.createdAt < earliest.createdAt ? cut : earliest)).id;
}

export function seedAtelierProject(userId: string): ProjectRow {
  const existing = findProjectByBrand(userId, "demo-full");
  if (existing) {
    if (!latestCutMeta(existing.id) || !getRun(latestCutMeta(existing.id)!.id)) hydrateLatest(existing.id);
    return existing;
  }
  const project: ProjectRow = {
    id: newId("p"),
    ownerUserId: userId,
    name: "Atelier",
    brandId: "demo-full",
    demo: true,
    createdAt: nowIso(),
  };
  insertProject(project);
  const data = fullDemoDataset();
  persistNewCut(project, {
    events: data.events,
    orders: data.orders,
    nps: data.nps,
    config: configFor(project, { ...FULL_DEMO_CONFIG, tenantId: userId }),
  });
  return project;
}

export function seedCosmeticsProject(userId: string): ProjectRow {
  const existing = findProjectByBrand(userId, "rees46-cosmetics");
  if (existing) {
    if (latestCutMeta(existing.id)) hydrateLatest(existing.id);
    return existing;
  }
  const dir = join(process.cwd(), "data/rees46-cosmetics");
  if (!existsSync(join(dir, "events.json")) || !existsSync(join(dir, "orders.csv"))) {
    throw new Error("cosmetics-missing");
  }
  const events = JSON.parse(readFileSync(join(dir, "events.json"), "utf8")) as RawEvent[];
  const orders = basketLines(parseCsvOrders(readFileSync(join(dir, "orders.csv"), "utf8")), events);
  const project: ProjectRow = {
    id: newId("p"),
    ownerUserId: userId,
    name: "Магазин косметики",
    brandId: "rees46-cosmetics",
    demo: false,
    createdAt: nowIso(),
  };
  insertProject(project);
  persistNewCut(project, {
    events,
    orders,
    nps: [],
    config: configFor(project, {
      asOf: inferAsOf(events, orders),
      windowDays: 120,
      brandId: "rees46-cosmetics",
      tenantId: userId,
      projectName: "Магазин косметики",
      stableIdColumn: "user_session",
      category: "cosmetics",
      replenishmentLow: 30,
      replenishmentHigh: 90,
      skuRoles: {},
      currency: "",
      sampleEvery: 180,
      dataOrigin: "public_research",
      advertisingConsent: false,
      customerNotice: false,
      stageLabels: {
        visit: "Зашли",
        pdp: "Смотрели товар",
        cta: "Положили в корзину",
        checkout: "Оформили",
        purchase: "Купили",
      },
    }),
  });
  return project;
}

export function addFollowUpCut(userId: string, projectId: string): StoredRun {
  const project = ownedProject(userId, projectId);
  if (!project || project.brandId !== "demo-full") throw new AuthError("missing");
  const previousMeta = latestCutMeta(project.id);
  if (!previousMeta) throw new AuthError("missing");
  let base = hydrateCutForUser(userId, previousMeta.id);
  if (!base) throw new AuthError("missing");
  base = diagnosticForOwned(userId, base.id);
  const snapshot = base.snapshot ?? [];
  const data = fullDemoFollowUp(
    snapshot,
    base.workspace.orders.map((order) => ({ order_id: order.order_id, entity_id: order.entity_id })),
  );
  return persistNewCut(project, {
    events: data.events,
    orders: data.orders,
    nps: data.nps,
    config: configFor(project, { ...base.config, asOf: "2027-01-15", tenantId: userId }),
    previousSnapshot: snapshot,
  });
}

export function addUploadCut(
  userId: string,
  projectId: string,
  input: { events: RawEvent[]; orders: RawOrder[]; stableIdColumn: string; name?: string },
): { id: string } {
  const project = ownedProject(userId, projectId);
  if (!project) throw new AuthError("missing");
  const config = configFor(project, {
    asOf: inferAsOf(input.events, input.orders),
    windowDays: 120,
    brandId: project.brandId,
    tenantId: userId,
    projectName: input.name?.trim() || project.name,
    stableIdColumn: input.stableIdColumn,
    category: "retail",
    replenishmentLow: 30,
    replenishmentHigh: 90,
    skuRoles: {},
    currency: "",
    dataOrigin: "operator",
    advertisingConsent: false,
    customerNotice: false,
  });
  const id = newId("c");
  const previous = previousOrders(project.id);
  saveCut({
    id,
    projectId: project.id,
    asOf: config.asOf,
    config,
    events: input.events,
    orders: input.orders,
    nps: [],
    snapshot: null,
    recognition: null,
    features: null,
    jobStatus: "queued",
    jobError: null,
    createdAt: nowIso(),
  });
  scheduleCutBuild({
    cutId: id,
    projectId: project.id,
    events: input.events,
    orders: input.orders,
    nps: [],
    config,
    previousOrders: previous,
  });
  return { id };
}

export function cutProgress(userId: string, cutId: string): JobStatus | "missing" {
  const payload = loadCut(cutId);
  if (!payload || !ownedProject(userId, payload.projectId)) return "missing";
  return cutJob(cutId)?.status ?? payload.jobStatus;
}

export function hydrateCutForUser(userId: string, cutId: string): StoredRun | undefined {
  const cached = getRun(cutId);
  if (cached) {
    const project = ownedProject(userId, cached.projectId);
    if (!project) return undefined;
    return cached;
  }
  const payload = loadCut(cutId);
  if (!payload) return undefined;
  if (payload.jobStatus === "queued" || payload.jobStatus === "running") return undefined;
  const project = ownedProject(userId, payload.projectId);
  if (!project) return undefined;
  const previous = previousSnapshot(payload.projectId, payload.id);
  const stored = startRun({
    id: payload.id,
    projectId: payload.projectId,
    events: payload.events,
    orders: payload.orders,
    nps: payload.nps,
    config: { ...payload.config, tenantId: userId, projectName: project.name },
    previousSnapshot: previous,
  });
  if (payload.snapshot) stored.snapshot = payload.snapshot;
  if (payload.recognition) stored.recognition = payload.recognition;
  return stored;
}

export function hydrateLatest(projectId: string): StoredRun | undefined {
  const meta = latestCutMeta(projectId);
  if (!meta) return undefined;
  const cached = getRun(meta.id);
  if (cached) return cached;
  const payload = loadCut(meta.id);
  if (!payload) return undefined;
  const project = findProject(projectId);
  const previous = previousSnapshot(projectId, payload.id);
  const stored = startRun({
    id: payload.id,
    projectId,
    events: payload.events,
    orders: payload.orders,
    nps: payload.nps,
    config: { ...payload.config, projectName: project?.name ?? payload.config.projectName },
    previousSnapshot: previous,
  });
  if (payload.snapshot) stored.snapshot = payload.snapshot;
  if (payload.recognition) stored.recognition = payload.recognition;
  return stored;
}

export function latestOwnedRun(userId: string, projectId: string): StoredRun | undefined {
  if (!ownedProject(userId, projectId)) return undefined;
  return hydrateLatest(projectId);
}

export function diagnosticForOwned(userId: string, runId: string): StoredRun {
  const stored = hydrateCutForUser(userId, runId);
  if (!stored) throw new AuthError("missing");
  const written = diagnosticFor(stored.id);
  if (written.snapshot) updateCutSnapshot(written.id, written.snapshot, written.recognition);
  return written;
}

export function persistRunConfig(run: StoredRun): void {
  updateCutConfig(run.id, run.config);
}

function persistNewCut(
  project: ProjectRow,
  input: {
    events: RawEvent[];
    orders: RawOrder[];
    nps: RawNps[];
    config: RunConfig;
    previousSnapshot?: SnapshotLine[] | null;
  },
): StoredRun {
  const id = newId("c");
  const stored = startRun({
    id,
    projectId: project.id,
    events: input.events,
    orders: input.orders,
    nps: input.nps,
    config: { ...input.config, tenantId: project.ownerUserId, projectName: project.name, brandId: project.brandId },
    previousSnapshot: input.previousSnapshot ?? previousSnapshot(project.id),
    previousOrders: previousOrders(project.id, id),
  });
  saveCut({
    id: stored.id,
    projectId: project.id,
    asOf: stored.config.asOf,
    config: stored.config,
    events: input.events,
    orders: input.orders,
    nps: input.nps,
    snapshot: stored.snapshot,
    recognition: stored.recognition ?? null,
    features: stored.workspace.features,
    jobStatus: "done",
    jobError: null,
    createdAt: nowIso(),
  });
  return stored;
}

function previousSnapshot(projectId: string, exceptCutId?: string): SnapshotLine[] | null {
  const ram = projectRuns(projectId).find((run) => run.id !== exceptCutId && run.snapshot);
  if (ram?.snapshot) return ram.snapshot;
  for (const meta of listCutMeta(projectId)) {
    if (meta.id === exceptCutId) continue;
    const payload = loadCut(meta.id);
    if (payload?.snapshot) return payload.snapshot;
  }
  return null;
}

function configFor(project: ProjectRow, config: RunConfig): RunConfig {
  return {
    ...config,
    brandId: project.brandId,
    tenantId: project.ownerUserId,
    projectName: project.name,
  };
}

function inferAsOf(events: RawEvent[], orders: RawOrder[]): string {
  let max = "";
  for (const event of events) {
    const day = String(event.timestamp).slice(0, 10);
    if (day > max) max = day;
  }
  for (const order of orders) {
    const day = order.created_at.slice(0, 10);
    if (day > max) max = day;
  }
  return max || "2020-02-29";
}

function previousOrders(projectId: string, exceptCutId?: string): OrderRow[] | undefined {
  for (const meta of listCutMeta(projectId)) {
    if (meta.id === exceptCutId) continue;
    const payload = loadCut(meta.id);
    if (!payload?.orders.length) continue;
    return payload.orders.map((order) => ({
      order_id: order.order_id,
      entity_id: null,
      purchased_at: order.created_at,
      sku: order.sku,
      product_name: order.product_name,
      revenue: order.revenue,
      status: order.status,
      is_subscription_renewal: order.is_subscription_renewal,
      orphan: false,
      countsAsOrder: order.counts_as_order !== false,
    }));
  }
  return undefined;
}

export function parseCsvOrders(text: string): RawOrder[] {
  return parseOrdersCsv(text);
}

function basketLines(orders: RawOrder[], events: RawEvent[]): RawOrder[] {
  const owned = new Map<string, Set<string>>();
  for (const order of orders) {
    const id = order.customer_id ?? "";
    const set = owned.get(id) ?? new Set();
    set.add(order.product_name && !/^\d+$/.test(order.product_name) ? order.product_name : order.sku);
    owned.set(id, set);
  }
  const added = new Map<string, Set<string>>();
  const extra: RawOrder[] = [];
  for (const event of events) {
    if (event.event_name !== "view_checkout") continue;
    const id = String(event.user_id ?? "");
    const brand = String(event.brand ?? "").trim();
    const sku = String(event.product_id ?? "");
    const name = brand || sku;
    if (!id || !name) continue;
    const have = owned.get(id) ?? new Set();
    const seen = added.get(id) ?? new Set();
    if (have.has(name) || seen.has(name)) continue;
    seen.add(name);
    added.set(id, seen);
    extra.push({
      order_id: `line-${id}-${name}`,
      customer_id: id,
      created_at: String(event.timestamp),
      sku: sku || name,
      product_name: name,
      quantity: 1,
      revenue: 0,
      status: "paid",
      is_subscription_renewal: false,
      counts_as_order: false,
    });
  }
  return [...orders, ...extra];
}
