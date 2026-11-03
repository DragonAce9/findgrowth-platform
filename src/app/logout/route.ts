import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PROJECT_COOKIE, SESSION_COOKIE } from "@/engine/access";
import { logoutSession } from "@/engine/platform";

export async function GET() {
  const jar = await cookies();
  logoutSession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  jar.delete(PROJECT_COOKIE);
  redirect("/login");
}
