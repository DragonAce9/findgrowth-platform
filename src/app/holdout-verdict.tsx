import React from "react";
import { formatPct, formatPp } from "@/engine/client-copy";
import { CONTAMINATION_LIMIT, liftParagraph, type HoldoutState } from "@/engine/holdout";
import { Gloss, MethodDetails } from "./glossary";
import { DiffScale } from "./week-charts";
import { withCodes } from "./term";

export function HoldoutVerdict({
  status,
  interim,
  contamination,
  onReceived,
  diff,
  low,
  high,
  prob,
  treatmentN,
  controlN,
  ready,
  frozenText,
  seasonalText,
}: {
  status: HoldoutState;
  interim: boolean;
  contamination: number | null;
  compliance: number | null;
  onReceived: number | null;
  diff: number | null;
  low: number;
  high: number;
  prob: number;
  treatmentN: number;
  controlN: number;
  reason?: string;
  ready: boolean;
  frozenText: string | null;
  seasonalText: string | null;
}) {
  if (!ready) return null;
  const klass = status === "confirmed" ? "ok" : status === "violated" ? "bad" : "wait";
  const chip = status === "confirmed" ? "✓ Подтверждён" : status === "violated" ? "✕ Нарушен" : "○ Не проверен";
  const chipClass = status === "confirmed" ? "status ok" : status === "violated" ? "status bad" : "status wait";
  const small = treatmentN < 5 || controlN < 5;
  const copy = liftParagraph({
    status,
    interim,
    diffText: diff === null ? "" : formatPp(diff, low, high),
    onReceivedText: onReceived === null ? null : formatPp(onReceived, onReceived, onReceived),
    probText: formatPct(prob),
  });
  const showScale = !small && status !== "violated" && diff !== null;
  const title = small ? "Разницу по группам меньше пяти человек не считаем" : plainTitle(copy.title);
  return (
    <section className={`verdict ${klass}`} aria-labelledby="holdout-title">
      <div className="verdict-head">
        <span className={chipClass} role="status">
          {chip}
        </span>
        <strong id="holdout-title">{title}</strong>
      </div>
      {small ? (
        <p className="lede">
          <span className="tag thin" role="note">
            ◐ мало данных
          </span>{" "}
          Письмо получают {treatmentN < 5 ? "меньше 5" : treatmentN}, без письма остаются {controlN < 5 ? "меньше 5" : controlN}.
        </p>
      ) : status === "violated" ? (
        <p className="lede">{violatedReason(contamination)}</p>
      ) : (
        <>
          <p className="lede">
            Письмо получают {treatmentN}, без письма остаются {controlN}.
          </p>
          {showScale ? <DiffScale diff={diff} low={low} high={high} /> : null}
          {showScale ? <p className="lede">{zeroLine(low, high)}</p> : null}
          <p>{copy.body}</p>
          {status === "unchecked" ? (
            <p>
              Почему «не проверен»: {reasonText()}
            </p>
          ) : null}
          <p>{contaminationPlain(status, contamination)}</p>
        </>
      )}
      <MethodDetails summary="Как устроена группа без письма">
        <p>
          <Gloss title="холдаут — группа без письма для сравнения">Холдаут</Gloss> — группа без письма для сравнения.
          {copy.title.startsWith("Холдаут") ? " Холдаут нарушен." : ""}
        </p>
        <p>{contaminationLine(status, contamination)} Заражение — люди из группы «без письма» всё же получили письмо.</p>
      </MethodDetails>
      <hr className="rule" />
      {frozenText ? (
        <>
          <p className="source">
            Выручка людей без письма: {frozenText}. Это деньги, уже наблюдаемые у группы без письма, не прогноз.
            {seasonalText ? ` ${seasonalText}` : ""}
          </p>
          <MethodDetails summary="Откуда эта сумма">
            <p>Сумма людей без письма × их наблюдаемый повтор × средний чек. Это не доля и не прогноз.</p>
          </MethodDetails>
        </>
      ) : null}
    </section>
  );
}

function plainTitle(title: string): string {
  if (title.startsWith("Холдаут")) return "Сравнение сломано";
  return title;
}

function reasonText(): React.ReactNode {
  return withCodes("в срезе нет столбца received_email — письмо получено");
}

function contaminationLine(status: HoldoutState, contamination: number | null): string {
  if (status === "unchecked" || contamination === null) return "Заражение контроля: не измерено.";
  return `Заражение контроля: ${formatPct(contamination)} из допустимых ${formatPct(CONTAMINATION_LIMIT)}.`;
}

function contaminationPlain(status: HoldoutState, contamination: number | null): string {
  if (status === "unchecked" || contamination === null) {
    return "Пока не видно, дошло ли письмо людям, которых оставили без него.";
  }
  return `Среди тех, кого оставили без письма, письмо всё же дошло у ${formatPct(contamination)}. Допустимо не больше ${formatPct(CONTAMINATION_LIMIT)}.`;
}

function violatedReason(contamination: number | null): string {
  if (contamination !== null && contamination > CONTAMINATION_LIMIT) {
    return `Люди, которых оставили без письма, получили его чаще, чем в ${formatPct(CONTAMINATION_LIMIT)} случаев`;
  }
  return "Группы назначены не случайно";
}

function zeroLine(low: number, high: number): string {
  if (low < 0 && high > 0) return "Интервал задевает ноль: разница могла быть и в другую сторону.";
  if (low >= 0) return "Весь интервал выше нуля.";
  return "Весь интервал ниже нуля: без письма повтор был не реже.";
}
