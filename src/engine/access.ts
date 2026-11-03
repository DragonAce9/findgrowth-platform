import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ruDate } from "./client-copy";
import {
  diagnosticForOwned,
  hydrateCutForUser,
  latestOwnedRun,
  ownedProject,
  userFromSession,
  userProjects,
} from "./platform";
import type { ProjectRow, UserRow } from "./platform-db";
import type { StoredRun } from "./store";

export const SESSION_COOKIE = "fg_session";
export const PROJECT_COOKIE = "fg_project";

export const cookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function currentUser(): Promise<UserRow | undefined> {
  if (process.env.FG_EXPORT === "1") return undefined;
  return userFromSession(await readSessionToken());
}

export async function requireUser(): Promise<UserRow> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function currentProject(): Promise<{ user: UserRow; project: ProjectRow } | undefined> {
  const user = await requireUser();
  const projectId = (await cookies()).get(PROJECT_COOKIE)?.value;
  const project = ownedProject(user.id, projectId);
  if (!project) return undefined;
  return { user, project };
}

export async function requireProject(): Promise<{ user: UserRow; project: ProjectRow }> {
  const pair = await currentProject();
  if (!pair) redirect("/projects");
  return pair;
}

export async function loadOptionalRun(runId?: string): Promise<StoredRun | null> {
  if (process.env.FG_EXPORT === "1") {
    const { resolveExportRun } = await import("@/app/cosmetics-demo");
    return resolveExportRun(runId);
  }
  const user = await currentUser();
  if (!user) return null;
  const projectId = (await cookies()).get(PROJECT_COOKIE)?.value;
  const project = ownedProject(user.id, projectId);
  if (!project) return null;
  if (runId) {
    const stored = hydrateCutForUser(user.id, runId);
    if (!stored || stored.projectId !== project.id) return null;
    return stored;
  }
  return latestOwnedRun(user.id, project.id) ?? null;
}

export async function loadOwnedRun(runId?: string): Promise<StoredRun | null> {
  if (process.env.FG_EXPORT === "1") return loadOptionalRun(runId);
  await requireProject();
  const stored = await loadOptionalRun(runId);
  if (runId && !stored) notFound();
  return stored;
}

export async function loadOwnedDiagnostic(runId?: string): Promise<StoredRun | null> {
  const stored = await loadOwnedRun(runId);
  if (!stored) return null;
  if (process.env.FG_EXPORT === "1") {
    const { diagnosticFor } = await import("./store");
    return diagnosticFor(stored.id);
  }
  const user = await requireUser();
  return diagnosticForOwned(user.id, stored.id);
}

export async function navContext(run: StoredRun | null): Promise<{
  project: string;
  account: string;
  asOf: string;
  demo: boolean;
}> {
  if (process.env.FG_EXPORT === "1") {
    return {
      project: run?.config.projectName ?? "Atelier",
      account: "Демо-аккаунт",
      asOf: run ? `Срез ${ruDate(run.config.asOf)}` : "Срез ещё не открыт",
      demo: true,
    };
  }
  const user = await currentUser();
  const projectId = (await cookies()).get(PROJECT_COOKIE)?.value;
  const project = user ? ownedProject(user.id, projectId) : undefined;
  return {
    project: project?.name ?? "Нет проекта",
    account: user?.email ?? "Нет аккаунта",
    asOf: run ? `Срез ${ruDate(run.config.asOf)}` : "Срез ещё не открыт",
    demo: project?.demo === true || run?.config.brandId === "demo-full",
  };
}

export async function projectList() {
  const user = await requireUser();
  return { user, projects: userProjects(user.id) };
}
