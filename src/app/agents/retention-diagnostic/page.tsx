import { PrintButton } from "../../print-button";
import { formatMoney, orderCoverageBand, revenueShareLine, ruDate } from "@/engine/client-copy";
import { formatSeasonal } from "@/engine/seasonal";
import { brandLimits } from "@/engine/insights";
import { klaviyoSteps, mondayStep, moveBans, sendWindowText } from "@/engine/klaviyo";
import { observedCycle } from "@/engine/pipeline";
import { latestModelForProject } from "@/engine/platform-db";
import { loadOwnedDiagnostic } from "@/engine/access";
import { EmptyCut } from "../../empty-cut";
import { privacyOf, privacyVerdict } from "@/engine/privacy";
import { topCoPurchases, sequentialPairs } from "@/engine/recs";
import { shownPeople } from "@/engine/stats";
import { recognitionOf } from "../../recognition-of";
import { InsightsPanel } from "../../insights-panel";
import { CutLede } from "../../cut-lede";
import { RecognitionPanel } from "../../recognition-panel";
import { HoldoutVerdict } from "../../holdout-verdict";
import { BrandModelCard } from "../../model-card";
import { AccumulationScale, ColumnChart, orderJoinColumns, StepChart } from "../../week-charts";

export const dynamic = "force-dynamic";

