import { requireProject } from "@/engine/access";
import { metricCaption } from "@/engine/client-copy";
import { martCatalog } from "@/engine/catalog";
import { latestModelForProject } from "@/engine/platform-db";
import { ModelCard } from "../model-card";
import { GroupedChart } from "../week-charts";

export const dynamic = "force-dynamic";

const DOMAIN: Record<string, string> = {
  identity: "Кто",
  attribution: "Канал",
  site_conversion: "Сайт",
  loyalty: "Повтор",
  experiments: "Тесты",
  recommendation: "Товары",
  email_conversion: "Письма",
  subscribers: "Подписка",
  segments: "Сегменты",
};

const DOMAIN_ORDER = Object.keys(DOMAIN);

export default async function CatalogPage() {
  const { project } = await requireProject();
  const modelRow = latestModelForProject(project.id) ?? null;
  const cards = martCatalog();
  const live = cards.filter((card) => card.status === "live");
  const later = cards.filter((card) => card.status !== "live");
  const counts = new Map<string, { live: number; later: number }>();
  for (const card of cards) {
    const row = counts.get(card.domain) ?? { live: 0, later: 0 };
    if (card.status === "live") row.live += 1;
    else row.later += 1;
    counts.set(card.domain, row);
  }
  const domains = [...counts.keys()].sort((a, b) => {
    const ai = DOMAIN_ORDER.indexOf(a);
    const bi = DOMAIN_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const groups = domains.map((domain) => {
    const row = counts.get(domain) ?? { live: 0, later: 0 };
    return {
      label: DOMAIN[domain] ?? domain,
      bars: [
        { value: row.live, fill: "var(--sage)" },
        { value: row.later, fill: "var(--sand)" },
      ],
    };
  });

  return (
    <div className="page">
      <div className="kicker">Каталог</div>
      <h1>Что уже считается</h1>
      <p className="lede">
        Бирюзовые столбцы — меры, которые уже есть в прогоне. Голубые — имена в очереди, формулы у них ещё нет.
      </p>
      <p className="source">Тема «Сегменты» — имена мер, не список людей.</p>
      <p className="lede">
        <a href="/">Когорта письма — на неделе</a>
      </p>
      <ModelCard row={modelRow} />
      <GroupedChart
        title="Живые меры и очередь по темам"
        unit="Имён"
        groups={groups}
        legend={[
          { swatch: "sage", text: `В работе, ${live.length}` },
          { swatch: "sand", text: `В очереди, ${later.length}` },
        ]}
      />
      <p className="source">Ось — число имён в каталоге. Рядом стоят живая мера и очередь той же темы.</p>
      <div className="catalog">
        {live.map((card) => (
          <article key={card.name} className="kpi">
            <div className="lbl">{DOMAIN[card.domain] ?? card.domain}</div>
            <div className="metric-name">{metricCaption(card.name)}</div>
            <code>{card.name}</code>
          </article>
        ))}
      </div>
      <details className="files">
        <summary>В очереди, {later.length} имён</summary>
        <div className="panel" style={{ marginTop: 10 }}>
          <table>
            <tbody>
              {later.map((card) => (
                <tr key={card.name}>
                  <td>{DOMAIN[card.domain] ?? card.domain}</td>
                  <td>
                    {metricCaption(card.name)} <code>{card.name}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
