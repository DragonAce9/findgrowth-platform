import { askPlayground, openCosmetics, openFollowUp, openFullDemo, openUpload, saveBrandLimits, saveUnitAssumptions } from "../actions";
import { loadOwnedRun, requireProject } from "@/engine/access";
import { channelLabel, formatCount, formatMoney, orderCoverageBand, personRateBand, reasonLabel, revenueShareLine, ruBand, ruDate } from "@/engine/client-copy";
import { observedCycle } from "@/engine/pipeline";
import { cutJob } from "@/engine/platform-db";
import { cutProgress } from "@/engine/platform";
import { LIA_NOTICE, privacyOf, privacyVerdict } from "@/engine/privacy";
import { repeatWithin } from "@/engine/repeat";
import { scoringActivation } from "@/engine/scoring-gate";
import { evidenceState, shownPeople } from "@/engine/stats";
import { experimentReadiness } from "@/engine/experiments";
import { recognitionOf } from "../recognition-of";
import { DiagnosticPack } from "../diagnostic-pack";
import { RecognitionPanel } from "../recognition-panel";
import { UnitPanel } from "../unit-panel";
import { FailedCut } from "../failed-cut";
import { ExportChecklist } from "../export-checklist";
import { CUT_GLOSS, Gloss } from "../glossary";
import { ColumnChart, ExperimentChart, FunnelChart, orderJoinColumns, RepeatWindowChart, repeatView, StackedChart, StepChart } from "../week-charts";

