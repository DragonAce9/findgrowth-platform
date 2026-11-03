import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { tenantArtifactDir } from "./artifacts";
import { closeDb, countModelsForTenant, findUserById, insertModel, insertProject, poolingProjectIds, setProjectPooling } from "./platform-db";
import { createEmptyProject, hydrateCutForUser, latestOwnedRun, registerUser, removeAccount } from "./platform";
import { getRun, projectRuns, resetStore } from "./store";

test("two accounts keep separate projects and cannot open the other cut", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fg-platform-"));
  process.env.FG_DB_PATH = join(dir, "platform.sqlite");
  closeDb();
  resetStore();
  const first = await registerUser("one@shop.test", "password1");
  const second = await registerUser("two@shop.test", "password2");
  const owned = latestOwnedRun(first.user.id, first.project.id);
  assert.ok(owned);
  assert.equal(owned.config.projectName, "Atelier");
  assert.equal(hydrateCutForUser(second.user.id, owned.id), undefined);
  const other = latestOwnedRun(second.user.id, second.project.id);
  assert.ok(other);
  assert.notEqual(other.id, owned.id);
  const empty = createEmptyProject(first.user.id, "Второй магазин");
  assert.equal(latestOwnedRun(first.user.id, empty.id), undefined);
  const cutId = owned.id;
  const visitors = owned.workspace.entities.length;
  closeDb();
  resetStore();
  const restored = hydrateCutForUser(first.user.id, cutId);
  assert.ok(restored);
  assert.equal(restored.workspace.entities.length, visitors);
  assert.equal(hydrateCutForUser(second.user.id, cutId), undefined);
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test("a project row without pooling consent is not in the pooled set", () => {
  const dir = mkdtempSync(join(tmpdir(), "fg-pool-"));
  process.env.FG_DB_PATH = join(dir, "platform.sqlite");
  closeDb();
  insertProject({
    id: "p_pool",
    ownerUserId: "u_pool",
    name: "Пул",
    brandId: "pool-brand",
    demo: false,
    createdAt: "2026-01-01T00:00:00Z",
  });
  assert.equal(poolingProjectIds().includes("p_pool"), false);
  setProjectPooling("p_pool", true);
  assert.equal(poolingProjectIds().includes("p_pool"), true);
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test("account delete removes the user, tenant models, artifact files, and the ram run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fg-delete-"));
  process.env.FG_DB_PATH = join(dir, "platform.sqlite");
  process.env.FG_ARTIFACT_DIR = join(dir, "artifacts");
  closeDb();
  resetStore();
  const registered = await registerUser("gone@shop.test", "password1");
  const owned = latestOwnedRun(registered.user.id, registered.project.id);
  assert.ok(owned);
  assert.ok(getRun(owned.id));
  insertModel({
    id: "m_gone",
    tenantId: registered.user.id,
    projectId: registered.project.id,
    version: "0",
    modelType: "none",
    status: "shadow",
    artifactPath: null,
    createdAt: "2026-01-01T00:00:00Z",
  });
  const artifact = join(tenantArtifactDir(registered.user.id), "card.json");
  mkdirSync(dirname(artifact), { recursive: true });
  writeFileSync(artifact, "{}");
  assert.equal(countModelsForTenant(registered.user.id), 1);
  removeAccount(registered.user.id);
  assert.equal(findUserById(registered.user.id), undefined);
  assert.equal(countModelsForTenant(registered.user.id), 0);
  assert.equal(existsSync(artifact), false);
  assert.equal(getRun(owned.id), undefined);
  assert.equal(projectRuns(registered.project.id).length, 0);
  closeDb();
  delete process.env.FG_ARTIFACT_DIR;
  rmSync(dir, { recursive: true, force: true });
});
