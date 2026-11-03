import { formatCount, formatMoney, pct, personRateBand } from "@/engine/client-copy";
import { evidenceState, shownPeople, wilsonInterval } from "@/engine/stats";
import type { EntityRow, OrderRow, RunConfig } from "@/engine/types";
import { unitEconomics, type AarrrStep, type PnlLine, type UnitCard } from "@/engine/unit-econ";
import { CohortLtvTable } from "./cohort-ltv";
import { ColumnChart } from "./week-charts";

const SOURCE_RU = {
  file: "Файл",
  operator: "Оператор",
  model: "Файл × оператор",
};

export function UnitPanel({
  entities,
  orders = [],
  config,
  showAarrr = true,
}: {
  entities: EntityRow[];
  orders?: OrderRow[];
  config: RunConfig;
  showAarrr?: boolean;
}) {
  const unit = unitEconomics(entities, config, orders);
  const money = (value: number) => formatMoney(value, config.currency);
  const fileVisitors = config.sampleEvery && config.sampleEvery > 1 ? unit.visitors / config.sampleEvery : unit.visitors;
  const acquire = unit.aarrr.find((step) => step.id === "acquire")?.n ?? 0;
  const rateBands: Record<string, string | null> = {
    conversion: personRateBand(unit.buyers, fileVisitors),
    repeat: personRateBand(unit.repeated, unit.mature),
  };
  const ratePoints: Record<string, string | null> = {
    conversion: fileVisitors > 0 ? pct(unit.buyers / fileVisitors) : null,
    repeat: unit.mature > 0 ? pct(unit.repeat) : null,
  };
  const funnelColumns = unit.aarrr
    .filter((step) => step.id !== "retain" && step.id !== "refer" && step.n !== null)
    .map((step) => ({
      label: step.id === "acquire" ? "Зашли" : step.id === "activate" ? "Смотрели" : "Купили",
      value: step.n ?? 0,
      fill: step.id === "revenue" ? "var(--sage)" : step.id === "activate" ? "var(--sand)" : "var(--ink)",
      caption: aarrrBand(step, acquire, unit.repeated, unit.mature) ?? (step.rate === null ? undefined : "меньше 5"),
      band: aarrrCountBand(step, acquire),
      evidence: evidenceState(step.id === "acquire" ? (step.n ?? 0) : acquire, "people").level,
    }));

  return (
    <section className="section">
      <h2>Экономика среза</h2>
      <p className="lede">
        Карточки «файл» считаются из визитов и оплат. CAC, маржа, P&amp;L и запас кассы появляются, только если оператор записал
        расход. Это не выручка подписки и не прогноз LTV.
      </p>
      <div className="unit-grid">
        {unit.cards.map((item) => (
          <UnitCardView key={item.id} card={item} unit={unit} money={money} rateBands={rateBands} ratePoints={ratePoints} />
        ))}
        {unit.derived.map((item) => (
          <UnitCardView key={item.id} card={item} unit={unit} money={money} rateBands={rateBands} ratePoints={ratePoints} />
        ))}
      </div>
      {showAarrr ? (
        <>
          <h3 className="unit-sub">Шаги из файла</h3>
          <p className="lede">Привлечение, активация и выручка — шаги воронки. Удержание — повтор зрелых. Рекомендаций в файле нет.</p>
          <div className="aarrr-grid">
            {unit.aarrr.map((step) => (
              <AarrrCard key={step.id} step={step} acquire={acquire} repeated={unit.repeated} mature={unit.mature} />
            ))}
          </div>
          {funnelColumns.length ? (
            <ColumnChart
              title="Шаги: зашли, смотрели, купили"
              columns={funnelColumns}
              legend={[{ swatch: "", text: "Усы — интервал Уилсона. Если усы перекрываются, разницы не видно.", wide: true }]}
            />
          ) : null}
        </>
      ) : null}
      <h3 className="unit-sub">Когортный LTV</h3>
      <CohortLtvTable cohorts={unit.cohorts} currency={config.currency} />
      {unit.pnl ? (
        <>
          <h3 className="unit-sub">P&amp;L среза</h3>
          <p className="lede">Лестница от уже заплаченного. COGS и налог — из допущений. Это не отчёт за календарный месяц.</p>
          <PnlLadder lines={unit.pnl} money={money} />
        </>
      ) : (
        <p className="source">P&amp;L появится, когда в студии запишут валовую маржу. Маркетинг, OPEX, налог и касса — рядом.</p>
      )}
    </section>
  );
}

