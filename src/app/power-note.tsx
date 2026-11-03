import React from "react";
import { formatCount } from "@/engine/client-copy";
import { nControlForEffect } from "@/engine/experiments";
import { MethodDetails } from "./glossary";

/** Plain power line. Alpha, power 0.8 and the prior stay in the disclosure. */
export function PowerNote({
  controlN,
  repeatP,
  repeatN,
  repeatText,
  effectPp = 5,
  letters = true,
}: {
  controlN: number;
  repeatP: number;
  repeatN: number;
  repeatText: string;
  effectPp?: number;
  letters?: boolean;
}) {
  if (!letters) return null;
  if (repeatN < 5) {
    return <p className="source">Доля повтора по меньше чем пяти зрелым покупателям — число «нужно» не считаем.</p>;
  }
  const need = nControlForEffect(repeatP, effectPp);
  const finite = Number.isFinite(need);
  const canDecide = finite && controlN >= need;
  const controlPeople = controlN < 5 ? "меньше 5 человек" : `${formatCount(controlN)} человек`;
  const needed = finite ? formatCount(need) : "—";
  const line = `Без письма ${controlPeople} — для надёжного сравнения нужно ${needed} без письма.`;
  return (
    <section
      className={canDecide ? "verdict ok" : "verdict wait"}
      aria-label={`Мощность: ${controlN < 5 ? "меньше 5" : formatCount(controlN)} без письма, нужно ${needed}`}
    >
      <strong>{canDecide ? "Решение возможно" : "Цифра шаткая"}</strong>
      <p>
        {canDecide
          ? `${line} Людей уже хватает: решение возможно.`
          : `${line} Пока цифра шаткая: либо копите людей, либо пишите всем, но не ждите точного вывода.`}
      </p>
      <MethodDetails summary="Как посчитано число «нужно»">
        <p>
          При доле повтора {repeatText}. Число «нужно» считается от наблюдаемой доли, α = 0,05, мощность 0,8. α = 0,05 — порог, при
          котором случайную разницу ещё считают заметной. Мощность 0,8 — шанс заметить разницу, если она и правда есть.
        </p>
        {canDecide ? (
          <p>Мощность 0,8 достигнута: решение возможно.</p>
        ) : (
          <p>
            Пока людей мало, этот срез даёт только накопление в приор, не решение. Приор — то, что накоплено с прошлых срезов, до этого
            письма.
          </p>
        )}
      </MethodDetails>
    </section>
  );
}