export const dynamic = "force-dynamic";

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string; sku?: string; reason?: string; fallback?: string }>;
}) {
  const params = await searchParams;
  if (params.run) {
    const { user } = await requireProject();
    const progress = cutProgress(user.id, params.run);
    if (progress === "queued" || progress === "running") {
      return (
        <div className="page">
          <h1>Считаем срез</h1>
          <p className="lede">{progress === "queued" ? "Файл в очереди." : "Срез считается."} Обновите страницу через несколько секунд.</p>
          <meta httpEquiv="refresh" content="3" />
        </div>
      );
    }
    if (progress === "failed") {
      return <FailedCut error={params.run ? cutJob(params.run)?.error : null} />;
    }
  }
  const stored = await loadOwnedRun(params.run);
  if (!stored) return <StudioEmpty />;
  const { workspace, config } = stored;
  const coverage = Number(workspace.metrics.find((table) => table.name === "identity_coverage")?.rows[0]?.value ?? 0);
  const joinColumns = orderJoinColumns(workspace.orders);
  const joinedRevenue = joinColumns.filter((column) => column.label !== "Без визита").reduce((sum, column) => sum + column.value, 0);
  const allRevenue = joinColumns.reduce((sum, column) => sum + column.value, 0);
  const repeat = repeatView(workspace.entities, config.windowDays);
  const repeatBand = repeatWithin(workspace.entities, config.windowDays);
  const cycle = observedCycle(workspace.entities, config);
  const funnel = workspace.metrics.find((table) => table.name === "site_funnel");
  const experiments = experimentReadiness(workspace.exposures, config.asOf);
  const recognition = recognitionOf(stored);
  const buyers = workspace.entities.filter((row) => row.converted).slice(0, 8);
  const privacy = privacyVerdict(privacyOf(config));
  const channelMix = new Map<string, { buyers: number; visitors: number; revenue: number }>();
  let afterPurchase = 0;
  for (const entity of workspace.entities) {
    if (entity.attribution_after_purchase) {
      afterPurchase += 1;
      continue;
    }
    const row = channelMix.get(entity.first_touch_channel) ?? { buyers: 0, visitors: 0, revenue: 0 };
    if (entity.converted) {
      row.buyers += 1;
      row.revenue += entity.ltv;
    } else row.visitors += 1;
    channelMix.set(entity.first_touch_channel, row);
  }
  const channelColumns = [...channelMix.entries()]
    .sort((a, b) => b[1].buyers + b[1].visitors - (a[1].buyers + a[1].visitors))
    .map(([channel, row]) => ({
      label: channelLabel(channel),
      parts: [
        { value: row.visitors, fill: "var(--sand)" },
        { value: row.buyers, fill: "var(--sage)" },
      ],
      evidence: evidenceState(row.buyers + row.visitors, "people").level,
      note: `${formatMoney(row.revenue, config.currency)} · ${personRateBand(row.buyers, row.buyers + row.visitors) ?? "меньше 5"}`,
    }));
  const weekHref = `/?run=${stored.id}`;

  return (
    <div className="page">
      <div className="head-row">
        <div>
          <p className="kicker">Срез {ruDate(config.asOf)}</p>
          <h1>Входы среза</h1>
          <p className="lede">Записать границу и допущения, затем открыть Неделю.</p>
          <p className="lede">Студия не выбирает ход.</p>
          {config.sampleEvery ? (
            <p className="source">
              В прогоне каждый {config.sampleEvery}-й пользователь. Цифры воронки и выручки — оценка.
            </p>
          ) : null}
          <p className="source">
            <a href={weekHref}>{privacy.letters ? "Письмо можно — на неделе" : "Письмо нельзя — на неделе"}</a>
          </p>
        </div>
      </div>
      <section className="section">
        <h2>Срез и файлы</h2>
        <ExportChecklist />
        <p className="lede">Сменить демо или загрузить свои файлы здесь, не под графиками.</p>
        <div className="actions">
          <form action={openFullDemo}>
            <button className="ghost" type="submit">
              Демо с данными
            </button>
          </form>
          <form action={openFollowUp}>
            <button className="ghost" type="submit">
              Второй срез
            </button>
          </form>
          <form action={openCosmetics}>
            <button className="ghost" type="submit">
              Магазин косметики
            </button>
          </form>
        </div>
        <form className="limits" action={openUpload}>
          <label>
            События, JSON
            <input name="events" type="file" accept="application/json" required />
          </label>
          <label>
            Заказы, CSV
            <input name="orders" type="file" accept="text/csv" required />
          </label>
          <label>
            Колонка визита
            <input name="stableIdColumn" defaultValue="anonymous_id" />
          </label>
          <div className="actions">
            <button type="submit">Посчитать</button>
            {cycle.fromData ? (
              <article className="kpi">
                <div className="val">{formatCount(cycle.high)}</div>
                <div className="lbl">Медиана дней до второй покупки</div>
              </article>
            ) : null}
          </div>
        </form>
        {workspace.qualityNote ? <p className="note warn">{workspace.qualityNote}</p> : null}
        {workspace.methodologyMismatch ? (
          <p className="note warn">Срезы разной версии методологии. Сравнение не смешиваем, пока более ранний срез не пересчитан.</p>
        ) : null}
        {workspace.inferredRenewals > 0 ? (
          <p className="note">
            Предположение: {workspace.inferredRenewals} заказов похожи на продление (тот же товар, та же сумма, 28–32 дня). Из повтора они не
            исключены.
          </p>
        ) : null}
        <details>
          <summary>Текст уведомления</summary>
          <pre>{LIA_NOTICE}</pre>
        </details>
      </section>
      <section className="section">
        <h2>Граница бренда</h2>
        <p className="lede">Текст попадает в бриф и в ТЗ как граница действия. Из него не считается ни одна цифра.</p>
        <form className="limits" action={saveBrandLimits}>
          <input type="hidden" name="runId" value={stored.id} />
          <label>
            Состав
            <textarea name="formulation" defaultValue={config.formulation ?? ""} maxLength={240} />
          </label>
          <label>
            Ограничение
            <textarea name="constraint" defaultValue={config.constraint ?? ""} maxLength={240} />
          </label>
          <label>
            Позиционирование
            <textarea name="positioning" defaultValue={config.positioning ?? ""} maxLength={240} />
          </label>
          <label>
            <input type="checkbox" name="profilingNotice" defaultChecked={config.profilingNotice === true} /> Уведомление о профилировании
            записано
          </label>
          <p className="source">
            {scoringActivation(config) === "live" ? "Модель в работе." : "Без уведомления модель остаётся в тени."}
          </p>
          <label>
            <input type="checkbox" name="poolingConsent" defaultChecked={config.poolingConsent === true} /> Разрешить обезличенный пул с
            другими брендами
          </label>
          <p className="source">{config.poolingConsent ? "Проект в пуле." : "Без согласия проект не входит в пул."}</p>
          <button type="submit">Записать границу</button>
        </form>
      </section>
      <section className="section">
        <h2>Допущения экономики</h2>
        <p className="lede">
          Эти числа не читаются из файла. Пустое поле — карточки CAC, P&amp;L и запаса кассы не считаются. Маржа и налог — в
          процентах.
        </p>
        <form className="limits unit-form" action={saveUnitAssumptions}>
          <input type="hidden" name="runId" value={stored.id} />
          <label>
            Маркетинг среза
            <input name="marketingSpend" inputMode="decimal" defaultValue={numInput(config.marketingSpend)} />
          </label>
          <label>
            Валовая маржа, %
            <input name="grossMargin" inputMode="decimal" defaultValue={rateInput(config.grossMargin)} />
          </label>
          <label>
            OPEX без маркетинга
            <input name="opex" inputMode="decimal" defaultValue={numInput(config.opex)} />
          </label>
          <label>
            Налог, %
            <input name="taxRate" inputMode="decimal" defaultValue={rateInput(config.taxRate)} />
          </label>
          <label>
            Деньги в кассе
            <input name="cash" inputMode="decimal" defaultValue={numInput(config.cash)} />
          </label>
          <button type="submit">Записать допущения</button>
        </form>
        <UnitPanel entities={workspace.entities} orders={workspace.orders} config={config} />
      </section>
      <section className="section">
        <h2>Покрытие и валюта</h2>
        <p className="lede">
          {revenueShareLine({
            coverage,
            orderBand: orderCoverageBand(workspace.orders),
            joined: formatMoney(joinedRevenue, config.currency),
            all: formatMoney(allRevenue, config.currency),
          })}{" "}
          {config.currency ? `Валюта ${config.currency}.` : "Валюта в файле не указана."}
        </p>
      </section>
      <section className="section">
        <h2>Один покупатель</h2>
        <p className="lede">Черновик одного человека из файла, не когорта письма. В бриф и в следующий прогон не записывается.</p>
        <form action={askPlayground}>
          <input type="hidden" name="runId" value={stored.id} />
          <select name="entityId" defaultValue={buyers[0]?.entity_id}>
            {buyers.map((row, index) => (
              <option key={row.entity_id} value={row.entity_id}>
                Покупатель {index + 1}, уже брал {row.first_sku}
              </option>
            ))}
          </select>
          <button type="submit">Следующий товар</button>
        </form>
        {params.sku ? (
          <p className="note">
            {params.sku}. {reasonLabel(params.reason ?? "", "ru")}.
          </p>
        ) : null}
      </section>
      <div className="week-foot">
        <span>{privacy.letterReason}</span>
        <div className="actions">
          <a className="btn" href={weekHref}>
            Открыть неделю
          </a>
        </div>
      </div>
      <details className="week-slice">
        <summary>Разбор прогона</summary>
        <RecognitionPanel recognition={recognition} />
        <DiagnosticPack
          entities={workspace.entities}
          orders={workspace.orders}
          nps={[]}
          config={config}
          recognition={recognition}
          part="segments"
        />
        <section className="section">
          <h2>Выручка с визитом</h2>
          <ColumnChart title="Из каких заказов сложилась выручка" unit={config.currency || "сумма"} columns={joinColumns} />
          <p className="source">
            Высота — сумма заказа. Подпись — число заказов. Продление входит в эту долю. В график повтора продление не входит:
            там считаются только первая и вторая покупки.
          </p>
        </section>
        <section className="section">
          <h2>Повтор за {config.windowDays} дней</h2>
          <p className="lede">
            {shownPeople(repeatBand.n).level === "hidden"
              ? `Зрелые — те, у кого с первой покупки уже прошло ${config.windowDays} дней. Их меньше 5, долю повтора не показываем. Это не список письма.`
              : shownPeople(repeatBand.successes).level === "hidden"
                ? `Зрелые — те, у кого с первой покупки уже прошло ${config.windowDays} дней. Повтор: ${ruBand(repeatBand.p, repeatBand.low, repeatBand.high)}. Вторых покупок меньше 5, число скрыто. Это не список письма.`
                : `Зрелые — те, у кого с первой покупки уже прошло ${config.windowDays} дней. ${repeatBand.successes} из ${repeatBand.n}: ${ruBand(repeatBand.p, repeatBand.low, repeatBand.high)}. Вторая покупка левее линии ${config.windowDays} дней. Это не список письма.`}
          </p>
          <RepeatWindowChart view={repeat} />
          <StepChart
            curve={cycle.curve}
            median={cycle.median}
            hazardPeak={cycle.hazardPeak}
            window={{ low: cycle.low, high: cycle.high, fromData: cycle.fromData }}
            prior={{ low: config.replenishmentLow, high: config.replenishmentHigh }}
            n={cycle.n}
          />
          <p className="source">
            В график повтора входят только те, у кого с первой покупки уже прошло {config.windowDays} дней. Бирюзовые
            столбцы — день второй покупки. «Нет второй» — второй покупки не было. «Рано» — с первой покупки ещё меньше{" "}
            {config.windowDays} дней, в долю они не входят. Правее линии в повтор не попадает.
          </p>
        </section>
        <section className="section">
          <h2>Сайт</h2>
          <FunnelChart rows={funnel?.rows ?? []} labels={config.stageLabels} />
          <p className="source">
            Другая группа, не когорта письма: ось — люди воронки сайта. Человек считается один раз, по самому дальнему шагу. Над обрывом подписана разница. Список письма — одна покупка и последняя оплата старше цикла.{" "}
            {studioFunnelLine(workspace.entities)}
            {config.sampleEvery ? " Шаг выборки включён: высота — оценка, интервал по людям в файле." : ""}
          </p>
        </section>
        <section className="section">
          <h2>Откуда пришли до покупки</h2>
          <p className="lede">Все люди файла с меткой первого визита до покупки: кто потом купил и кто только зашёл.</p>
          <StackedChart
            title="Первый визит по каналам"
            columns={channelColumns}
            legend={[
              { swatch: "sage", text: "Потом купили" },
              { swatch: "sand", text: "Зашли, покупки нет" },
              { swatch: "", wide: true, text: "Канал — метка первого визита. Без метки человек попадает в прямой заход." },
            ]}
          />
          <p className="source">
            Канал — источник первого визита. Бирюзовая часть потом купила, голубая зашла и покупки нет. Выручка и доля покупок:{" "}
            {channelColumns.map((column) => `${column.label} — ${column.note}`).join("; ")}. Если в канале меньше 5 человек, долю не показываем. Человек с
            первым визитом уже после покупки в эти столбцы не входит. Таких в срезе: {shownPeople(afterPurchase).text}. Это не когорта письма.
          </p>
        </section>
        <section className="section">
          <h2>Тесты</h2>
          <ExperimentChart items={experiments} />
          <p className="source">
            Ось — люди по первому попаданию в тест. В подписи — доля каждого варианта. Порог для каждого графика — в его подписи. Правила —
            одни на платформу.
          </p>
        </section>
      </details>
    </div>
  );
}

