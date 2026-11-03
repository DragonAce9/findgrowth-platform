import { formatMoney, stageLabel } from "@/engine/client-copy";
import { rankMoves } from "@/engine/move-rank";
import type { Pocket } from "@/engine/pipeline";

export interface ProblemCard {
  id: string;
  lane: "main" | "not-site" | "not-second" | "held";
  problem: string;
  what: string;
  result: string;
  solution: string;
}

/** One pass of the three groups. The full sentences stay on the brief cards. */
export function CohortGrid({
  pockets,
  cycleDays,
  letters,
  stageLabels,
  currency,
}: {
  pockets: Pocket[];
  cycleDays: number;
  letters: boolean;
  stageLabels?: Record<string, string>;
  currency?: string;
}) {
  const cards = problemCards({ pockets, cycleDays, letters, stageLabels, currency });
  if (!cards.length) {
    return <p className="lede">Когорты хода в этом срезе нет. Обрыва сайта и молчащих покупателей старше цикла не видно.</p>;
  }
  return (
    <div className="problem-grid">
      {cards.map((card) => {
        const parts = card.what.split(/(?<=\.)\s+/);
        const rule = parts[0] ?? card.what;
        const why = parts.slice(1).join(" ");
        return (
          <article key={card.id} className={card.lane === "main" ? "problem-card main" : "problem-card"}>
            <strong>{card.problem}</strong>
            <p>{rule}</p>
            {why ? <p className="lede">{why}</p> : null}
          </article>
        );
      })}
    </div>
  );
}

export function BriefLink({ href }: { href: string }) {
  return (
    <p className="lede">
      <a href={href}>Когорта и правило — в брифе</a>
    </p>
  );
}

export function CutLede({
  pockets,
  cycleDays,
  letters,
  stageLabels,
  currency,
}: {
  pockets: Pocket[];
  cycleDays: number;
  letters: boolean;
  letterReason?: string;
  pair?: { leftName: string; rightName: string; n: number } | null;
  stageLabels?: Record<string, string>;
  currency?: string;
}) {
  const cards = problemCards({ pockets, cycleDays, letters, stageLabels, currency });
  if (!cards.length) {
    return (
      <div className="lede-parts">
        <p>
          <strong>Проблем в этом срезе нет.</strong> Обрыва сайта и молчащих покупателей старше цикла не видно.
        </p>
      </div>
    );
  }
  const main = cards.find((card) => card.lane === "main") ?? cards[0];
  const rest = cards.filter((card) => card.id !== main.id);
  return (
    <div className="cut-lede">
      <ProblemArticle card={main} kicker={laneKicker(main.lane, letters)} featured />
      {rest.length ? (
        <div className="problem-grid why-not">
          {rest.map((card) => (
            <ProblemArticle key={card.id} card={card} kicker={laneKicker(card.lane, letters)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function laneKicker(lane: ProblemCard["lane"], letters: boolean): string {
  if (lane === "main") return "Главная проблема";
  if (lane === "not-site") return "Почему не сайт";
  if (lane === "not-second") return "Почему не второй список";
  return letters ? "Дальше" : "Письмо не ставить";
}

function ProblemArticle({
  card,
  kicker,
  featured = false,
}: {
  card: ProblemCard;
  kicker: string;
  featured?: boolean;
}) {
  return (
    <article className={featured ? "problem-card main monday" : "problem-card monday"}>
      <div className="proof-kicker">{kicker}</div>
      <dl>
        <div>
          <dt>Проблема</dt>
          <dd>{card.problem}</dd>
        </div>
        <div>
          <dt>Правило</dt>
          <dd>{card.what}</dd>
        </div>
        <div>
          <dt>Что видно</dt>
          <dd>{card.result}</dd>
        </div>
        <div>
          <dt>Ход</dt>
          <dd>{card.solution}</dd>
        </div>
      </dl>
    </article>
  );
}

export function problemCards(input: {
  pockets: Pocket[];
  cycleDays: number;
  letters: boolean;
  letterReason?: string;
  pair?: { leftName: string; rightName: string; n: number } | null;
  stageLabels?: Record<string, string>;
  currency?: string;
}): ProblemCard[] {
  const paid = (value: number) => formatMoney(value, input.currency);
  const hold = "Письмо не ставить. Список оставить видимым.";
  const cards = input.pockets.map((pocket) => {
    if (pocket.id === "drop" || pocket.id === "friction") {
      const from = stageLabel(pocket.fromStage ?? "", "ru", input.stageLabels);
      const to = stageLabel(pocket.toStage ?? "", "ru", input.stageLabels);
      const scrolled =
        pocket.friction && pocket.fromStage === "pdp"
          ? ` ${pocket.friction} из тех, кто остался на карточке, долистали её и кнопку не нажали.`
          : "";
      const unpaid = pocket.revenue > 0
        ? `${paid(pocket.revenue)} в кассе обрыва — не ставка письма.`
        : "Здесь ещё нет оплаченного.";
      return {
        id: pocket.id,
        lane: "not-site" as const,
        problem: "Обрыв на сайте",
        what: `Люди доходят до шага «${from}» и не переходят к «${to}». Это не письмо: человек ещё ничего не купил.`,
        result: `${pocket.fromCount ?? 0} были на «${from}», ${pocket.toCount ?? 0} дошли до «${to}». Разница ${pocket.size} человек.${scrolled} ${unpaid} Это не главная ставка.`,
        solution: "Править карточку товара. Письмо и сегмент в Klaviyo не создавать. Через 30 и 60 дней — доля следующего шага.",
      };
    }
    if (pocket.id === "risk") {
      return {
        id: pocket.id,
        lane: "main" as const,
        problem: "Купили один раз и молчат",
        what: `После первой оплаты прошло больше ${input.cycleDays} дней, второй покупки нет. В список тех, кто уже возвращался, не входят.`,
        result: `${pocket.size} человек. ${paid(pocket.revenue)} уже заплачено — это не ставка письма.`,
        solution: input.letters
          ? `Отдельная цепочка писем «Одна покупка»: ждать ${input.cycleDays} дней после первого заказа. Через 30 и 60 дней смотреть новый заказ.`
          : hold,
      };
    }
    if (pocket.id === "lost") {
      return {
        id: pocket.id,
        lane: "not-second" as const,
        problem: "Уже возвращались и снова молчат",
        what: `Вторую покупку эти люди уже делали, но с последней оплаты прошло больше ${input.cycleDays} дней. В список «одна покупка» они не входят.`,
        result: `${pocket.size} человек. ${paid(pocket.revenue)} уже заплачено — это не ставка письма. Это второй список, не ход этой недели.`,
        solution: input.letters
          ? "Не включать в письмо одной покупки. Отдельная короткая цепочка писем «Уже возвращался» — не на этой неделе."
          : hold,
      };
    }
    return {
      id: pocket.id,
      lane: "held" as const,
      problem: pocket.title,
      what: pocket.who,
      result: `${pocket.size} человек.`,
      solution: "Отдельного хода в этом срезе нет.",
    };
  });
  const ranked = rankMoves(
    cards.map((card) => ({ ...card, revenue: input.pockets.find((pocket) => pocket.id === card.id)?.revenue ?? 0 })),
    input.letters,
  );
  return ranked.map((card, index) => {
    let lane: ProblemCard["lane"] = "held";
    if (index === 0) lane = "main";
    else if (card.id === "drop" || card.id === "friction") lane = "not-site";
    else if (card.id === "lost") lane = "not-second";
    return {
      id: card.id,
      lane,
      problem: card.problem,
      what: card.what,
      result: card.result,
      solution: card.solution,
    };
  });
}
