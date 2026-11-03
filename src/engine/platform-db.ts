import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { removeTenantArtifacts } from "./artifacts";
import { pooledTrainingIds } from "./scoring-gate";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";
import { piiHmac } from "./hash";
import type { FeatureRow } from "./features";
import { normalizeSnapshotLine, type RawEvent, type RawNps, type RawOrder, type RunConfig, type SnapshotLine } from "./types";
import type { Recognition } from "./recognize";

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface SessionRow {
  token: string;
  userId: string;
  expiresAt: string;
}

export interface ProjectRow {
  id: string;
  ownerUserId: string;
  name: string;
  brandId: string;
  demo: boolean;
  createdAt: string;
}

export interface CutPayload {
  id: string;
  projectId: string;
  asOf: string;
  config: RunConfig;
  events: RawEvent[];
  orders: RawOrder[];
  nps: RawNps[];
  snapshot: SnapshotLine[] | null;
  recognition: Recognition | null;
  features: FeatureRow[] | null;
  jobStatus: JobStatus;
  jobError: string | null;
  createdAt: string;
}

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface CutMeta {
  id: string;
  projectId: string;
  asOf: string;
  createdAt: string;
}

const globalDb = globalThis as typeof globalThis & { __findgrowthDb?: DatabaseSync };

export function dbPath(): string {
  if (process.env.FG_DB_PATH) return process.env.FG_DB_PATH;
  return join(process.cwd(), "data", "platform.sqlite");
}

export function getDb(): DatabaseSync {
  if (globalDb.__findgrowthDb) return globalDb.__findgrowthDb;
  const path = dbPath();
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec("PRAGMA journal_mode = WAL;");
  applyMigrations(database);
  globalDb.__findgrowthDb = database;
  return database;
}

export function closeDb(): void {
  globalDb.__findgrowthDb?.close();
  globalDb.__findgrowthDb = undefined;
}

