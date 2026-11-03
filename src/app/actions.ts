"use server";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { assertStableIdColumn } from "@/engine/channel";
import { cookieOpts, PROJECT_COOKIE, requireProject, requireUser } from "@/engine/access";
import { AuthError, addFollowUpCut, addUploadCut, createEmptyProject, demoSliceId, ownedProject, persistRunConfig, seedAtelierProject, seedCosmeticsProject } from "@/engine/platform";
import { setProjectPooling } from "@/engine/platform-db";
import { playground, setBrandLimits, setUnitAssumptions } from "@/engine/store";
import { parseEventsJson, parseOrdersCsv } from "@/engine/validate";

export async function selectProject(form: FormData): Promise<void> {
  const user = await requireUser();
  const projectId = String(form.get("projectId") ?? "");
  if (!ownedProject(user.id, projectId)) notFound();
  (await cookies()).set(PROJECT_COOKIE, projectId, cookieOpts);
  redirect("/");
}

export async function createProject(form: FormData): Promise<void> {
  const user = await requireUser();
  const project = createEmptyProject(user.id, String(form.get("name") ?? ""));
  (await cookies()).set(PROJECT_COOKIE, project.id, cookieOpts);
  redirect("/studio");
}

export async function openDemoProject(): Promise<void> {
  const user = await requireUser();
  const project = seedAtelierProject(user.id);
  (await cookies()).set(PROJECT_COOKIE, project.id, cookieOpts);
  redirect("/");
}

export async function openUpload(form: FormData): Promise<void> {
  const { user, project } = await requireProject();
  const eventsFile = form.get("events");
  const ordersFile = form.get("orders");
  const stableIdColumn = String(form.get("stableIdColumn") || "anonymous_id");
  assertStableIdColumn(stableIdColumn);
  if (!(eventsFile instanceof File) || !(ordersFile instanceof File)) {
    throw new Error("Нужны два файла");
  }
  const events = parseEventsJson(await eventsFile.text());
  const orders = parseOrdersCsv(await ordersFile.text());
  const run = addUploadCut(user.id, project.id, { events, orders, stableIdColumn });
  redirect(`/studio?run=${run.id}`);
}

export async function openFullDemo(): Promise<void> {
  const user = await requireUser();
  const project = seedAtelierProject(user.id);
  (await cookies()).set(PROJECT_COOKIE, project.id, cookieOpts);
  const runId = demoSliceId(project.id);
  redirect(runId ? `/studio?run=${runId}` : "/studio");
}

export async function openFollowUp(): Promise<void> {
  const { user, project } = await requireProject();
  try {
    const run = addFollowUpCut(user.id, project.id);
    redirect(`/studio?run=${run.id}`);
  } catch (error) {
    if (error instanceof AuthError) notFound();
    throw error;
  }
}

export async function openCosmetics(): Promise<void> {
  const user = await requireUser();
  const project = seedCosmeticsProject(user.id);
  (await cookies()).set(PROJECT_COOKIE, project.id, cookieOpts);
  redirect("/studio");
}

export async function saveBrandLimits(form: FormData): Promise<void> {
  const { user, project } = await requireProject();
  const runId = String(form.get("runId"));
  const stored = await ownedOr404(user.id, project.id, runId);
  setBrandLimits(stored.id, {
    formulation: String(form.get("formulation") ?? ""),
    constraint: String(form.get("constraint") ?? ""),
    positioning: String(form.get("positioning") ?? ""),
  });
  stored.config.profilingNotice = form.get("profilingNotice") === "on";
  stored.config.poolingConsent = form.get("poolingConsent") === "on";
  setProjectPooling(project.id, stored.config.poolingConsent === true);
  persistRunConfig(stored);
  redirect(`/?run=${runId}`);
}

export async function saveUnitAssumptions(form: FormData): Promise<void> {
  const { user, project } = await requireProject();
  const runId = String(form.get("runId"));
  const stored = await ownedOr404(user.id, project.id, runId);
  setUnitAssumptions(stored.id, {
    marketingSpend: readMoney(form.get("marketingSpend")),
    grossMargin: readRate(form.get("grossMargin")),
    opex: readMoney(form.get("opex")),
    taxRate: readRate(form.get("taxRate")),
    cash: readMoney(form.get("cash")),
  });
  persistRunConfig(stored);
  redirect(`/?run=${runId}`);
}

export async function askPlayground(form: FormData): Promise<void> {
  const { user, project } = await requireProject();
  const runId = String(form.get("runId"));
  const entityId = String(form.get("entityId"));
  await ownedOr404(user.id, project.id, runId);
  const line = playground(runId, entityId);
  redirect(`/studio?run=${runId}&sku=${encodeURIComponent(line.sku)}&reason=${line.reason}&fallback=${line.fallback_used}`);
}

async function ownedOr404(userId: string, projectId: string, runId: string) {
  const { hydrateCutForUser } = await import("@/engine/platform");
  const stored = hydrateCutForUser(userId, runId);
  if (!stored || stored.projectId !== projectId) notFound();
  return stored;
}

function readMoney(value: FormDataEntryValue | null): number | undefined {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function readRate(value: FormDataEntryValue | null): number | undefined {
  const parsed = readMoney(value);
  if (parsed === undefined) return undefined;
  return parsed > 1 ? Math.min(parsed / 100, 1) : Math.min(parsed, 1);
}
