import "./export-flag";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadFullDemo } from "../src/app/cosmetics-demo";
import { Nav } from "../src/app/nav";
import HomePage from "../src/app/page";
import BriefPage from "../src/app/agents/retention-diagnostic/page";
import SpecPage from "../src/app/spec/page";
import StudioPage from "../src/app/studio/page";
import CatalogPage from "../src/app/catalog/page";
import { accountLabel, projectLabel, ruDate } from "../src/engine/client-copy";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "web-export");
const emptyParams = Promise.resolve({});

const FILES = [
  { name: "index.html", path: "/", title: "Неделя", page: () => HomePage({ searchParams: emptyParams }) },
  { name: "brief.html", path: "/agents/retention-diagnostic", title: "Бриф", page: () => BriefPage({ searchParams: emptyParams }) },
  { name: "spec.html", path: "/spec", title: "ТЗ", page: () => SpecPage({ searchParams: emptyParams }) },
  { name: "studio.html", path: "/studio", title: "Студия", page: () => StudioPage({ searchParams: emptyParams }) },
  { name: "catalog.html", path: "/catalog", title: "Каталог", page: () => Promise.resolve(CatalogPage()) },
] as const;

function rewriteLinks(html: string): string {
  let next = html;
  const routes: Array<[string, string]> = [
    ["/agents/retention-diagnostic", "brief.html"],
    ["/catalog", "catalog.html"],
    ["/studio", "studio.html"],
    ["/spec", "spec.html"],
  ];
  for (const [from, to] of routes) {
    next = next.replaceAll(`href="${from}`, `href="${to}`);
  }
  next = next.replaceAll('href="/"', 'href="index.html"');
  return next.replace(/href="(index|brief|spec|studio|catalog)\.html\?[^"]*"/g, 'href="$1.html"');
}

function documentOf(input: { title: string; path: string; project: string; account: string; asOf: string; css: string; body: string }): string {
  const nav = renderToStaticMarkup(
    createElement(Nav, {
      project: input.project,
      account: input.account,
      asOf: input.asOf,
      path: input.path,
      demo: true,
    }),
  );
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${input.title} · FindGrowth</title>
  <style>${input.css}
.export-banner { margin: 0 40px 0; padding: 10px 14px; background: var(--gold-soft); color: var(--gold); font-size: 13px; border-radius: 10px; }
.export-static form, .export-static .actions form, .export-static details.files { display: none; }
@media (max-width: 860px) { .export-banner { margin: 0 16px; } }
  </style>
</head>
<body class="export-static">
  <div class="app">
    ${nav}
    <div class="main">
      <p class="export-banner">Статичная выгрузка. Данные уже внутри страниц. Сервер не нужен. Загрузить другой файл здесь нельзя.</p>
      ${input.body}
    </div>
  </div>
  <script>
    document.addEventListener("click", (event) => {
      const node = event.target;
      if (node instanceof Element && node.closest("[data-print]")) window.print();
    });
  </script>
</body>
</html>
`;
}

async function main() {
  const stored = loadFullDemo();
  const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
  const project = projectLabel(stored.config);
  const account = accountLabel(stored.config.tenantId);
  const asOf = `Срез ${ruDate(stored.config.asOf)}`;
  mkdirSync(outDir, { recursive: true });

  for (const file of FILES) {
    const element = (await file.page()) as ReactElement;
    const body = renderToStaticMarkup(element);
    const html = rewriteLinks(documentOf({ title: file.title, path: file.path, project, account, asOf, css, body }));
    writeFileSync(join(outDir, file.name), html);
  }

  writeFileSync(
    join(outDir, "README.txt"),
    [
      "FindGrowth — статичная выгрузка веб-платформы",
      "",
      "Откройте index.html в браузере. Интернет и сервер не нужны.",
      "Внутри — демо с полными данными, срез до 1 сентября 2026.",
      "Письма, SMS и адреса платформа отсюда не отправляет и не выгружает.",
      "",
      "Страницы: Неделя, Бриф, ТЗ, Студия (только чтение), Каталог.",
      "",
    ].join("\n"),
  );

  const zipPath = join(homedir(), "Desktop", "FindGrowth-web.zip");
  execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", outDir, zipPath]);
  console.log(zipPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
