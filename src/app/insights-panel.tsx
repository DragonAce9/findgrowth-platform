import { channelLabel, personRateBand, ruBand } from "@/engine/client-copy";
import { brandLimits, channelCuts, firstProductLines, hitSentence, letterRates } from "@/engine/insights";
import { evidenceState, wilsonInterval } from "@/engine/stats";
import type { Recognition } from "@/engine/recognize";
import type { EntityRow, OrderRow, RunConfig } from "@/engine/types";
import { EvidenceBadge } from "./evidence";
import { ShrinkChart } from "./shrink-chart";
import { ColumnChart, StackedChart } from "./week-charts";

export function InsightsPanel({
  entities,
  orders,
  config,
  recognition,
  skuProof = false,
  brand = true,
}: {
  entities: EntityRow[];
  orders: OrderRow[];
  config: RunConfig;
  recognition: Recognition;
  skuProof?: boolean;
  brand?: boolean;
}) {
  const lines = firstProductLines(entities, orders, config.windowDays);
  const channels = channelCuts(entities);
  const letters = letterRates(recognition);
  const limits = brandLimits(config);
  const lineColumns = lines.map((line) => ({
    label: line.name.length > 16 ? `${line.name.slice(0, 15)}…` : line.name,
    parts: [
      { value: line.repeated, fill: "var(--sage)" },
      { value: line.mature - line.repeated, fill: "var(--sand)" },
    ],
    caption: personRateBand(line.repeated, line.mature) ?? "меньше 5",
    evidence: evidenceState(line.mature, "people").level,
  }));
  const channelColumns = channels.map((cut) => ({
    label: channelLabel(cut.channel),
    parts: [
      { value: cut.again, fill: "var(--sage)" },
      { value: cut.once, fill: "var(--sand)" },
    ],
    evidence: evidenceState(cut.once + cut.again, "people").level,
  }));
  const productRows = lines.map((line) => ({
    id: line.name,
    label: line.name.length > 16 ? `${line.name.slice(0, 15)}…` : line.name,
    successes: line.repeated,
    n: line.mature,
  }));
  const channelRows = channels.map((cut) => ({
    id: cut.channel,
    label: channelLabel(cut.channel),
    successes: cut.again,
    n: cut.once + cut.again,
  }));

  return (
    <>
      <section className="section">
        <h2>Какой первый товар возвращает</h2>
        {lines.length ? (
          <>
            {skuProof ? null : (
              <p className="lede">
                Покупатели, у которых с первой покупки уже прошло {config.windowDays} дней, по товару первой оплаты.
              </p>
            )}
            <StackedChart title="Первый товар и повтор" columns={lineColumns} legend={[
              { swatch: "sage", text: "Купили ещё раз" },
              { swatch: "sand", text: "Одна покупка" },
            ]} />
            <ShrinkChart title="Повтор по первому товару" rows={productRows} rule="people" />
            <p className="source">
              Человек попадает в столбец своего первого товара. Подпись — доля второй покупки с интервалом. Если зрелых меньше 5, долю не показываем. Продления не входят. Это не список письма.
            </p>
          </>
        ) : (
          <p className="lede">Покупателей, у которых с первой покупки уже прошло {config.windowDays} дней, в этом срезе нет.</p>
        )}
      </section>
      {skuProof ? null : (
        <>
          <section className="section">
            <h2>Кто вернулся, по каналу первого визита</h2>
            {channels.length ? (
              <>
                <p className="lede">Канал первого визита до покупки.</p>
                <StackedChart title="Покупатели по каналу" columns={channelColumns} legend={[
                  { swatch: "sage", text: "Купили ещё раз" },
                  { swatch: "sand", text: "Одна покупка" },
                ]} />
                <ShrinkChart title="Повтор по каналу" rows={channelRows} rule="people" />
                <p className="source">
                  Высота — число покупателей. В столбце только те, кто купил; визит, помеченный после покупки, сюда не входит. Интервал доли повторной покупки:{" "}
                  {channels
                    .map((cut) => `${channelLabel(cut.channel)} — ${personRateBand(cut.again, cut.once + cut.again) ?? "меньше 5"}`)
                    .join("; ")}
                  . Если в канале меньше 5 покупателей, долю не показываем. Это не список письма: письмо — одна покупка и последняя оплата старше цикла.
                </p>
              </>
            ) : (
              <p className="lede">Покупателей с визитом до покупки в этом срезе нет.</p>
            )}
          </section>
          <section className="section">
            <h2>Письма в файле</h2>
            {letters && letters.sent > 0 ? (
              <>
                {evidenceState(letters.sent, "people").level === "enough" ? null : (
                  <p className="proof-kicker">
                    Отправки <EvidenceBadge n={letters.sent} rule="people" /> {evidenceState(letters.sent, "people").reason}
                  </p>
                )}
                <ColumnChart
                  title="Письма в файле"
                  unit="События"
                  columns={[
                    { label: "Отправки", value: letters.sent, fill: "var(--ink)", evidence: evidenceState(letters.sent, "people").level },
                    {
                      label: "Открытия",
                      value: letters.opened,
                      fill: "var(--sage)",
                      caption: eventBand(letters.opened, letters.sent),
                      band: eventCountBand(letters.opened, letters.sent),
                      evidence: evidenceState(letters.sent, "people").level,
                    },
                    {
                      label: "Отписки",
                      value: letters.unsub,
                      fill: "var(--danger)",
                      caption: eventBand(letters.unsub, letters.sent),
                      band: eventCountBand(letters.unsub, letters.sent),
                      evidence: evidenceState(letters.sent, "people").level,
                    },
                  ]}
                  legend={[{ swatch: "", text: "Усы — интервал Уилсона. Если усы перекрываются, разницы не видно.", wide: true }]}
                />
                <p className="source">
                  Высота — число событий в файле. Доли считаются от отправок. Платформа эти письма не отправляет и адреса не выгружает.
                </p>
              </>
            ) : (
              <p className="lede">В файле нет отправок. Долю открытия и отписки считать не из чего. Платформа письма не отправляет.</p>
            )}
          </section>
          {brand ? (
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
          ) : null}
        </>
      )}
    </>
  );
}

