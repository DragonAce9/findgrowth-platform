import { audienceForBrief } from "@/engine/brand-key";
import { formatCount, formatMoney, letterPermissionLine, orderCoverageBand, revenueShareLine, ruDate, ruBand, stageLabel, projectLabel, weekVerdictParts } from "@/engine/client-copy";
import { experimentReadiness } from "@/engine/experiments";
import { brandLimits } from "@/engine/insights";
import { funnelGap, observedCycle, queryDiagnostic, weekWindow } from "@/engine/pipeline";
import { privacyOf, privacyVerdict } from "@/engine/privacy";
import { topCoPurchases } from "@/engine/recs";
import { repeatWithin } from "@/engine/repeat";
import { formatSeasonal } from "@/engine/seasonal";
import { shownPeople, wilsonInterval } from "@/engine/stats";
import { loadOwnedDiagnostic } from "@/engine/access";
import { EmptyCut } from "./empty-cut";
import { Glossary, Gloss, MethodGlossary, CYCLE_GLOSS } from "./glossary";
import { KlaviyoPanel } from "./klaviyo-panel";
import { recognitionOf } from "./recognition-of";
import { InsightsPanel, PastListSection } from "./insights-panel";
import { HoldoutVerdict } from "./holdout-verdict";
import { PowerNote } from "./power-note";
import { BriefLink, CohortGrid, problemCards } from "./cut-lede";
import { AccumulationScale, ExperimentChart, FunnelChart, RecencyChart, recencyBuckets, StepChart } from "./week-charts";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const params = await searchParams;
  const stored = await loadOwnedDiagnostic(params.run);
  if (!stored) return <EmptyCut title="Неделя" />;
  const { workspace, config } = stored;
  const funnel = workspace.metrics.find((table) => table.name === "site_funnel");
  const fitted = observedCycle(workspace.entities, config);
  const cycle = { ...fitted, priorLow: config.replenishmentLow, priorHigh: config.replenishmentHigh };
  const buckets = recencyBuckets(workspace.entities, config.asOf, cycle.high);
  const letterN = buckets.reduce((sum, bucket) => sum + bucket.letter, 0);
  const otherN = buckets.reduce((sum, bucket) => sum + bucket.other, 0);
  const inCycleN = buckets.reduce((sum, bucket) => sum + bucket.inCycle, 0);
  const buyersN = letterN + otherN + inCycleN;
  const gap = funnelGap(funnel?.rows ?? []);
  const friction = workspace.entities.filter(
    (entity) => !entity.converted && entity.saw_pdp && entity.scrolled && !entity.clicked_cta,
  ).length;
  const experiments = experimentReadiness(workspace.exposures, config.asOf);
  const readable = experiments.filter((item) => item.ready).map((item) => item.experiment_id);
  const brief = `/agents/retention-diagnostic?run=${stored.id}`;
  const spec = `/spec?run=${stored.id}`;
  const from = stageLabel(gap.from, "ru", config.stageLabels);
  const to = stageLabel(gap.to, "ru", config.stageLabels);
  const privacy = privacyVerdict(privacyOf(config));
  const cycleLine = cycle.fromData
    ? `Линия — медиана дней до второй покупки, по ${formatCount(cycle.n)} покупателям со второй покупкой.`
    : `Линия — заданный цикл ${config.replenishmentLow}–${config.replenishmentHigh} дней. Вторых покупок ${cycle.n}, своей медианы ещё нет.`;
  const pockets = queryDiagnostic(workspace, config);
  const once = pockets.find((pocket) => pocket.id === "risk");
  const again = pockets.find((pocket) => pocket.id === "lost");
  const drop = pockets.find((pocket) => pocket.id === "drop" || pocket.id === "friction");
  const week = weekWindow(workspace.entities, workspace.orders, config.asOf);
  const money = (value: number) => formatMoney(value, config.currency);
  const orderBand = orderCoverageBand(workspace.orders);
  const coverageLine = revenueShareLine({ coverage: workspace.identityCoverage, orderBand });
  const currencyLine = config.currency ? `валюта ${config.currency}` : "валюта в файле не указана";
  const allPastCycle = buyersN > 0 && inCycleN === 0;
  const pair = topCoPurchases(workspace.orders, config.asOf, 1)[0] ?? null;
  const repeatBand = repeatWithin(workspace.entities, config.windowDays);
  const audience = audienceForBrief(workspace.brandKeys, stored.snapshot, stored.id);
  const controlN = audience.control.length;
  const visitors = workspace.entities.filter((entity) => entity.funnel_depth >= 1).length;
  const purchased = workspace.entities.filter((entity) => entity.funnel_depth >= 5).length;
  const funnelBand = wilsonInterval(purchased, visitors);
  const repeatLine =
    shownPeople(repeatBand.n).level === "hidden"
      ? "Повтор: меньше 5 зрелых покупателей, долю не показываем."
      : `Повтор за ${config.windowDays} дней: ${ruBand(repeatBand.p, repeatBand.low, repeatBand.high)}.`;
  const funnelLine =
    shownPeople(visitors).level === "hidden"
      ? "Воронка до покупки: меньше 5 человек."
      : `Воронка до покупки: ${ruBand(funnelBand.p, funnelBand.low, funnelBand.high)}.`;
  const decision = weekVerdictParts({
    letters: privacy.letters,
    cycleDays: cycle.high,
    once,
    again,
    drop,
    pair,
    hitRate: workspace.hitRate,
    allPastCycle,
    buyersN,
    currency: config.currency,
  });
  const quietWeek = week.visits === 0 && week.payments === 0 && week.newBuyers === 0 && week.repeatPayments === 0;
  const keyKind = workspace.brandKeys.some((link) => link.keyKind === "customer_id")
    ? "customer_id"
    : workspace.brandKeys.some((link) => link.keyKind === "order_id")
      ? "order_id"
      : "customer_id";
  const limits = brandLimits(config);
  const asOf = ruDate(config.asOf);
  const ranked = problemCards({
    pockets,
    cycleDays: cycle.high,
    letters: privacy.letters,
    stageLabels: config.stageLabels,
    currency: config.currency,
  });
  const tailAt = decision.findIndex((line) => line.startsWith("Прошлого списка") || line.startsWith("Прошлый список"));
  const kept = tailAt === -1 ? decision : decision.slice(0, tailAt);
  const banFirst = !privacy.letters && kept[0]?.startsWith("Письмо тем");
  const headline = banFirst ? (kept[1] ?? kept[0]) : kept[0];
  const decisionBody = banFirst ? kept.slice(2) : kept.slice(1);
  const weekLine = quietWeek
    ? `За семь дней до ${asOf} новых визитов и оплат в файле нет.`
    : `За семь дней до ${asOf} в файле только события этих семи дней: визиты ${formatCount(week.visits)}, оплаты ${formatCount(week.payments)}, новые покупатели ${formatCount(week.newBuyers)}, повторные оплаты ${formatCount(week.repeatPayments)}.`;
  const kpiFor = (id: string) => {
    if (id === "risk" && once) {
      return (
        <article key={id} className="kpi">
          <div className="lbl">Одна покупка</div>
          <div className="val">{money(once.revenue)}</div>
        </article>
      );
    }
    if (id === "lost" && again) {
      return (
        <article key={id} className="kpi">
          <div className="lbl">Уже возвращались</div>
          <div className="val">{money(again.revenue)}</div>
        </article>
      );
    }
    if ((id === "drop" || id === "friction") && drop) {
      return (
        <article key={id} className="kpi">
          <div className="lbl">Не дошли до корзины</div>
          <div className="val">{drop.revenue > 0 ? money(drop.revenue) : `${formatCount(drop.size)} чел.`}</div>
        </article>
      );
    }
    return null;
  };

  return (
    <div className="page">
      <section className="week-group" aria-label="Сводка">
        <p className="group-label">Сводка</p>
        <p className="trust">{letterPermissionLine({ letters: privacy.letters, reason: privacy.letterReason })}</p>
        {privacy.letters ? null : (
          <section className="verdict no">
            <strong>Письмо нельзя</strong>
          </section>
        )}
        <p className="kicker">
          Неделя {ruDate(week.from)} — {ruDate(week.to)}
        </p>
        {headline ? (
          <section className="verdict">
            <strong>{headline}</strong>
          </section>
        ) : null}
        <CohortGrid
          pockets={pockets}
          cycleDays={cycle.high}
          letters={privacy.letters}
          stageLabels={config.stageLabels}
          currency={config.currency}
        />
        <section className="kpis">{ranked.map((card) => kpiFor(card.id))}</section>
        <p className="source">
          {once || again || (drop && drop.revenue > 0) ? "Суммы в карточках уже получены, не прогноз. " : null}
          {weekLine} Деньги в карточках — покупки, уже записанные в заказах до этой недели.
        </p>
        {decisionBody.map((line) => (
          <p key={line} className="lede">
            {line}
          </p>
        ))}
      </section>

      <section className="week-group" aria-label="Действие">
        <p className="group-label">Действие</p>
        <KlaviyoPanel
          layout="monday"
          pockets={pockets}
          cycleDays={cycle.high}
          letters={privacy.letters}
          pair={pair}
          stageLabels={config.stageLabels}
          formulation={config.formulation}
          constraint={config.constraint}
          positioning={config.positioning}
          currency={config.currency}
          cycle={cycle}
          audience={audience}
          keyKind={keyKind}
          listsHref={spec}
          power={
            <PowerNote
              controlN={controlN}
              repeatP={repeatBand.p}
              repeatN={repeatBand.n}
              repeatText={ruBand(repeatBand.p, repeatBand.low, repeatBand.high)}
              letters={privacy.letters}
            />
          }
        />
        {privacy.letters && workspace.measuredLift?.ready ? (
          <>
            <HoldoutVerdict
              status={workspace.holdout?.status ?? "unchecked"}
              interim={workspace.measuredLift.interim}
              contamination={workspace.holdout?.contamination ?? null}
              compliance={workspace.holdout?.compliance ?? null}
              onReceived={workspace.holdout?.onReceived ?? null}
              diff={workspace.measuredLift.diff}
              low={workspace.measuredLift.low}
              high={workspace.measuredLift.high}
              prob={workspace.measuredLift.probTreatmentGreater}
              treatmentN={workspace.measuredLift.treatmentN}
              controlN={workspace.measuredLift.controlN}
              ready
              frozenText={money(workspace.measuredLift.frozenRevenue)}
              seasonalText={workspace.seasonal ? formatSeasonal(workspace.seasonal) : null}
            />
            {workspace.holdout?.status !== "violated" &&
            workspace.measuredLift.treatmentN >= 5 &&
            workspace.measuredLift.controlN >= 5 ? (
              <AccumulationScale prob={workspace.measuredLift.probTreatmentGreater} moveName="Одна покупка" />
            ) : null}
          </>
        ) : null}
        <BriefLink href={brief} />
      </section>

      <section className="week-group" aria-label="Данные">
        <p className="group-label">Данные</p>
        <div className="proofs stack">
          <article className="proof">
            <div className="proof-kicker">{privacy.letters ? "Доказательство хода" : "Списки"}</div>
            <h2>
              {allPastCycle
                ? `Все ${buyersN} покупателей старше цикла`
                : `${otherN} купили один раз и молчат дольше ${cycle.high} дней`}
            </h2>
            <p className="claim">
              {allPastCycle
                ? `Левая половина пустая: последняя оплата у всех правее линии ${cycle.high} дней.`
                : `Голубые столбцы — одна покупка правее линии. Синие — уже возвращались и тоже правее линии, их ${letterN}.`}
            </p>
            <RecencyChart buckets={buckets} threshold={cycle.high} />
            <StepChart
              curve={fitted.curve}
              median={fitted.median}
              hazardPeak={fitted.hazardPeak}
              window={{ low: fitted.low, high: fitted.high, fromData: fitted.fromData }}
              prior={{ low: config.replenishmentLow, high: config.replenishmentHigh }}
              n={fitted.n}
            />
            <p className="source">
              Каждый столбец — покупатели на {ruDate(config.asOf)}, шаг 10 дней от последней оплаты. Высота — число людей.{" "}
              <Gloss title={CYCLE_GLOSS}>Цикл</Gloss> — обычное число дней до второй покупки. {cycleLine}
            </p>
          </article>
          <article className="proof">
            <div className="proof-kicker">Второй ход · сайт</div>
            <h2>
              {shownPeople(gap.drop).text} не перешли: {from} → {to}
            </h2>
            <p className="claim">
              «{from}» — {formatCount(gap.fromN)}. «{to}» — {formatCount(gap.toN)}.
              {friction > 0 && gap.from === "pdp"
                ? ` ${formatCount(friction)} из оставшихся на карточке долистали её и не нажали кнопку.`
                : ""}{" "}
              Это правка карточки товара на сайте, не второе письмо.
            </p>
            <FunnelChart rows={funnel?.rows ?? []} labels={config.stageLabels} />
            <p className="source">
              Ось — число людей до {ruDate(config.asOf)}. Человек считается один раз, по самому дальнему шагу. Над обрывом
              подписана разница. Воронка накопительная, не за семь дней. {funnelLine} {repeatLine}
              {config.sampleEvery ? " Высота воронки — оценка по выборке, интервал посчитан по людям в файле." : ""}
            </p>
          </article>
        </div>
        <PastListSection
          hitRate={workspace.hitRate}
          hitRatePopular={workspace.hitRatePopular}
          hitRateLow={workspace.hitRateLow}
          hitRateHigh={workspace.hitRateHigh}
          hitRateRandom={workspace.hitRateRandom}
          hitRateRandomLow={workspace.hitRateRandomLow}
          hitRateRandomHigh={workspace.hitRateRandomHigh}
          hitRatePopularLow={workspace.hitRatePopularLow}
          hitRatePopularHigh={workspace.hitRatePopularHigh}
          windowDays={config.windowDays}
        />
        <InsightsPanel
          entities={workspace.entities}
          orders={workspace.orders}
          config={config}
          recognition={recognitionOf(stored)}
          brand={false}
        />
      </section>

      <details className="week-slice">
        <summary>Подробности</summary>
        <section className="section">
          <h2>Закон</h2>
          <p className="lede">Правило платформы: {privacy.lawLabel}.</p>
          {privacy.decisions.map((decisionRow) =>
            decisionRow.id === "letters" ? (
              <section key={decisionRow.id} className={decisionRow.allowed ? "verdict ok" : "verdict no"}>
                <strong>{decisionRow.allowed ? "Письмо можно" : "Письмо нельзя"}</strong>
                <p>{decisionRow.text}</p>
              </section>
            ) : (
              <p key={decisionRow.id} className={decisionRow.allowed ? "note" : "note warn"}>
                <strong>{decisionRow.allowed ? "Можно." : "Нельзя."}</strong> {decisionRow.text}
              </p>
            ),
          )}
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
            <p className="lede">Оператор ещё не записал состав, ограничение и позиционирование. Из пустого текста числа не выводятся.</p>
          )}
        </section>
        <section className="section">
          <h2>Проверка файла</h2>
          <p className="lede">
            {coverageLine}. {currencyLine}.
          </p>
        </section>
        <Glossary />
        <MethodGlossary />
        <article className="proof">
          <div className="proof-kicker">Тест</div>
          <h2>{readable.length ? `${readable.join(", ")} можно читать` : "Готового теста нет"}</h2>
          <p className="claim">В каждом варианте нужно от 50 человек, тест от 7 дней, и доли близкие к плану. Лифта здесь нет.</p>
          <ExperimentChart items={experiments} />
          <p className="source">
            Ось — люди по первому попаданию в тест. В подписи — доля каждого варианта. Порог для каждого графика — в его подписи.
            Правила — одни на платформу.
          </p>
        </article>
      </details>
      <div className="week-foot">
        <span>
          {projectLabel(config)}.
          {config.sampleEvery ? ` Каждый ${config.sampleEvery}-й пользователь.` : ""}
        </span>
        <div className="actions">
          <a className="btn ghost" href={spec}>
            Открыть ТЗ
          </a>
          <a className="btn" href={brief}>
            Открыть бриф
          </a>
        </div>
      </div>
    </div>
  );
}
