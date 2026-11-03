import React, { type ReactNode } from "react";

/** First-use gloss. The word stays; the tip says what it is. */
export const CUT_GLOSS = "срез — выгрузка магазина на одну дату: события и заказы до этого дня";

export const CYCLE_GLOSS = "цикл — обычное число дней до второй покупки";

export const PP_GLOSS = "п.п. — процентный пункт: разница двух долей";

export const CONTROL_GLOSS = "без письма — люди, которым письмо не отправляют, чтобы сравнить повтор";

const TERMS = [
  { word: "срез", gloss: CUT_GLOSS },
  { word: "цикл", gloss: CYCLE_GLOSS },
  { word: "п.п.", gloss: PP_GLOSS },
  { word: "без письма", gloss: CONTROL_GLOSS },
];

const METHODS = [
  { word: "Ньюкомб", gloss: "способ посчитать коридор разницы двух долей" },
  { word: "приор", gloss: "то, что накоплено с прошлых срезов, до этого письма" },
  { word: "заражение", gloss: "люди из группы «без письма» всё же получили письмо" },
  { word: "усадка", gloss: "доля притянута к общей, потому что в маленькой группе случайный всплеск недостоверен" },
  { word: "Бенджамини–Хохберг", gloss: "поправка, когда сравнивается много групп сразу" },
  { word: "хазард", gloss: "день, когда вторая покупка вероятнее всего" },
  { word: "холдаут", gloss: "группа без письма для сравнения" },
  { word: "постериор", gloss: "коридор доли после того, как её притянули к общей" },
  { word: "α = 0,05", gloss: "порог, при котором случайную разницу ещё считают заметной" },
  { word: "мощность 0,8", gloss: "шанс заметить разницу, если она и правда есть" },
];

export function Gloss({ title, children }: { title: string; children: ReactNode }) {
  return <span title={title}>{children}</span>;
}

export function Glossary() {
  return (
    <details className="method-note">
      <summary>Словарь</summary>
      <dl className="glossary">
        {TERMS.map((item) => (
          <div key={item.word}>
            <dt>{item.word}</dt>
            <dd>{item.gloss}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** Method names stay in the product, behind the same collapsed pattern. */
export function MethodGlossary() {
  return (
    <details className="method-note">
      <summary>Названия методов</summary>
      <dl className="glossary">
        {METHODS.map((item) => (
          <div key={item.word}>
            <dt>{item.word}</dt>
            <dd>{item.gloss}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function MethodDetails({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="method-note">
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