function applyMigrations(database: DatabaseSync): void {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );`);
  const appliedRows = database.prepare("SELECT version FROM schema_version").all() as unknown as Array<{ version: number }>;
  const applied = new Set(appliedRows.map((row) => Number(row.version)));
  const dir = join(dirname(fileURLToPath(import.meta.url)), "migrations");
  const files = readdirSync(dir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const insert = database.prepare("INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)");
  for (const file of files) {
    const version = Number(file.slice(0, 4));
    if (applied.has(version)) continue;
    database.exec(readFileSync(join(dir, file), "utf8"));
    insert.run(version, file, new Date().toISOString());
  }
}

export function appliedMigrations(): number[] {
  const rows = getDb().prepare("SELECT version FROM schema_version ORDER BY version").all() as unknown as Array<{ version: number }>;
  return rows.map((row) => Number(row.version));
}

function pack(value: unknown): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(value), "utf8"));
}

function unpack<T>(blob: unknown): T {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob as Uint8Array);
  return JSON.parse(gunzipSync(buf).toString("utf8")) as T;
}

export function insertUser(row: UserRow): void {
  getDb()
    .prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(row.id, row.email, row.passwordHash, row.createdAt);
}

export function findUserByEmail(email: string): UserRow | undefined {
  const row = getDb().prepare("SELECT id, email, password_hash AS passwordHash, created_at AS createdAt FROM users WHERE email = ?").get(email) as
    | UserRow
    | undefined;
  return row;
}

export function findUserById(id: string): UserRow | undefined {
  return getDb().prepare("SELECT id, email, password_hash AS passwordHash, created_at AS createdAt FROM users WHERE id = ?").get(id) as
    | UserRow
    | undefined;
}

export function insertSession(row: SessionRow): void {
  getDb().prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(row.token, row.userId, row.expiresAt);
}

export function findSession(token: string): SessionRow | undefined {
  const row = getDb().prepare("SELECT token, user_id AS userId, expires_at AS expiresAt FROM sessions WHERE token = ?").get(token) as
    | SessionRow
    | undefined;
  return row;
}

export function deleteSession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function deleteUserSessions(userId: string): void {
  getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function insertProject(row: ProjectRow): void {
  getDb()
    .prepare("INSERT INTO projects (id, owner_user_id, name, brand_id, demo, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(row.id, row.ownerUserId, row.name, row.brandId, row.demo ? 1 : 0, row.createdAt);
}

export function findProject(id: string): ProjectRow | undefined {
  const row = getDb()
    .prepare("SELECT id, owner_user_id AS ownerUserId, name, brand_id AS brandId, demo, created_at AS createdAt FROM projects WHERE id = ?")
    .get(id) as (Omit<ProjectRow, "demo"> & { demo: number }) | undefined;
  if (!row) return undefined;
  return { ...row, demo: row.demo === 1 };
}

export function listProjects(userId: string): ProjectRow[] {
  const rows = getDb()
    .prepare(
      "SELECT id, owner_user_id AS ownerUserId, name, brand_id AS brandId, demo, created_at AS createdAt FROM projects WHERE owner_user_id = ? ORDER BY created_at DESC",
    )
    .all(userId) as Array<Omit<ProjectRow, "demo"> & { demo: number }>;
  return rows.map((row) => ({ ...row, demo: row.demo === 1 }));
}

export function findProjectByBrand(userId: string, brandId: string): ProjectRow | undefined {
  const row = getDb()
    .prepare(
      "SELECT id, owner_user_id AS ownerUserId, name, brand_id AS brandId, demo, created_at AS createdAt FROM projects WHERE owner_user_id = ? AND brand_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(userId, brandId) as (Omit<ProjectRow, "demo"> & { demo: number }) | undefined;
  if (!row) return undefined;
  return { ...row, demo: row.demo === 1 };
}

export function deleteProjectsForUser(userId: string): void {
  const projects = listProjects(userId);
  const wipe = getDb().prepare("DELETE FROM cuts WHERE project_id = ?");
  const wipeKeys = getDb().prepare("DELETE FROM brand_keys WHERE project_id = ?");
  for (const project of projects) {
    wipe.run(project.id);
    wipeKeys.run(project.id);
  }
  getDb().prepare("DELETE FROM projects WHERE owner_user_id = ?").run(userId);
}

export function replaceBrandKeys(
  projectId: string,
  links: Array<{ stableId: string; keyKind: string; brandKey: string }>,
): void {
  const db = getDb();
  const del = db.prepare("DELETE FROM brand_keys WHERE project_id = ?");
  const ins = db.prepare(
    "INSERT INTO brand_keys (project_id, stable_id, key_kind, brand_key) VALUES (?, ?, ?, ?)",
  );
  del.run(projectId);
  for (const link of links) ins.run(projectId, link.stableId, link.keyKind, link.brandKey);
}

export function listBrandKeys(projectId: string): Array<{ stableId: string; keyKind: string; brandKey: string }> {
  const rows = getDb()
    .prepare("SELECT stable_id AS stableId, key_kind AS keyKind, brand_key AS brandKey FROM brand_keys WHERE project_id = ? ORDER BY stable_id")
    .all(projectId) as Array<{ stableId: string; keyKind: string; brandKey: string }>;
  return rows;
}

export interface ModelRow {
  id: string;
  tenantId: string;
  projectId: string | null;
  version: string;
  modelType: string;
  status: "shadow" | "challenger" | "champion";
  artifactPath: string | null;
  createdAt: string;
  metricsJson?: string | null;
  cardJson?: string | null;
  audit?: string | null;
}

export function insertModel(row: ModelRow): void {
  getDb()
    .prepare(
      `INSERT INTO models (id, tenant_id, project_id, version, model_type, metrics_json, card_json, status, artifact_path, created_at, audit_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.tenantId,
      row.projectId,
      row.version,
      row.modelType,
      row.metricsJson ?? null,
      row.cardJson ?? null,
      row.status,
      row.artifactPath,
      row.createdAt,
      row.audit ?? null,
    );
}

export interface StoredModelRow {
  version: string;
  status: "shadow" | "challenger" | "champion";
  modelType: string;
  metrics: Record<string, unknown> | null;
  card: Record<string, unknown> | null;
  audit: string | null;
}

