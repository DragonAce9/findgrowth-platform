"use client";

import { usePathname } from "next/navigation";

const GROUPS = [
  {
    label: "Клиенту",
    links: [
      { href: "/", label: "Неделя" },
      { href: "/agents/retention-diagnostic", label: "Бриф" },
      { href: "/spec", label: "ТЗ" },
    ],
  },
  {
    label: "Данные",
    links: [{ href: "/studio", label: "Студия" }],
  },
];

export function Nav({
  project,
  account,
  asOf,
  path,
  demo = false,
}: {
  project: string;
  account: string;
  asOf: string;
  path: string;
  demo?: boolean;
}) {
  return (
    <header className="top">
      <a className="logo" href="/">
        Find<span>growth</span>
      </a>
      <div className="project">
        <span className="sb-label">Проект</span>
        <div className="project-row">
          <a className="project-name" href="/projects" title="Сменить проект">
            {project}
          </a>
          {demo ? <span className="tag">Демо данные</span> : null}
        </div>
      </div>
      <nav className="top-nav" aria-label="Разделы">
        {GROUPS.map((group) => (
          <div className="top-group" key={group.label}>
            <span className="sb-label">{group.label}</span>
            {group.links.map((link) => {
              const on = link.href === "/" ? path === "/" || path === "/index.html" : path.startsWith(link.href);
              return (
                <a key={link.href} className={on ? "item on" : "item"} href={link.href}>
                  {link.label}
                </a>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="top-foot">
        <span className="sb-label">Аккаунт</span>
        <strong>{account}</strong>
        <span className="as-of">{asOf}</span>
        <div className="account-links">
          <a className="catalog-link" href="/catalog">
            Каталог
          </a>
          <a className="catalog-link" href="/logout">
            Выйти
          </a>
        </div>
      </div>
    </header>
  );
}

export function NavLive({
  project,
  account,
  asOf,
  demo = false,
}: {
  project: string;
  account: string;
  asOf: string;
  demo?: boolean;
}) {
  return <Nav project={project} account={account} asOf={asOf} path={usePathname()} demo={demo} />;
}
