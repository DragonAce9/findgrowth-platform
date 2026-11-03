import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { loadOptionalRun, navContext } from "@/engine/access";
import { NavLive } from "./nav";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "cyrillic"] });

export const metadata = {
  title: "FindGrowth",
  description: "Бриф удержания для марки",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const headerStore = await headers();
  const path = headerStore.get("x-fg-path") ?? "";
  const bare = path === "/login" || path === "/register";
  if (bare) {
    return (
      <html lang="ru">
        <body className={inter.className}>
          <div className="app">
            <div className="main">{children}</div>
          </div>
        </body>
      </html>
    );
  }
  const runId = new URLSearchParams(headerStore.get("x-fg-search") ?? "").get("run") ?? undefined;
  const run = await loadOptionalRun(runId);
  const nav = await navContext(run);
  return (
    <html lang="ru">
      <body className={inter.className}>
        <div className="app">
          <NavLive
            project={nav.project}
            account={nav.account}
            asOf={nav.asOf}
            demo={nav.demo}
          />
          <div className="main">{children}</div>
        </div>
      </body>
    </html>
  );
}