export function PastListSection({
  hitRate,
  hitRatePopular,
  hitRateLow,
  hitRateHigh,
  hitRateRandom,
  hitRateRandomLow,
  hitRateRandomHigh,
  hitRatePopularLow,
  hitRatePopularHigh,
  windowDays,
}: {
  hitRate: number | null;
  hitRatePopular: number | null;
  hitRateLow?: number | null;
  hitRateHigh?: number | null;
  hitRateRandom?: number | null;
  hitRateRandomLow?: number | null;
  hitRateRandomHigh?: number | null;
  hitRatePopularLow?: number | null;
  hitRatePopularHigh?: number | null;
  windowDays: number;
}) {
  const extra =
    hitRateLow !== null && hitRateLow !== undefined && hitRateHigh !== null && hitRateHigh !== undefined
      ? {
          low: hitRateLow,
          high: hitRateHigh,
          random: hitRateRandom ?? null,
          randomLow: hitRateRandomLow ?? null,
          randomHigh: hitRateRandomHigh ?? null,
          popularLow: hitRatePopularLow ?? null,
          popularHigh: hitRatePopularHigh ?? null,
        }
      : undefined;
  const randomColumn =
    hitRateRandom !== null &&
    hitRateRandom !== undefined &&
    hitRateRandomLow !== null &&
    hitRateRandomLow !== undefined &&
    hitRateRandomHigh !== null &&
    hitRateRandomHigh !== undefined
      ? [
          {
            label: "Случайный товар",
            value: Math.round(hitRateRandom * 1000) / 10,
            fill: "var(--ink)",
            caption: ruBand(hitRateRandom, hitRateRandomLow, hitRateRandomHigh),
            band: [hitRateRandomLow * 100, hitRateRandomHigh * 100] as [number, number],
          },
        ]
      : [];
  return (
    <section className="section">
      <h2>Прошлый список</h2>
      {hitRate !== null && hitRatePopular !== null ? (
        <>
          <p className="lede">Купили из прошлого списка против частого товара той же роли. Высота — процент, не прогноз.</p>
          <ColumnChart
            title="Покупки после списка"
            unit="%"
            columns={[
              {
                label: "Прошлый список",
                value: Math.round(hitRate * 1000) / 10,
                fill: "var(--sage)",
                caption: extra ? ruBand(hitRate, extra.low, extra.high) : undefined,
                band: extra ? ([extra.low * 100, extra.high * 100] as [number, number]) : undefined,
              },
              {
                label: "Частый товар роли",
                value: Math.round(hitRatePopular * 1000) / 10,
                fill: "var(--sand)",
                caption:
                  extra?.popularLow !== null && extra?.popularLow !== undefined && extra?.popularHigh !== null && extra?.popularHigh !== undefined
                    ? ruBand(hitRatePopular, extra.popularLow, extra.popularHigh)
                    : undefined,
                band:
                  extra?.popularLow !== null && extra?.popularLow !== undefined && extra?.popularHigh !== null && extra?.popularHigh !== undefined
                    ? ([extra.popularLow * 100, extra.popularHigh * 100] as [number, number])
                    : undefined,
              },
              ...randomColumn,
            ]}
            legend={[{ swatch: "", text: "Усы — интервал бутстрепа по людям.", wide: true }]}
          />
          <p className="source">{hitSentence(hitRate, hitRatePopular, windowDays, extra)}</p>
        </>
      ) : (
        <p className="lede">{hitSentence(hitRate, hitRatePopular, windowDays, extra)}</p>
      )}
    </section>
  );
}

function eventBand(successes: number, n: number): string | undefined {
  return personRateBand(successes, n) ?? (n > 0 && n < 5 ? "меньше 5" : undefined);
}

/** Wilson interval of a count, on the same axis as the event column. */
function eventCountBand(successes: number, n: number): [number, number] | undefined {
  if (!(n >= 5)) return undefined;
  const interval = wilsonInterval(successes, n);
  return [interval.low * n, interval.high * n];
}