export default async function DiagnosticPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const params = await searchParams;
  const stored = await loadOwnedDiagnostic(params.run);
  if (!stored?.report) return <EmptyCut title="Бриф" />;
  const report = stored.report;
  const { workspace, config } = stored;
  const privacy = privacyVerdict(privacyOf(config));
  const joinColumns = orderJoinColumns(workspace.orders);
  const joinedRevenue = joinColumns.filter((column) => column.label !== "Без визита").reduce((sum, column) => sum + column.value, 0);
  const allRevenue = joinColumns.reduce((sum, column) => sum + column.value, 0);
  const money = (value: number) => formatMoney(value, config.currency);
  const pairs = topCoPurchases(workspace.orders, config.asOf, 5);
  const unnamed = pairs.some((pair) => /^\d+$/.test(pair.leftName) || /^\d+$/.test(pair.rightName));
  const pairColumns = pairs.map((pair) => ({
    label: `${shortName(pair.leftName)} + ${shortName(pair.rightName)}`,
    value: pair.n,
    fill: "var(--sage)",
  }));
  const recognition = recognitionOf(stored);
  const pair = pairs[0] ?? null;
  const steps = klaviyoSteps({
    pockets: report.pockets,
    cycleDays: report.cycleHigh,
    letters: privacy.letters,
    pair,
    stageLabels: config.stageLabels,
    formulation: config.formulation,
    constraint: config.constraint,
    positioning: config.positioning,
  });
  const featured = mondayStep(steps, privacy.letters);
  const bans = moveBans({
    letters: privacy.letters,
    featured,
    steps,
    formulation: config.formulation,
    constraint: config.constraint,
    positioning: config.positioning,
  });
  const limits = brandLimits(config);
  const offer = pair ? `«${pair.rightName}» после «${pair.leftName}»` : null;
  const pairN = pair ? (shownPeople(pair.n).level === "hidden" ? null : pair.n) : null;
  const sequence = sequentialPairs(workspace.orders, config.asOf, 1)[0] ?? null;
  const treatmentN = stored.snapshot?.filter((line) => line.arm === "treatment").length ?? 0;
  const controlN = stored.snapshot?.filter((line) => line.arm === "control").length ?? 0;
  const cycle = observedCycle(workspace.entities, config);
  const modelRow = latestModelForProject(stored.projectId) ?? null;
  const pairTooThin = pairs.length > 0 && pairs.every((item) => item.n === 2);

  return (
    <div className="page">
      <div className="head-row">
        <div>
          <div className="kicker">
            Бриф хода · {ruDate(report.asOf)}
            {config.sampleEvery ? ` · каждый ${config.sampleEvery}-й пользователь` : ""}
          </div>
          <h1>Почему этот ход, а не другой</h1>
        </div>
        <div className="actions">
          <a className="btn ghost" href={`/spec?run=${stored.id}`}>
            Открыть ТЗ
          </a>
          <PrintButton />
        </div>
      </div>
      <section className={privacy.letters ? "verdict ok" : "verdict no"}>
        <strong>{privacy.letters ? "Письмо можно" : "Письмо нельзя"}</strong>
        <p>{privacy.letterReason}</p>
      </section>
      <CutLede
        pockets={report.pockets}
        cycleDays={report.cycleHigh}
        letters={privacy.letters}
        stageLabels={config.stageLabels}
        currency={config.currency}
      />
      {sequence ? (
        <p className="lede">Следующая покупка отдельно от корзины: {sequence.leftName} → {sequence.rightName}.</p>
      ) : null}
      {privacy.letters && featured?.kind === "flow" && workspace.measuredLift?.ready ? (
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
            <AccumulationScale prob={workspace.measuredLift.probTreatmentGreater} moveName={featured.name} />
          ) : null}
        </>
      ) : null}
      {privacy.letters && featured?.kind === "flow" ? (
        <div className="window-split note">
          <p>
            Письмо получают {shownPeople(treatmentN).text} человек, без письма остаются {shownPeople(controlN).text}. Окно отправки:{" "}
            {sendWindowText({ ...cycle, priorLow: config.replenishmentLow, priorHigh: config.replenishmentHigh })}. Тех, кто без
            письма, в эту цепочку писем не включают. Адресов в поручении нет.
          </p>
          <StepChart
            curve={cycle.curve}
            median={cycle.median}
            hazardPeak={cycle.hazardPeak}
            window={{ low: cycle.low, high: cycle.high, fromData: cycle.fromData }}
            prior={{ low: config.replenishmentLow, high: config.replenishmentHigh }}
            n={cycle.n}
            size="small"
          />
        </div>
      ) : null}
      <section className="section">
        <h2>Товар и почему эта пара</h2>
        {offer && pair ? (
          <p className="lede">
            {privacy.letters
              ? `В письмо ставить ${offer}. ${pairN === null ? "Пару купили меньше 5 человек, число скрыто." : `Пару уже купили ${pairN} человек в этом срезе.`} Это совместная покупка из файла, не скидка и не самый частый SKU роли.`
              : `${offer}. ${pairN === null ? "Пару купили меньше 5 человек." : `Пару купили ${pairN} человек.`} Класть их в письмо нельзя, пока нельзя само письмо.`}
          </p>
        ) : (
          <p className="lede">Второй товар в письмо не подставлять.</p>
        )}
        <details className="method-note">
          <summary>Как выбран порог</summary>
          <p>Основа блока — популярное в категории.</p>
          <p>Персональная пара — исключение: она ставится, только если её нижняя граница выше доли по всему магазину.</p>
          <p>Проверка пар по просмотрам в этом срезе не считалась. Сырые просмотры в срез не записаны. Третью строку — сколько пар прошло порог — здесь нечем заполнить.</p>
          {offer && pair ? null : <p>Пары, которую купили хотя бы два человека, в срезе нет.</p>}
        </details>
      </section>
      <section className="section">
        <h2>Приёмка 30 / 60</h2>
        <p className="lede">
          <a href={`/spec?run=${stored.id}`}>
            {featured?.kind === "flow" ? "Приёмка — в ТЗ: новый заказ на 30-й и 60-й день." : "Приёмка — в ТЗ."}
          </a>
        </p>
      </section>
      <section className="section bans">
        <h2>Запреты</h2>
        <ul>
          {bans.map((ban) => (
            <li key={ban}>{ban}</li>
          ))}
        </ul>
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
          <p className="source">Границу бренда оператор ещё не записал.</p>
        )}
      </section>
      <details className="week-slice">
        <summary>Приложение: файл и доказательства</summary>
        <BrandModelCard
          row={modelRow}
          profilingNotice={config.profilingNotice}
          customerNotice={config.customerNotice}
          bucket={null}
          reasons={[]}
        />
        <RecognitionPanel recognition={recognition} />
        <InsightsPanel
          skuProof
          entities={workspace.entities}
          orders={workspace.orders}
          config={config}
          recognition={recognition}
        />
        <section className="section">
          <h2>{privacy.letters ? "Что положить в письмо" : "Какие товары покупали вместе"}</h2>
          {pairs.length ? (
            <>
              <p className="lede">
                {privacy.letters
                  ? `Эти пары уже покупали вместе. В письмо на неделе до ${ruDate(report.asOf)} ставить второй товар пары.`
                  : "Эти пары уже покупали вместе. Это статистика. Класть их в письмо нельзя, пока нельзя само письмо."}
              </p>
              {pairTooThin ? (
                <p className="note">
                  {pairs.length === 5
                    ? "Пять пар по два человека. Этого мало, чтобы класть товар в письмо."
                    : "Пары по два человека. Этого мало, чтобы класть товар в письмо."}
                </p>
              ) : (
                <ColumnChart title="Сколько людей купили оба товара" columns={pairColumns} />
              )}
              <p className="source">
                Высота — число людей, у которых оба товара есть в оплаченных заказах. Продления не входят.
                {unnamed ? " Где в файле нет названия, на оси номер товара." : ""}
              </p>
            </>
          ) : (
            <p className="lede">Пар, которые покупали вместе хотя бы два человека, в этом срезе нет.</p>
          )}
        </section>
        <section className="section">
          <h2>Что проверяет стыковка заказов</h2>
          <p className="lede">
            {revenueShareLine({
              coverage: report.coverage,
              orderBand: orderCoverageBand(workspace.orders),
              joined: money(joinedRevenue),
              all: money(allRevenue),
            })}{" "}
            Совпадение идентификатора не проверяет цикл и не обещает, что письмо вернёт уже заплаченное.
          </p>
          <ColumnChart title="Из каких заказов сложилась сумма" unit={config.currency || "сумма"} columns={joinColumns} />
          {config.sampleEvery ? (
            <p className="note">
              В прогоне каждый {config.sampleEvery}-й пользователь. Сумма на этой странице — не выручка всего магазина.
            </p>
          ) : null}
          {!config.currency ? <p className="note">Валюта в файле не указана.</p> : null}
          {report.coverage < 0.2 ? (
            <p className="note warn">Сначала нужен общий идентификатор визита и заказа.</p>
          ) : null}
        </section>
      </details>
    </div>
  );
}

function shortName(name: string): string {
  return name.length > 16 ? `${name.slice(0, 15)}…` : name;
}
