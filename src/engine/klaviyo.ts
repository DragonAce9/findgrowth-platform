import { stageLabel } from "./client-copy";
import { letterDraft } from "./insights";
import { rankMoves } from "./move-rank";
import type { Pocket } from "./pipeline";

export interface KlaviyoStep {
  id: string;
  order: number;
  kind: "site" | "flow";
  name: string;
  send: boolean;
  size: number;
  revenue: number;
  who: string;
  when: string;
  product: string;
  subject: string;
  body: string;
  watch: string;
  /** One column of the next slice. Empty for a site card. */
  confirm: string;
}

export function mondayStep(steps: KlaviyoStep[], letters: boolean): KlaviyoStep | undefined {
  return rankMoves(steps, letters)[0];
}

export function moveBans(input: {
  letters: boolean;
  featured?: KlaviyoStep;
  steps: KlaviyoStep[];
  formulation?: string;
  constraint?: string;
  positioning?: string;
}): string[] {
  const bans: string[] = [];
  const featured = input.featured;
  if (featured?.kind === "flow") {
    bans.push("Не создавать письмо обрыва сайта в Klaviyo. Карточка правится на сайте.");
    bans.push("Не выгружать адреса, телефоны и идентификаторы. Сегмент задаётся условием «заказ оформлен».");
    const other = input.steps.find((step) => step.kind === "flow" && step.id !== featured.id);
    if (other) {
      bans.push(`Не включать второй сегмент в это письмо. Цепочку писем «${other.name}» на этой неделе не создавать.`);
    }
    bans.push("Не писать тем, кто не покупал.");
  } else {
    for (const step of input.steps.filter((step) => step.kind === "flow")) {
      bans.push(`Не включать цепочку писем «${step.name}»: нет основания для письма.`);
    }
    bans.push("Не выгружать адреса, телефоны и идентификаторы.");
  }
  const wall = [input.formulation, input.constraint, input.positioning].filter(Boolean).join(" ");
  if (/скидк/i.test(wall)) {
    bans.push("Не ставить скидку в тему письма: граница бренда это запрещает.");
  }
  return bans;
}

export const CONFIRM_COLUMN = "received_email";

/** Send window from the KM cycle. A missing median uses the category prior, never «день N–N». */
export function sendWindowText(cycle: {
  low: number;
  high: number;
  hazardPeak: number | null;
  fromData?: boolean;
  priorLow?: number;
  priorHigh?: number;
}): string {
  if (cycle.fromData === false) {
    const low = cycle.priorLow ?? 30;
    const high = cycle.priorHigh ?? 90;
    const base = `Своей медианы ещё нет: кривая не опустилась до половины. Окно — день ${low}–${high} из приора категории.`;
    if (cycle.hazardPeak !== null && Number.isFinite(cycle.hazardPeak) && cycle.hazardPeak > high) {
      return `${base} Пик хазарда — день ${Math.round(cycle.hazardPeak)}, за пределами окна: окно сжато к приору.`;
    }
    return base;
  }
  const span = `день ${cycle.low}–${cycle.high} с момента покупки`;
  if (cycle.hazardPeak === null || !Number.isFinite(cycle.hazardPeak)) return span;
  if (cycle.hazardPeak > cycle.high) {
    return `${span}. Пик хазарда — день ${Math.round(cycle.hazardPeak)}, за пределами окна: окно сжато к приору.`;
  }
  return `${span}, пик хазарда категории — день ${Math.round(cycle.hazardPeak)}`;
}

export function confirmColumnText(): string {
  return `В следующем срезе загрузите один столбец ${CONFIRM_COLUMN} — письмо получено — рядом с тем же идентификатором, что уже есть в вашей выгрузке (customer_id или order_id): 1 — письмо ушло, 0 — нет. Этот идентификатор сверяете со своей базой сами. Это не хеш и не почта. Без этого столбца снимок останется «не проверен».`;
}

export function klaviyoSteps(input: {
  pockets: Pocket[];
  cycleDays: number;
  letters: boolean;
  pair: { leftName: string; rightName: string; n: number } | null;
  stageLabels?: Record<string, string>;
  formulation?: string;
  constraint?: string;
  positioning?: string;
  cycle?: {
    low: number;
    high: number;
    hazardPeak: number | null;
    fromData?: boolean;
    priorLow?: number;
    priorHigh?: number;
  };
}): KlaviyoStep[] {
  const product = input.pair
    ? `${input.pair.rightName} после ${input.pair.leftName}`
    : "В письме не называть второй товар и не подставлять его: в заказах нет пар.";
  const onceCopy = letterDraft({
    kind: "once",
    pair: input.pair,
    formulation: input.formulation,
    constraint: input.constraint,
    positioning: input.positioning,
  });
  const againCopy = letterDraft({
    kind: "again",
    pair: input.pair,
    formulation: input.formulation,
    constraint: input.constraint,
    positioning: input.positioning,
  });
  const pairNote = input.pair ? `Пару купили ${input.pair.n} человек.` : "";
  const when = input.cycle ? sendWindowText(input.cycle) : "";
  const steps: KlaviyoStep[] = [];
  const drop = input.pockets.find((pocket) => pocket.id === "drop" || pocket.id === "friction");
  if (drop) {
    const from = stageLabel(drop.fromStage ?? "", "ru", input.stageLabels);
    const to = stageLabel(drop.toStage ?? "", "ru", input.stageLabels);
    steps.push({
      id: drop.id,
      order: 1,
      kind: "site",
      name: "Карточка товара",
      send: false,
      size: drop.size,
      revenue: drop.revenue,
      who: `Остановились: «${from}» → «${to}»`,
      when: "Не создавать в Klaviyo",
      product: "",
      subject: "",
      body: "Правится сайт, не письмо.",
      watch: "Доля «положили в корзину» на 30-й и 60-й день.",
      confirm: "",
    });
  }
  const once = input.pockets.find((pocket) => pocket.id === "risk");
  const again = input.pockets.find((pocket) => pocket.id === "lost");
  if (once) {
    steps.push({
      id: once.id,
      order: steps.length + 1,
      kind: "flow",
      name: "Одна покупка",
      send: input.letters,
      size: once.size,
      revenue: once.revenue,
      who: `Заказ оформлен (Placed Order) = 1, старше ${input.cycleDays} дн.`,
      when: when || `день ${input.cycleDays}–${input.cycleDays} с момента покупки`,
      product: [product, pairNote].filter(Boolean).join(". "),
      subject: onceCopy.subject,
      body: onceCopy.body,
      watch: "Новый заказ. Сегмент не пересекается со второй цепочкой писем.",
      confirm: confirmColumnText(),
    });
  }
  if (again) {
    steps.push({
      id: again.id,
      order: steps.length + 1,
      kind: "flow",
      name: "Уже возвращался",
      send: input.letters,
      size: again.size,
      revenue: again.revenue,
      who: `Заказ оформлен (Placed Order) ≥ 2, старше ${input.cycleDays} дн.`,
      when: when || `день ${input.cycleDays}–${input.cycleDays} с момента покупки`,
      product: [product, pairNote].filter(Boolean).join(". "),
      subject: againCopy.subject,
      body: againCopy.body,
      watch: "Новый заказ. Письмо короче. Без сегмента «Одна покупка».",
      confirm: confirmColumnText(),
    });
  }
  return rankMoves(steps, input.letters).map((step, index) => ({ ...step, order: index + 1 }));
}