function UnitCardView({
  card,
  unit,
  money,
  rateBands,
  ratePoints,
}: {
  card: UnitCard;
  unit: ReturnType<typeof unitEconomics>;
  money: (value: number) => string;
  rateBands: Record<string, string | null>;
  ratePoints: Record<string, string | null>;
}) {
  const rated = card.kind === "pct" && card.id in rateBands;
  const band = rated ? rateBands[card.id] : null;
  const hiddenRate = rated && !band;
  const point = hiddenRate ? "меньше 5" : band ? (ratePoints[card.id] ?? band) : formatCard(card, unit, money, rateBands);
  return (
    <article className="unit-card">
      <div className={`unit-src ${card.source}`}>{SOURCE_RU[card.source]}</div>
      <div className={hiddenRate ? "val text" : "val"}>{hiddenRate ? "меньше 5" : point}</div>
      <div className="name">{card.name}</div>
      {band ? <p className="band">{band}</p> : null}
      <p className="formula">{card.formula}</p>
      <p>{card.text}</p>
    </article>
  );
}

function AarrrCard({
  step,
  acquire,
  repeated,
  mature,
}: {
  step: AarrrStep;
  acquire: number;
  repeated: number;
  mature: number;
}) {
  const band = aarrrBand(step, acquire, repeated, mature);
  const count = step.n === null ? "—" : shownPeople(step.n).level === "hidden" ? "меньше 5" : formatCount(step.n);
  return (
    <article className="aarrr-card">
      <div className="unit-src file">{step.id === "refer" ? "Нет в файле" : "Файл"}</div>
      <div className="val">{count}</div>
      <div className="name">{AARRR_RU[step.id] ?? step.text}</div>
      <p>{step.rate === null ? step.text : `${band ?? "меньше 5"}. ${step.text}`}</p>
    </article>
  );
}

const AARRR_RU: Record<string, string> = {
  acquire: "Привлечение",
  activate: "Активация",
  retain: "Удержание",
  revenue: "Выручка",
  refer: "Рекомендации",
};

function aarrrBand(step: AarrrStep, acquire: number, repeated: number, mature: number): string | null {
  if (step.id === "activate" || step.id === "revenue") return personRateBand(step.n ?? 0, acquire);
  if (step.id === "retain") return personRateBand(repeated, mature);
  return null;
}

/** Wilson of the step count, in people, so the whisker shares the column axis. Acquire has no denominator. */
function aarrrCountBand(step: AarrrStep, acquire: number): [number, number] | undefined {
  if (step.id !== "activate" && step.id !== "revenue") return undefined;
  if (!(acquire >= 5) || step.n === null) return undefined;
  const interval = wilsonInterval(step.n, acquire);
  return [interval.low * acquire, interval.high * acquire];
}

function PnlLadder({ lines, money }: { lines: PnlLine[]; money: (value: number) => string }) {
  const peak = Math.max(...lines.map((line) => Math.abs(line.value)), 1);
  return (
    <ol className="pnl">
      {lines.map((line) => (
        <li key={line.id} className={line.value < 0 ? "minus" : "plus"}>
          <div className="pnl-head">
            <strong>{line.name}</strong>
            <span>{money(line.value)}</span>
          </div>
          <div className="pnl-track" aria-hidden="true">
            <i style={{ width: `${Math.max((Math.abs(line.value) / peak) * 100, line.value === 0 ? 0 : 4)}%` }} />
          </div>
          <p>
            {line.text.replace(/\.$/, "")}. {SOURCE_RU[line.source]}.
          </p>
        </li>
      ))}
    </ol>
  );
}

function formatCard(
  card: UnitCard,
  unit: ReturnType<typeof unitEconomics>,
  money: (value: number) => string,
  rateBands: Record<string, string | null>,
): string {
  if (card.id === "runway" && unit.runwayMonths !== null && !Number.isFinite(unit.runwayMonths)) return "∞";
  if (card.id === "payback-orders") {
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(card.value);
  }
  if (card.kind === "money") return money(card.value);
  if (card.kind === "pct") {
    if (card.id in rateBands) return rateBands[card.id] ?? "меньше 5";
    return pct(card.value);
  }
  if (card.kind === "ratio") return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(card.value)}×`;
  if (card.kind === "days") return `${Math.round(card.value)}`;
  return card.value.toLocaleString("ru-RU");
}