function StudioEmpty() {
  return (
    <div className="page">
      <h1>Студия</h1>
      <p className="lede">
        <Gloss title={CUT_GLOSS}>Срез</Gloss> — выгрузка магазина на одну дату: события и заказы до этого дня. В проекте ещё нет
        среза. Загрузите файлы сюда или откройте демо Atelier.
      </p>
      <section className="section">
        <h2>Срез и файлы</h2>
        <ExportChecklist />
        <div className="actions">
          <form action={openFullDemo}>
            <button className="ghost" type="submit">
              Демо с данными
            </button>
          </form>
          <form action={openCosmetics}>
            <button className="ghost" type="submit">
              Магазин косметики
            </button>
          </form>
        </div>
        <form className="limits" action={openUpload}>
          <label>
            События, JSON
            <input name="events" type="file" accept="application/json" required />
          </label>
          <label>
            Заказы, CSV
            <input name="orders" type="file" accept="text/csv" required />
          </label>
          <label>
            Колонка визита
            <input name="stableIdColumn" defaultValue="anonymous_id" />
          </label>
          <button type="submit">Посчитать</button>
        </form>
        <details>
          <summary>Текст уведомления</summary>
          <pre>{LIA_NOTICE}</pre>
        </details>
      </section>
    </div>
  );
}

function numInput(value?: number): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function rateInput(value?: number): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value * 1000) / 10) : "";
}

function studioFunnelLine(entities: Array<{ funnel_depth: number }>): string {
  const visitors = entities.filter((entity) => entity.funnel_depth >= 1).length;
  const purchased = entities.filter((entity) => entity.funnel_depth >= 5).length;
  const band = personRateBand(purchased, visitors);
  return band ? `Воронка до покупки: ${band}.` : "Воронка до покупки: меньше 5 человек.";
}
