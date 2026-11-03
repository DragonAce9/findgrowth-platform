import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cookieOpts, PROJECT_COOKIE, requireUser } from "@/engine/access";
import { ownedProject } from "@/engine/platform";

export async function GET(request: Request) {
  const user = await requireUser();
  const projectId = new URL(request.url).searchParams.get("id") ?? "";
  if (!ownedProject(user.id, projectId)) notFound();
  (await cookies()).set(PROJECT_COOKIE, projectId, cookieOpts);
  redirect("/");
}