export function latestModelForProject(projectId: string): StoredModelRow | undefined {
  const row = getDb()
    .prepare(
      `SELECT version, model_type AS modelType, status, metrics_json AS metricsJson, card_json AS cardJson, audit_text AS audit
       FROM models WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(projectId) as
    | { version: string; modelType: string; status: StoredModelRow["status"]; metricsJson: string | null; cardJson: string | null; audit: string | null }
    | undefined;
  if (!row) return undefined;
  return {
    version: row.version,
    status: row.status,
    modelType: row.modelType,
    metrics: parseJson(row.metricsJson),
    card: parseJson(row.cardJson),
    audit: row.audit,
  };
}

function parseJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
}

export interface SqliteJob {
  id: string;
  kind: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  payloadJson: string | null;
  error: string | null;
}

export function enqueueJob(input: { id: string; kind: string; payload: unknown; maxAttempts?: number; now?: string }): SqliteJob {
  const now = input.now ?? new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO jobs (id, kind, status, attempts, max_attempts, run_after, payload_json, error, created_at, updated_at)
       VALUES (?, ?, 'queued', 0, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(input.id, input.kind, input.maxAttempts ?? 3, now, JSON.stringify(input.payload ?? null), now, now);
  const job = readJob(input.id);
  if (!job) throw new Error(`job ${input.id} was not stored`);
  return job;
}

export function readJob(id: string): SqliteJob | undefined {
  return getDb()
    .prepare(
      `SELECT id, kind, status, attempts, max_attempts AS maxAttempts, run_after AS runAfter, payload_json AS payloadJson, error
       FROM jobs WHERE id = ?`,
    )
    .get(id) as SqliteJob | undefined;
}

export function dueJobs(now: string): SqliteJob[] {
  return getDb()
    .prepare(
      `SELECT id, kind, status, attempts, max_attempts AS maxAttempts, run_after AS runAfter, payload_json AS payloadJson, error
       FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY created_at`,
    )
    .all(now) as unknown as SqliteJob[];
}

/** Returns the attempt count after the claim, or 0 when the row was no longer queued. */
export function markJobRunning(id: string, now: string): number {
  const result = getDb().prepare("UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued'").run(now, id);
  if (Number(result.changes) !== 1) return 0;
  return readJob(id)?.attempts ?? 0;
}

export function markJobDone(id: string, now: string): void {
  getDb().prepare("UPDATE jobs SET status = 'done', error = NULL, updated_at = ? WHERE id = ?").run(now, id);
}

export function markJobRetry(id: string, error: string, runAfter: string, now: string): void {
  getDb().prepare("UPDATE jobs SET status = 'queued', error = ?, run_after = ?, updated_at = ? WHERE id = ?").run(error, runAfter, now, id);
}

export function markJobFailed(id: string, error: string, now: string): void {
  getDb().prepare("UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(error, now, id);
}

export function countModelsForTenant(tenantId: string): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM models WHERE tenant_id = ?").get(tenantId) as { n: number };
  return Number(row.n);
}

export function setProjectPooling(projectId: string, consent: boolean): void {
  getDb().prepare("UPDATE projects SET pooling_consent = ? WHERE id = ?").run(consent ? 1 : 0, projectId);
}

export function poolingProjectIds(): string[] {
  const rows = getDb().prepare("SELECT id, pooling_consent AS poolingConsent FROM projects").all() as Array<{
    id: string;
    poolingConsent: number;
  }>;
  return pooledTrainingIds(rows.map((row) => ({ id: row.id, poolingConsent: row.poolingConsent === 1 })));
}

export function deleteTenantModels(tenantId: string): void {
  getDb().prepare("DELETE FROM models WHERE tenant_id = ?").run(tenantId);
}

export function deleteUser(userId: string): void {
  deleteTenantModels(userId);
  removeTenantArtifacts(userId);
  deleteUserSessions(userId);
  deleteProjectsForUser(userId);
  getDb().prepare("DELETE FROM users WHERE id = ?").run(userId);
}

export function saveCut(payload: CutPayload): void {
  const events = redactEvents(payload.events);
  const orders = redactOrders(payload.orders);
  const nps = redactNps(payload.nps);
  getDb()
    .prepare(
      `INSERT INTO cuts (id, project_id, as_of, config_json, events_gz, orders_gz, nps_gz, snapshot_json, recognition_json, features_json, job_status, job_error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         as_of = excluded.as_of,
         config_json = excluded.config_json,
         events_gz = excluded.events_gz,
         orders_gz = excluded.orders_gz,
         nps_gz = excluded.nps_gz,
         snapshot_json = excluded.snapshot_json,
         recognition_json = excluded.recognition_json,
         features_json = excluded.features_json,
         job_status = excluded.job_status,
         job_error = excluded.job_error`,
    )
    .run(
      payload.id,
      payload.projectId,
      payload.asOf,
      JSON.stringify(payload.config),
      pack(events),
      pack(orders),
      pack(nps),
      payload.snapshot ? JSON.stringify(payload.snapshot) : null,
      payload.recognition ? JSON.stringify(payload.recognition) : null,
      payload.features ? JSON.stringify(payload.features) : null,
      payload.jobStatus,
      payload.jobError,
      payload.createdAt,
    );
}

export function updateCutJob(cutId: string, status: JobStatus, error?: string): void {
  getDb().prepare("UPDATE cuts SET job_status = ?, job_error = ? WHERE id = ?").run(status, error ?? null, cutId);
}

export function cutJob(cutId: string): { status: JobStatus; error: string | null } | undefined {
  const row = getDb().prepare("SELECT job_status AS status, job_error AS error FROM cuts WHERE id = ?").get(cutId) as
    | { status: JobStatus; error: string | null }
    | undefined;
  return row;
}

export function updateCutConfig(cutId: string, config: RunConfig): void {
  getDb().prepare("UPDATE cuts SET config_json = ? WHERE id = ?").run(JSON.stringify(config), cutId);
}

export function updateCutSnapshot(cutId: string, snapshot: SnapshotLine[], recognition?: Recognition): void {
  getDb()
    .prepare("UPDATE cuts SET snapshot_json = ?, recognition_json = COALESCE(?, recognition_json) WHERE id = ?")
    .run(JSON.stringify(snapshot), recognition ? JSON.stringify(recognition) : null, cutId);
}

export function loadCut(id: string): CutPayload | undefined {
  const row = getDb()
    .prepare(
      `SELECT id, project_id AS projectId, as_of AS asOf, config_json AS configJson, events_gz AS eventsGz,
              orders_gz AS ordersGz, nps_gz AS npsGz, snapshot_json AS snapshotJson, recognition_json AS recognitionJson,
              features_json AS featuresJson, job_status AS jobStatus, job_error AS jobError,
              created_at AS createdAt
       FROM cuts WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        projectId: string;
        asOf: string;
        configJson: string;
        eventsGz: unknown;
        ordersGz: unknown;
        npsGz: unknown;
        snapshotJson: string | null;
        recognitionJson: string | null;
        featuresJson: string | null;
        jobStatus: JobStatus;
        jobError: string | null;
        createdAt: string;
      }
    | undefined;
  if (!row) return undefined;
  const snapshot = row.snapshotJson ? (JSON.parse(row.snapshotJson) as Array<Partial<SnapshotLine> & Pick<SnapshotLine, "entity_id" | "sku">>) : null;
  return {
    id: row.id,
    projectId: row.projectId,
    asOf: row.asOf,
    config: JSON.parse(row.configJson) as RunConfig,
    events: unpack<RawEvent[]>(row.eventsGz),
    orders: unpack<RawOrder[]>(row.ordersGz),
    nps: unpack<RawNps[]>(row.npsGz),
    snapshot: snapshot ? snapshot.map((line) => normalizeSnapshotLine(line)) : null,
    recognition: row.recognitionJson ? (JSON.parse(row.recognitionJson) as Recognition) : null,
    features: row.featuresJson ? (JSON.parse(row.featuresJson) as FeatureRow[]) : null,
    jobStatus: row.jobStatus ?? "done",
    jobError: row.jobError,
    createdAt: row.createdAt,
  };
}

export function listCutMeta(projectId: string): CutMeta[] {
  const rows = getDb()
    .prepare("SELECT id, project_id AS projectId, as_of AS asOf, created_at AS createdAt FROM cuts WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as unknown as CutMeta[];
  return rows.map((row) => ({
    id: String(row.id),
    projectId: String(row.projectId),
    asOf: String(row.asOf),
    createdAt: String(row.createdAt),
  }));
}

export function latestCutMeta(projectId: string): CutMeta | undefined {
  return listCutMeta(projectId)[0];
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Buffer.from(bytes).toString("hex")}`;
}

function redactEvents(events: RawEvent[]): RawEvent[] {
  return events.map((event) => {
    const next: RawEvent = { ...event };
    if (typeof next.user_email === "string" && next.user_email) next.user_email = piiHmac(next.user_email);
    if (typeof next.email === "string" && next.email) next.email = piiHmac(next.email);
    if (typeof next.phone === "string" && next.phone) next.phone = piiHmac(next.phone);
    if (typeof next.user_phone === "string" && next.user_phone) next.user_phone = piiHmac(next.user_phone);
    return next;
  });
}

function redactOrders(orders: RawOrder[]): RawOrder[] {
  return orders.map((order) => {
    const phone = (order as RawOrder & { phone?: string }).phone;
    return {
      ...order,
      email: order.email ? piiHmac(order.email) : order.email,
      ...(phone ? { phone: piiHmac(phone) } : {}),
    };
  });
}

function redactNps(rows: RawNps[]): RawNps[] {
  return rows.map((row) => {
    const emailHash = row.email ? piiHmac(row.email) : row.email_hash;
    const { email: _email, ...rest } = row;
    void _email;
    return { ...rest, email_hash: emailHash };
  });
}
