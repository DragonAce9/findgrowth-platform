import React from "react";
import { formatMoney } from "@/engine/client-copy";
import { evidenceState } from "@/engine/stats";
import type { CohortLtv } from "@/engine/unit-econ";
import { EvidenceBadge } from "./evidence";

const ENDASH = "\u2013";

/** Three horizons always. A horizon nobody has lived through stays on screen as hidden. */
export function CohortLtvTable({ cohorts, currency = "" }: { cohorts: CohortLtv[]; currency?: string }) {
  return (
    <>
      <div className="unit-grid cohort-grid">
        {cohorts.map((row) => (
          <CohortCard key={row.horizon} row={row} currency={currency} />
        ))}
      </div>
      <p className="lede">
        Когорта здесь — покупатели, у которых с первой оплаты уже прошло столько дней, сколько на карточке. Сумма — деньги, которые они уже заплатили за эти дни после первой покупки. Это не люди одного календарного месяца и не список письма.
      </p>
      <p className="source">
        Уже заплаченное внутри горизонта, только у тех, кто горизонт прожил. Не ARPU ÷ отток. Интервал — бутстреп по людям.
      </p>
    </>
  );
}

function CohortCard({ row, currency }: { row: CohortLtv; currency: string }) {
  const hidden = evidenceState(row.n, "people").level === "hidden" || row.n === 0;
  const small = row.n > 0 && row.n < 5;
  const money = (value: number) => formatMoney(value, currency);
  const band = `${money(row.low)}${ENDASH}${money(row.high)}`;
  let note = `людей ${row.n}`;
  if (row.n === 0) note = `ни один покупатель не прожил ${row.horizon} дней`;
  else if (small) note = `меньше 5 покупателей прожили ${row.horizon} дней: сумму не показываем`;
  return (
    <article className="unit-card" aria-label={`${row.horizon} дней`}>
      {row.n === 0 ? <div className="tag hidden">▧ СКРЫТО</div> : <div className="unit-src file">ФАЙЛ</div>}
      <div className={hidden || small ? "val text" : "val"}>{hidden || small ? "—" : money(row.ltv)}</div>
      {hidden || small ? null : <p className="band">{band}</p>}
      <div className="name">{row.horizon} дней</div>
      <p>
        {note} <EvidenceBadge n={row.n} rule="people" />
      </p>
    </article>
  );
}
