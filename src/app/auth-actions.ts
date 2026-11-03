"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cookieOpts, PROJECT_COOKIE, SESSION_COOKIE } from "@/engine/access";
import { AuthError, loginUser, logoutSession, registerUser, removeAccount, userFromSession } from "@/engine/platform";

export async function register(form: FormData): Promise<void> {
  try {
    const result = await registerUser(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
    const jar = await cookies();
    jar.set(SESSION_COOKIE, result.token, cookieOpts);
    jar.set(PROJECT_COOKIE, result.project.id, cookieOpts);
  } catch (error) {
    if (error instanceof AuthError) redirect(`/register?e=${error.message}`);
    throw error;
  }
  redirect("/projects");
}

export async function login(form: FormData): Promise<void> {
  try {
    const result = await loginUser(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
    const jar = await cookies();
    jar.set(SESSION_COOKIE, result.token, cookieOpts);
    jar.delete(PROJECT_COOKIE);
  } catch (error) {
    if (error instanceof AuthError) redirect("/login?e=auth");
    throw error;
  }
  redirect("/projects");
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  logoutSession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  jar.delete(PROJECT_COOKIE);
  redirect("/login");
}

export async function deleteAccount(): Promise<void> {
  const jar = await cookies();
  const user = userFromSession(jar.get(SESSION_COOKIE)?.value);
  if (user) removeAccount(user.id);
  jar.delete(SESSION_COOKIE);
  jar.delete(PROJECT_COOKIE);
  redirect("/register");
}
