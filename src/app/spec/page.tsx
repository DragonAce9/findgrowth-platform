import { audienceForBrief } from "@/engine/brand-key";
import { ruDate, ruBand } from "@/engine/client-copy";
import { brandLimits } from "@/engine/insights";
import { confirmColumnText, klaviyoSteps, mondayStep } from "@/engine/klaviyo";
import { observedCycle } from "@/engine/pipeline";
import { privacyOf, privacyVerdict } from "@/engine/privacy";
import { topCoPurchases } from "@/engine/recs";
import { repeatWithin } from "@/engine/repeat";
import { loadOwnedDiagnostic } from "@/engine/access";
import { EmptyCut } from "../empty-cut";
import { KlaviyoPanel } from "../klaviyo-panel";
import { BriefLink } from "../cut-lede";
import { PowerNote } from "../power-note";
import { PrintButton } from "../print-button";
import { withCodes } from "../term";

export const dynamic = "force-dynamic";

export default async function SpecPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const params = await searchParams;
  const stored = await loadOwnedDiagnostic(params.run);
  if (!stored) return <EmptyCut title="ТЗ" />;
  const { config } = stored;
  const privacy = privacyVerdict(privacyOf(config));
  const pair = topCoPurchases(stored.workspace.orders, config.asOf, 1)[0];
  const limits = brandLimits(config);
  const cycle = { ...observedCycle(stored.workspace.entities, config), priorLow: config.replenishmentLow, priorHigh: config.replenishmentHigh };
  const audience = audienceForBrief(stored.workspace.brandKeys, stored.snapshot, stored.id);
  const repeatBand = repeatWithin(stored.workspace.entities, config.windowDays);
  const steps = klaviyoSteps({
    pockets: stored.report!.pockets,
    cycleDays: stored.report!.cycleHigh,
    letters: privacy.letters,
    pair: pair ?? null,
    stageLabels: config.stageLabels,
    formulation: config.formulation,
    constraint: config.constraint,
    positioning: config.positioning,
    cycle,
  });
  const featured = mondayStep(steps, privacy.letters);
  const day30 = acceptLine(featured?.watch ?? "", 30);
  const day60 = acceptLine(featured?.watch ?? "", 60);
  const contract = !featured
    ? "Контракт"
    : featured.kind === "site"
      ? `${featured.name}: править сайт`
      : `Письмо: ${featured.name}`;
  const column = confirmColumnText();
  const columnCut = column.indexOf("Без этого столбца");
  const columnLead = columnCut === -1 ? column : column.slice(0, columnCut).trim();
  const columnNote = columnCut === -1 ? "" : column.slice(columnCut);

  return (
    <div className="page">
      <div className="head-row">
        <div>
          <div className="kicker">ТЗ · {ruDate(config.asOf)}</div>
          <h1>{contract}</h1>
          <p className="lede">
            Один контракт на неделю до {ruDate(config.asOf)}. Сегмент задаётся условием, список адресов сюда не входит.
          </p>
          <BriefLink href={`/agents/retention-diagnostic?run=${stored.id}`} />
        </div>
        <PrintButton />
      </div>
      <KlaviyoPanel
        layout="spec"
        pockets={stored.report!.pockets}
        cycleDays={stored.report!.cycleHigh}
        letters={privacy.letters}
        pair={pair ?? null}
        stageLabels={config.stageLabels}
        formulation={config.formulation}
        constraint={config.constraint}
        positioning={config.positioning}
        currency={config.currency}
        cycle={cycle}
        audience={audience}
        power={
          <PowerNote
            controlN={audience.control.length}
            repeatP={repeatBand.p}
            repeatN={repeatBand.n}
            repeatText={ruBand(repeatBand.p, repeatBand.low, repeatBand.high)}
            letters={privacy.letters && featured?.kind !== "site"}
          />
        }
      />
      <section className="section klaviyo-card">
        <h2>Приёмка этого действия</h2>
        <p className="lede">Один критерий, одна метрика, две даты. Не общая приёмка на карточку и две цепочки писем.</p>
        <div className="monday">
          <dl>
            <div>
              <dt>Столбец</dt>
              <dd>{withCodes(columnLead)}</dd>
            </div>
          </dl>
          {columnNote ? <p className="lede">{withCodes(columnNote)}</p> : null}
        </div>
        <ol>
          <li>{day30}</li>
          <li>{day60}</li>
          <li>Не включать вторую цепочку писем.</li>
        </ol>
      </section>
      <section className="section">
        <h2>Граница бренда</h2>
        {limits.length ? (
          limits.map((limit) => (
            <p key={limit.title} className="note">
              <strong>{limit.title}.</strong> {limit.text}
            </p>
          ))
        ) : (
          <p className="lede">Состав, ограничение и позиционирование оператор ещё не записал. Текст границы в ТЗ не подменяется числом.</p>
        )}
      </section>
    </div>
  );
}

function acceptLine(watch: string, day: 30 | 60): string {
  const metric = watch.replace(/\.$/, "") || "Новый заказ";
  if (day === 60) return "На 60-й день смотреть: та же метрика.";
  return `На 30-й день смотреть: ${metric}.`;
}
