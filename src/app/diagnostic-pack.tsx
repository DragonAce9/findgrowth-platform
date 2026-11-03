import { channelLabel, deviceLabel, formatMoney, personRateBand } from "@/engine/client-copy";
import { evidenceState } from "@/engine/stats";
import { firstPurchaseCohorts, lookalikeByDevice, observedCycleHigh, rfmGrid, rfmPoints, voiceGrid } from "@/engine/diagnostic";
import { channelCuts, deliveryChannels, firstProductLines } from "@/engine/insights";
import type { Recognition } from "@/engine/recognize";
import type { EntityRow, OrderRow, RawNps, RunConfig } from "@/engine/types";
import { ShrinkChart } from "./shrink-chart";
import { ColumnChart, ScatterChart, StackedChart } from "./week-charts";

const VOICE_RU: Record<string, string> = {
  promoter: "9–10",
  passive: "7–8",
  detractor: "0–6",
  silent: "Спросили, ответа нет",
  never: "Не спрашивали",
};

const CHANNEL_RU: Record<string, string> = {
  email: "Письмо",
  sms: "SMS",
  push: "Push",
  whatsapp: "WhatsApp",
};

export function DiagnosticPack({
  entities,
  orders,
  nps,
  config,
  recognition,
  appendix = false,
  part = "all",
}: {
  entities: EntityRow[];
  orders: OrderRow[];
  nps: RawNps[];
  config: RunConfig;
  recognition: Recognition;
  appendix?: boolean;
  part?: "all" | "segments";
}) {
  const rfm = rfmGrid(entities, config);
  const points = rfmPoints(entities, config);
  const cycleHigh = observedCycleHigh(entities, config);
  const voice = voiceGrid(entities, orders, nps);
  const cohorts = firstPurchaseCohorts(entities, config.windowDays);
  const twins = lookalikeByDevice(entities);
  const channels = deliveryChannels(recognition);
  const scatterPoints = points.map((point) => ({
    x: point.recency,
    y: point.ltv,
    fill: point.repeat ? "var(--sage)" : "var(--sand)",
  }));
  const voiceColumns = voice
    .filter((cell) => cell.n > 0)
    .map((cell) => ({
      label: VOICE_RU[cell.band] ?? cell.band,
      value: cell.n,
      fill: cell.band === "promoter" ? "var(--sage)" : cell.band === "detractor" ? "var(--danger)" : "var(--sand)",
    }));
  const cohortColumns = cohorts.map((row) => ({
    label: row.month.slice(5),
    parts: [
      { value: row.repeated, fill: "var(--sage)" },
      { value: Math.max(row.buyers - row.repeated, 0), fill: "var(--sand)" },
    ],
    caption: `${personRateBand(row.repeated, row.mature) ?? "меньше 5"} · ${row.buyers}`,
  }));
  const deviceRows = twins.map((row) => ({
    id: row.device,
    label: deviceLabel(row.device) === row.device ? "не указано" : deviceLabel(row.device),
    successes: row.converted,
    n: row.n,
  }));
  const repeatChannels = channelCuts(entities).map((cut) => ({
    id: cut.channel,
    label: channelLabel(cut.channel),
    successes: cut.again,
    n: cut.once + cut.again,
  }));
  const productRows = firstProductLines(entities, orders, config.windowDays).map((line) => ({
    id: line.name,
    label: line.name.length > 16 ? `${line.name.slice(0, 15)}…` : line.name,
    successes: line.repeated,
    n: line.mature,
  }));
  const channelColumns = channels.map((row) => ({
    label: CHANNEL_RU[row.channel] ?? row.channel,
    value: row.n,
    fill: row.n > 0 ? "var(--ink)" : "var(--line)",
    evidence: evidenceState(row.n, "people").level,
  }));

  const hasVoice = voice.some((cell) => cell.band !== "never" && cell.n > 0);
  const showCohorts = cohorts.length >= 2;
  const showDevice = !appendix;
  const showChannels = !appendix;

  const deviceSection = (
    <section className="section">
      <h2>Похожие по устройству первого визита</h2>
      {deviceRows.length ? (
        <>
          <p className="lede">Две высоты: доля в файле и доля, притянутая к общей. Усы стоят на притянутой. Пунктир — среднее по выгрузке. Все люди файла по устройству визита, купили они или нет. Это не когорта письма и не деление по давности, числу покупок и сумме.</p>
          <ShrinkChart title="Доля покупок по устройству" rows={deviceRows} rule="lookalike" />
        </>
      ) : (
        <p className="lede">Устройств в этом срезе нет.</p>
      )}
    </section>
  );
  const repeatSection = (
    <>
      <section className="section">
        <h2>Кто вернулся, по каналу первого визита</h2>
        {repeatChannels.length ? (
          <>
            <p className="lede">
              Канал первого визита до покупки. В группе только те, кто купил; визит, помеченный после покупки, сюда не входит. Это не список письма: письмо — одна покупка и последняя оплата старше цикла.
            </p>
            <ShrinkChart title="Доля повтора по каналу" rows={repeatChannels} rule="people" />
          </>
        ) : (
          <p className="lede">Покупателей с визитом до покупки в этом срезе нет.</p>
        )}
      </section>
      <section className="section">
        <h2>Какой первый товар возвращает</h2>
        {productRows.length ? (
          <>
            <p className="lede">
              Покупатели, у которых с первой покупки уже прошло {config.windowDays} дней, по товару первой оплаты. Продления не входят. Это не список письма.
            </p>
            <ShrinkChart title="Доля повтора по первому товару" rows={productRows} rule="people" />
          </>
        ) : (
          <p className="lede">Покупателей, у которых с первой покупки уже прошло {config.windowDays} дней, в этом срезе нет.</p>
        )}
      </section>
    </>
  );
  if (part === "segments") {
    return (
      <>
        {deviceSection}
        {repeatSection}
      </>
    );
  }

  return (
    <>
      <section className="section">
        <h2>Давность, число покупок и сумма</h2>
        {scatterPoints.length ? (
          <>
            <p className="lede">
              Клетки делят покупателей на три части по давности последней покупки, по числу покупок и по сумме одного заказа. Точки — те же люди: дни с последней покупки и уже заплаченное. Это не список письма: список письма — одна покупка и давность больше цикла. Вертикаль — цикл второй покупки. Бирюзовые уже возвращались, голубые купили один раз.
            </p>
            <ScatterChart
              title="Покупатели на плоскости давности и суммы"
              xLabel="Дни с последней покупки"
              yLabel="Сумма"
              points={scatterPoints}
              vLine={{ x: cycleHigh, label: `${cycleHigh} дней` }}
              legend={[
                { swatch: "sage", text: "Купили ещё раз" },
                { swatch: "sand", text: "Одна покупка" },
                { swatch: "rose", text: "Цикл второй покупки" },
              ]}
            />
            <p className="source">
              {rfm
                .filter((cell) => cell.n)
                .map((cell) => `${cell.recency}, ${cell.frequency}: ${cell.n} · ${formatMoney(cell.revenue, config.currency)}`)
                .join(". ")}
              .
            </p>
          </>
        ) : (
          <p className="lede">Покупателей с датой последней покупки в этом срезе нет.</p>
        )}
      </section>
      {hasVoice || !appendix ? (
        <section className="section">
          <h2>Оценка после заказа</h2>
          {hasVoice ? (
            <>
              <p className="lede">Среди покупателей. Оценка не смешивается с теми, кого не спрашивали.</p>
              <ColumnChart title="Оценки покупателей" columns={voiceColumns} />
            </>
          ) : (
            <p className="lede">Оценок, связанных с покупателем, в этом срезе нет.</p>
          )}
        </section>
      ) : null}
      {showCohorts ? (
        <section className="section">
          <h2>Когорты по месяцу первой покупки</h2>
          <p className="lede">
            Когорта месяца — люди, чья первая покупка пришлась на этот месяц. Бирюзовые — вторая покупка у тех, с чьей первой уже прошло {config.windowDays} дней. Подпись — доля повтора среди зрелых, с
            интервалом, и число покупателей месяца. Если зрелых меньше 5, долю не показываем.
          </p>
          <StackedChart
            title="Первая покупка по месяцам"
            columns={cohortColumns}
            legend={[
              { swatch: "sage", text: "Зрелый повтор" },
              { swatch: "sand", text: "Одна покупка или рано" },
            ]}
          />
        </section>
      ) : null}
      {showDevice ? deviceSection : null}
      {showDevice ? repeatSection : null}
      {showChannels ? (
        <section className="section">
          <h2>Куда уже писали</h2>
          <p className="lede">Столбец — сколько людей уже получали этот канал. Платформа по ним ничего не отправляет.</p>
          <ColumnChart title="Каналы в файле" columns={channelColumns} />
        </section>
      ) : null}
    </>
  );
}
