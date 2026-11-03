import { personRateBand } from "@/engine/client-copy";
import { evidenceState, wilsonInterval } from "@/engine/stats";
import type { Recognition } from "@/engine/recognize";
import { EvidenceBadge } from "./evidence";
import { PilotChecklist } from "./pilot-checklist";
import { ColumnChart } from "./week-charts";

export function RecognitionPanel({ recognition, chart = true }: { recognition: Recognition; chart?: boolean }) {
  const rich = ["brand", "price", "quantity", "currency", "email", "identity"]
    .map((id) => recognition.items.find((item) => item.id === id))
    .filter((item) => item?.found);
  const steps = recognition.brandSteps;
  const buyNotes = steps.map((step) => {
    const band = step.buyers !== undefined && step.cartBase !== undefined ? personRateBand(step.buyers, step.cartBase) : null;
    return `${step.brand}: ${band ?? "меньше 5"}`;
  });

  return (
    <section className="section">
      <h2>Что платформа читает в файле</h2>
      <p className="lede">
        {recognition.eventRows
          ? `${recognition.eventRows.toLocaleString("ru-RU")} событий и ${recognition.orderRows.toLocaleString("ru-RU")} заказов. Ячейка «Нет в файле» — поле, которое платформа ждёт, в этом срезе его нет.`
          : "Сырой файл этого прогона не сохранился. Ниже поля, которые платформа ждёт."}
      </p>
      <PilotChecklist pilot={recognition.pilot} />
      <div className="wanted">
        {(recognition.groups ?? []).map((group) => (
          <article key={group.id} className="wanted-card">
            <h3>{group.title}</h3>
            <p className="purpose">{group.purpose}</p>
            {group.slots.map((slot) => (
              <div key={slot.id} className="slot">
                <span>{slot.title}</span>
                <strong className={slot.found ? "" : "miss"}>{slot.value}</strong>
              </div>
            ))}
          </article>
        ))}
      </div>
      {rich.length ? (
        <article className="wanted-card">
          {rich
            .filter((item) => item!.id !== "email")
            .map((item) => (
              <div key={item!.id} className="slot">
                <span>{item!.title}</span>
                <strong>{item!.detail}</strong>
              </div>
            ))}
        </article>
      ) : null}
      {rich.find((item) => item!.id === "email") ? (
        <p className="source">
          <strong>{rich.find((item) => item!.id === "email")!.title}.</strong> {rich.find((item) => item!.id === "email")!.detail}
        </p>
      ) : null}
      {chart && steps.length ? (
        <>
          {steps.some((step) => evidenceState(step.viewers, "people").level !== "enough") ? (
            <p className="proof-kicker">
              {steps.map((step) =>
                evidenceState(step.viewers, "people").level === "enough" ? null : (
                  <span key={step.brand}>
                    {step.brand} <EvidenceBadge n={step.viewers} rule="people" /> {evidenceState(step.viewers, "people").reason}
                  </span>
                ),
              )}
            </p>
          ) : null}
          <ColumnChart
            title="Доля просмотров, после которых бренд положили в корзину"
            unit="%"
            columns={steps.map((step, index) => {
              const cart = step.cart ?? Math.round(step.cartRate * step.viewers);
              const interval = step.viewers >= 5 ? wilsonInterval(cart, step.viewers) : null;
              return {
                label: step.brand,
                value: Math.round(step.cartRate * 1000) / 10,
                caption: personRateBand(cart, step.viewers) ?? "меньше 5",
                fill: index < steps.length / 2 ? "var(--rose)" : "var(--sage)",
                band: interval ? ([interval.low * 100, interval.high * 100] as [number, number]) : undefined,
                evidence: evidenceState(step.viewers, "people").level,
              };
            })}
            legend={[
              { swatch: "rose", text: "Кладут в корзину реже" },
              { swatch: "sage", text: "Кладут в корзину чаще" },
              { swatch: "", text: "Усы — интервал Уилсона. Если усы перекрываются, разницы не видно.", wide: true },
            ]}
          />
          <p className="source">
            Высота — доля людей с просмотром этого бренда, которые положили его в корзину. Подпись — та же доля с интервалом. Слева
            кладут реже, справа чаще. Порог для каждого графика — в его подписи. Правила — одни на платформу.
            {buyNotes.length ? ` После корзины: ${buyNotes.join("; ")}.` : ""}
          </p>
        </>
      ) : null}
    </section>
  );
}

export function recognitionLine(recognition: Recognition): string {
  const empty = (recognition.groups ?? []).filter((group) => group.slots.every((slot) => !slot.found)).map((group) => group.title.toLowerCase());
  if (!recognition.eventRows) return recognition.items[0]?.detail ?? "";
  const emptyText = empty.length ? ` Пустые блоки: ${empty.join(", ")}.` : "";
  return `Платформа читает сайт, канал, устройство, письма, тест и оценку.${emptyText}`;
}
