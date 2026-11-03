import type { ExperimentReadiness } from "./experiments";
import { rankMoves } from "./move-rank";
import type { Pocket } from "./pipeline";
import { guardK, wilsonInterval } from "./stats";
import type { MetricTable, OrderRow, Recommendation } from "./types";

export interface BriefBlock {
  title: string;
  body: string;
}

const STAGE_RU: Record<string, string> = {
  visit: "Зашли на сайт",
  pdp: "Открыли карточку",
  cta: "Нажали кнопку",
  checkout: "Дошли до оплаты",
  purchase: "Купили",
};

const STAGE_FR: Record<string, string> = {
  visit: "Visite",
  pdp: "Fiche produit",
  cta: "Clic sur le bouton",
  checkout: "Paiement",
  purchase: "Achat",
};

const CHANNEL_RU: Record<string, string> = {
  instagram: "Instagram",
  paid_search: "Платная выдача",
  paid_social: "Платная соцсеть",
  paid_other: "Другая платная реклама",
  organic: "Органика",
  organic_social: "Соцсети без рекламы",
  email: "Письмо",
  referral: "Переход с другого сайта",
  direct: "Прямой заход",
};

/** Screen copy. Components import phrases from here instead of inventing their own. */
export const RU_TERMS = {
  phone: "телефон",
  computer: "компьютер",
  tablet: "планшет",
  placedOrder: "Заказ оформлен",
  receivedEmail: "письмо получено",
  withoutLetter: "без письма",
  withLetter: "письмо получают",
  flow: "цепочка писем",
  live: "в работе",
  queue: "в очереди",
  holdout: "холдаут",
  holdoutGloss: "холдаут — группа без письма для сравнения",
  greenwood: "полоса Гринвуда",
  whiskers: "усы",
  hazardPeak: "пик хазарда",
  hazardPeakGloss: "день, когда вторая покупка вероятнее всего",
  zeroTick: "засечка на нуле",
  bucket: "ведро",
  bring: "что донести",
  confirmed: "Подтверждён",
  unchecked: "Не проверен",
  violated: "Нарушен",
  thin: "мало данных",
  hidden: "скрыто",
} as const;

export const DEVICE_RU: Record<string, string> = {
  mobile: RU_TERMS.phone,
  desktop: RU_TERMS.computer,
  tablet: RU_TERMS.tablet,
};

/** Live marts only. Anything else stays «подпись не задана» — do not invent a name. */
export const METRIC_RU: Record<string, string> = {
  identity_coverage: "Покрытие ключа покупателя",
  orphan_revenue: "Выручка без визита",
  attribution_first_touch: "Первый канал",
  site_funnel: "Воронка сайта",
  repeat_rate: "Доля повтора",
  experiment_exposures: "Показы тестов",
};

export const STATUS_RU = { shadow: "тень", challenger: "претендент", champion: "чемпион" } as const;

const NBSP = "\u00A0";
const MINUS = "\u2212";
const ENDASH = "\u2013";

function group(value: number, digits: number): string {
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: true,
  }).format(Math.abs(value));
  const normalized = formatted.replace(/[\u00A0\u202F]/g, NBSP);
  return value < 0 ? `${MINUS}${normalized}` : normalized;
}

/** Integer people, orders, keys. Grouping separator is U+00A0. */
export function formatCount(n: number): string {
  return group(Math.round(n), 0);
}

/** One decimal at most. Integers stay whole. Non-breaking space before %. */
export function formatPct(p: number): string {
  const shown = Math.round(p * 1000) / 10;
  const digits = Number.isInteger(shown) ? 0 : 1;
  return `${group(shown, digits)}${NBSP}%`;
}

export function formatBand(p: number, low: number, high: number): string {
  return `${formatPct(p)} (${formatPct(low)}${ENDASH}${formatPct(high)})`;
}

/** Difference of proportions, for prose and aria-label. Ends of a scale are separate numbers. */
export function formatPp(diff: number, low: number, high: number): string {
  const point = (value: number) => {
    const pp = Math.round(value * 1000) / 10;
    const digits = Number.isInteger(pp) ? 0 : 1;
    const body = group(Math.abs(pp), digits);
    if (pp > 0) return `+${body}`;
    if (pp < 0) return `${MINUS}${body}`;
    return body;
  };
  return `${point(diff)} п.п., интервал от ${point(low)} до ${point(high)} п.п.`;
}

/** Model metrics: no percent sign. Two decimal places, comma. */
export function formatRatio(value: number): string {
  return group(value, 2);
}

export function deviceLabel(device: string): string {
  return DEVICE_RU[device] ?? device;
}

export function metricCaption(name: string): string {
  return METRIC_RU[name] ?? "подпись не задана";
}

export function audienceGapNotice(snapshotN: number, segmentN: number): { seen: string; why: string; means: string } {
  return {
    seen: `В снимок попали ${formatCount(snapshotN)} из ${formatCount(segmentN)} человек сегмента.`,
    why: "У части людей сегмента нет ключа бренда, в списки они не входят.",
    means: `Списки «Кому / Кому не» — именно эти ${formatCount(snapshotN)}.`,
  };
}

const REASON_RU: Record<string, string> = {
  cf: "эти товары уже покупали вместе",
  category_popular: "следующая роль в категории",
  hero: "своих пар мало, показан товар с самым высоким повтором",
};

const REASON_FR: Record<string, string> = {
  cf: "achetés ensemble chez cette marque",
  category_popular: "rôle suivant le plus fréquent dans la catégorie",
  hero: "peu de paires propres, produit au plus fort réachat du rôle",
};

export function brandLabel(brandId: string): string {
  if (brandId === "demo-full") return "Atelier";
  if (brandId === "rees46-cosmetics") return "Магазин косметики";
  if (brandId === "upload") return "Загрузка";
  return brandId;
}

export function projectLabel(config: { brandId: string; projectName?: string }): string {
  const named = config.projectName?.trim();
  return named || brandLabel(config.brandId);
}

export function accountLabel(tenantId?: string): string {
  if (!tenantId) return "Нет аккаунта";
  if (tenantId === "demo") return "Демо-аккаунт";
  return tenantId;
}

export function isDemoData(config: { brandId: string }): boolean {
  return config.brandId === "demo-full";
}

export function stageLabel(stage: string, lang: "ru" | "fr", overrides?: Record<string, string>): string {
  if (lang === "ru" && overrides?.[stage]) return overrides[stage];
  const map = lang === "ru" ? STAGE_RU : STAGE_FR;
  return map[stage] ?? stage;
}

export function ruDate(iso: string): string {
  const months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${Number(day)} ${months[Number(month) - 1] ?? ""} ${year}`;
}

export function formatMoney(value: number, currency?: string): string {
  const amount = formatCount(value);
  const unit = currency && currency.trim() ? currency.trim() : "у. е.";
  return `${amount} ${unit}`;
}

export function channelLabel(channel: string): string {
  return CHANNEL_RU[channel] ?? channel;
}

export function reasonLabel(reason: string, lang: "ru" | "fr"): string {
  const map = lang === "ru" ? REASON_RU : REASON_FR;
  return map[reason] ?? reason;
}

export function studioBrief(input: {
  asOf: string;
  windowDays: number;
  coverage: number;
  orphanRevenue: number;
  repeat: number;
  mature: number;
  repeated: number;
  funnel: MetricTable | undefined;
  experiments: ExperimentReadiness[];
}): BriefBlock[] {
  return [
    dataBlock(input),
    funnelBlock(input.funnel),
    repeatBlock(input),
    experimentsBlock(input.experiments),
  ];
}

export function reportBrief(input: {
  asOf: string;
  windowDays: number;
  replenishment: string;
  coverage: number;
  orphanRevenue: number;
  repeat: number;
  mature: number;
  repeated: number;
  funnel: MetricTable | undefined;
  experiments: ExperimentReadiness[];
  pockets: Pocket[];
  recommendations: Recommendation[];
  fallbackRate: number | null;
  hitRate: number | null;
  hitRatePopular: number | null;
}): { ru: BriefBlock[]; fr: BriefBlock[] } {
  const shared = studioBrief(input);
  return {
    ru: [
      {
        title: "Что уходит клиенту",
        body: `Срез на ${formatDate(input.asOf)}. Документ говорит, можно ли верить стыковке заказов с сайтом, где люди останавливаются, какая доля возвращается за ${input.windowDays} дней, какой тест можно читать, и какие три действия сделать. Цикл дозаказа для этих действий: ${input.replenishment} дней. Окно повторной покупки: ${input.windowDays} дней.`,
      },
      ...shared,
      actionsBlock(input.pockets, input.windowDays, input.replenishment),
      recsBlock(input),
    ],
    fr: frenchLetter(input),
  };
}

function dataBlock(input: { coverage: number; orphanRevenue: number }): BriefBlock {
  const trust =
    input.coverage >= 0.2
      ? "Стыковка достаточная: каналы и рекомендации можно читать."
      : "Стыковка слабая. Сначала нужен общий идентификатор визита и заказа. Каналы в этом состоянии картину марки не держат.";
  return {
    title: "Данные",
    body: `${pct(input.coverage)} выручки заказов нашлось у человека, который был на сайте. Это сумма, не доля. Заказы без визита: ${money(input.orphanRevenue)}. ${trust}`,
  };
}

function funnelBlock(funnel: MetricTable | undefined): BriefBlock {
  const rows = funnel?.rows ?? [];
  const visit = num(rows.find((row) => row.stage === "visit")?.lifetime);
  const purchase = num(rows.find((row) => row.stage === "purchase")?.lifetime);
  const recentVisit = num(rows.find((row) => row.stage === "visit")?.last_90d);
  const recentPurchase = num(rows.find((row) => row.stage === "purchase")?.last_90d);
  const drop = biggestDrop(rows);
  return {
    title: "Сайт",
    body: `За всё время зашли ${visit} человек, купили ${purchase}. ${drop} За последние 90 дней зашли ${recentVisit}, купили ${recentPurchase}: свежие визиты в это окно ещё не доходят до заказа.`,
  };
}

function repeatBlock(input: { windowDays: number; repeat: number; mature: number; repeated: number }): BriefBlock {
  return {
    title: "Возврат",
    body: `Окно марки: ${input.windowDays} дней после первой покупки. В нём ${input.repeated} из ${input.mature} зрелых покупателей купили ещё раз (${pct(input.repeat)}). Отмены, возвраты и продления подписки в эту долю не входят. Кто купил впервые меньше ${input.windowDays} дней назад, в эту долю не входит.`,
  };
}

function experimentsBlock(experiments: ExperimentReadiness[]): BriefBlock {
  const lines = experiments.map((item) => {
    if (item.ready) {
      return `${item.experiment_id}: тест можно читать. Людей достаточно, доли вариантов сходятся с планом, идёт дольше недели.`;
    }
    return `${item.experiment_id}: вариант в этом прогоне не выкатываем. ${item.blockers.map(blockerRu).join(". ")}.`;
  });
  return {
    title: "Тесты",
    body: lines.join(" "),
  };
}

function actionsBlock(pockets: Pocket[], windowDays: number, replenishment: string): BriefBlock {
  const lines = pockets.map((pocket) => actionLine(pocket, windowDays, replenishment));
  return {
    title: "Три действия",
    body: lines.join(" "),
  };
}

function actionLine(pocket: Pocket, windowDays: number, replenishment: string): string {
  if (pocket.id === "drop" || pocket.id === "friction") {
    return `Сайт: ${pocket.fromCount ?? "?"} на шаге ${pocket.fromStage ?? "предыдущем"}, ${pocket.toCount ?? "?"} на шаге ${pocket.toStage ?? "следующем"}. Разница ${pocket.size}. Сначала этот обрыв. Через 30 и 60 дней смотреть, сколько дойдут до следующего шага.`;
  }
  if (pocket.id === "lost") {
    return `Короткое письмо тем, кто уже покупал второй раз и молчит дольше ${replenishment} дней: ${pocket.size} человек. ${money(pocket.revenue)} уже заплачено, это не ставка письма. В список одной покупки они не входят. Окно возврата остаётся ${windowDays} дней.`;
  }
  return `Письмо тем, кто купил один раз и молчит дольше ${replenishment} дней: ${pocket.size} человек. ${money(pocket.revenue)} уже заплачено. Смотреть повторные покупки на 30-й и 60-й день.`;
}

function recsBlock(input: {
  recommendations: Recommendation[];
  fallbackRate: number | null;
  hitRate: number | null;
  hitRatePopular: number | null;
  windowDays: number;
}): BriefBlock {
  const counts = countReasons(input.recommendations);
  const quality =
    input.hitRate === null
      ? `Сравнение с прошлым списком появится, когда после прошлого отчёта пройдёт ${input.windowDays} дней.`
      : `Прошлый список купили в ${pct(input.hitRate)} случаев. Самый частый товар той же роли в том же окне купили в ${pct(input.hitRatePopular ?? 0)} случаев.`;
  return {
    title: "Что предложить следующим",
    body: `В списке для клиента ${input.recommendations.length} позиций. Совместные покупки: ${counts.cf}. Роль в категории: ${counts.category_popular}. Товар с высоким повтором: ${counts.hero}. Доля запаса: ${pct(input.fallbackRate ?? 0)}. ${quality}`,
  };
}

function frenchLetter(input: {
  asOf: string;
  windowDays: number;
  replenishment: string;
  coverage: number;
  orphanRevenue: number;
  repeat: number;
  mature: number;
  repeated: number;
  funnel: MetricTable | undefined;
  experiments: ExperimentReadiness[];
  pockets: Pocket[];
  recommendations: Recommendation[];
  fallbackRate: number | null;
  hitRate: number | null;
  hitRatePopular: number | null;
}): BriefBlock[] {
  const rows = input.funnel?.rows ?? [];
  const visit = num(rows.find((row) => row.stage === "visit")?.lifetime);
  const purchase = num(rows.find((row) => row.stage === "purchase")?.lifetime);
  const counts = countReasons(input.recommendations);
  const tests = input.experiments
    .map((item) =>
      item.ready
        ? `${item.experiment_id} peut être lu : effectif, parts et durée sont en ordre.`
        : `${item.experiment_id} ne part pas en production : ${item.blockers.join(", ")}.`,
    )
    .join(" ");
  const hit =
    input.hitRate === null
      ? `La comparaison avec la liste précédente attend ${input.windowDays} jours après ce rapport.`
      : `L'ancienne liste a été achetée dans ${pct(input.hitRate)} des cas, le SKU fréquent du même rôle dans ${pct(input.hitRatePopular ?? 0)}.`;
  return [
    {
      title: "Lecture",
      body: `Arrêt au ${input.asOf}. ${pct(input.coverage)} du chiffre des commandes est relié à une visite. Commandes sans visite : ${money(input.orphanRevenue)}.`,
    },
    {
      title: "Site et réachat",
      body: `${visit} personnes sont venues, ${purchase} ont acheté. Parmi ${input.mature} acheteurs assez âgés, ${input.repeated} ont racheté dans les ${input.windowDays} jours (${pct(input.repeat)}). Le cycle de réassort du diagnostic est ${input.replenishment} jours.`,
    },
    {
      title: "Tests",
      body: tests,
    },
    {
      title: "Actions",
      body: input.pockets
        .map((pocket) => `${pocket.title} : ${pocket.size} personnes. ${pocket.who}. Canal : ${pocket.id === "friction" ? "fiche produit" : "email"}. Lecture à 30 et 60 jours.`)
        .join(" "),
    },
    {
      title: "Prochain produit",
      body: `${input.recommendations.length} lignes. Paires observées : ${counts.cf}. Rôle de catégorie : ${counts.category_popular}. Produit à fort réachat : ${counts.hero}. Part de repli : ${pct(input.fallbackRate ?? 0)}. ${hit}`,
    },
  ];
}

export interface TldrItem {
  tone: "up" | "down";
  text: string;
}

export function tldrItems(input: {
  coverage: number;
  orphanRevenue: number;
  windowDays: number;
  repeat: number;
  mature: number;
  repeated: number;
  funnel: MetricTable | undefined;
  experiments: ExperimentReadiness[];
}): TldrItem[] {
  const ready = input.experiments.filter((item) => item.ready).map((item) => item.experiment_id);
  const blocked = input.experiments.filter((item) => !item.ready);
  return [
    {
      tone: input.coverage >= 0.2 ? "up" : "down",
      text: `${pct(input.coverage)} выручки заказов нашлось у посетителя сайта. Без визита: ${money(input.orphanRevenue)}.`,
    },
    { tone: "down", text: funnelBlock(input.funnel).body },
    {
      tone: "up",
      text: `${input.repeated} из ${input.mature} купили второй раз в окне ${input.windowDays} дней (${pct(input.repeat)}).`,
    },
    {
      tone: blocked.length ? "down" : "up",
      text: `${ready.join(", ") || "нет теста"} можно читать. ${blocked.map((item) => `${item.experiment_id}: ${item.blockers.map(blockerRu).join(", ")}`).join(" ")}`.trim(),
    },
  ];
}

export interface ClientAction {
  id: string;
  priority: "high" | "medium";
  title: string;
  who: string;
  why: string;
  when: string;
  measure: string;
}

export function clientActions(
  pockets: Pocket[],
  input: {
    cycle: string;
    asOf: string;
    currency?: string;
    stageLabels?: Record<string, string>;
    letters?: boolean;
    letterReason?: string;
  },
): ClientAction[] {
  const paid = (value: number) => formatMoney(value, input.currency);
  const cards: ClientAction[] = pockets.map((pocket) => {
    if (pocket.id === "drop" || pocket.id === "friction") {
      const from = stageLabel(pocket.fromStage ?? "", "ru", input.stageLabels);
      const to = stageLabel(pocket.toStage ?? "", "ru", input.stageLabels);
      const scrolled =
        pocket.friction && pocket.fromStage === "pdp"
          ? ` ${formatCount(pocket.friction)} из оставшихся на карточке долистали её и не нажали кнопку.`
          : "";
      return {
        id: pocket.id,
        priority: "medium" as const,
        title: `${formatCount(pocket.size)} не перешли: ${from} → ${to}`,
        who: `«${from}» — ${formatCount(pocket.fromCount ?? 0)}. «${to}» — ${formatCount(pocket.toCount ?? 0)}.`,
        why: `Это самый большой обрыв сайта в этом срезе.${scrolled}`,
        when: `На неделе до ${input.asOf}`,
        measure: "Сколько дойдут до следующего шага на 30-й и 60-й день",
      };
    }
    if (pocket.id === "lost" || pocket.id === "risk") {
      const once = pocket.id === "risk";
      const hold = input.letters !== true;
      return {
        id: pocket.id,
        priority: "medium" as const,
        title: hold
          ? once
            ? `${pocket.size} купили один раз`
            : `${pocket.size} уже возвращались`
          : once
            ? "Письмо тем, кто купил один раз"
            : "Короткое письмо тем, кто уже возвращался",
        who: `${pocket.size} человек. Последняя покупка старше ${input.cycle} дней.`,
        why: once
          ? `Второй покупки нет. ${paid(pocket.revenue)} — уже заплачено, это не ставка письма.`
          : `Вторую покупку они уже делали и в список одной покупки не входят. ${paid(pocket.revenue)} — уже заплачено, это не ставка письма.`,
        when: hold ? `На неделе до ${input.asOf}. Отправку платформа не ставит` : `На неделе до ${input.asOf}`,
        measure: hold ? "Размер группы. Письмо не уходит." : "Сколько снова купят на 30-й и 60-й день",
      };
    }
    return {
      id: pocket.id,
      priority: "medium" as const,
      title: pocket.title,
      who: pocket.who,
      why: "",
      when: `На неделе до ${input.asOf}`,
      measure: "Размер группы",
    };
  });
  const letters = input.letters === true;
  const ranked = rankMoves(
    cards.map((card) => ({ ...card, revenue: pockets.find((pocket) => pocket.id === card.id)?.revenue ?? 0 })),
    letters,
  );
  return ranked.map((card, index) => ({
    id: card.id,
    priority: (index === 0 ? "high" : "medium") as ClientAction["priority"],
    title: card.title,
    who: card.who,
    why: card.why,
    when: card.when,
    measure: card.measure,
  }));
}

export function letterPermissionLine(input: { letters: boolean; reason: string }): string {
  if (input.letters && /согласи/i.test(input.reason)) {
    return "Письмо тем, кто купил один раз, можно: в файле есть согласие на электронную рекламу.";
  }
  if (input.letters) {
    return "Письмо тем, кто уже покупал, можно: при сборе им сказали о похожих товарах, и отказ бесплатный.";
  }
  if (/исследован/i.test(input.reason)) {
    return "Письмо тем, кто купил один раз, нельзя: файл собран для исследования, это не ваша база покупателей.";
  }
  return "Письмо тем, кто купил один раз, нельзя: нет согласия на рекламу и нет отметки, что покупателю сказали о похожих товарах.";
}

/** Short sentences for the week lead. `weekVerdict` is the same text in one line. */
export function weekVerdictParts(input: {
  letters: boolean;
  cycleDays: number;
  once?: { size: number; revenue: number };
  again?: { size: number; revenue: number };
  drop?: { size: number; revenue: number };
  pair: { leftName: string; rightName: string; n: number } | null;
  hitRate: number | null;
  allPastCycle: boolean;
  buyersN: number;
  currency?: string;
}): string[] {
  const paid = (value: number) => formatMoney(value, input.currency);
  const product = input.pair
    ? `В письме назвать «${input.pair.rightName}» после «${input.pair.leftName}»: эти два товара уже покупали вместе.`
    : "В письме не называть второй товар: в заказах нет пар.";
  const past = input.hitRate === null ? "Прошлого списка нет." : "Прошлый список уже можно сравнить с частым товаром той же роли.";
  const cycle = `Цикл — обычное число дней до второй покупки, здесь ${input.cycleDays}.`;
  const age = input.allPastCycle
    ? `Все ${formatCount(input.buyersN)} покупателей уже старше этого срока.`
    : "Не все покупатели старше этого срока.";
  const tail = [past, cycle, age];
  if (input.letters && input.once) {
    return [
      `Писать тем, кто купил один раз: ${formatCount(input.once.size)} человек, ${paid(input.once.revenue)} уже получены.`,
      product,
      "Второй ход — поменять карточку товара на сайте, а не слать второе письмо.",
      ...tail,
    ];
  }
  if (input.letters && input.again) {
    return [
      `Писать тем, кто уже возвращался: ${formatCount(input.again.size)} человек, ${paid(input.again.revenue)} уже получены.`,
      product,
      "Второй ход — поменять карточку товара на сайте, а не слать второе письмо.",
      ...tail,
    ];
  }
  if (!input.letters) {
    const site = input.drop
      ? input.drop.revenue > 0
        ? `Первый ход — поменять карточку товара на сайте, а не слать письмо: ${formatCount(input.drop.size)} человек, ${paid(input.drop.revenue)} уже получены.`
        : `Первый ход — поменять карточку товара на сайте, а не слать письмо: ${formatCount(input.drop.size)} человек так и не дошли до корзины, денег с этого обрыва ещё нет.`
      : "Первый ход — поменять карточку товара на сайте, а не слать письмо.";
    return ["Письмо тем, кто купил один раз, нельзя.", site, "Списков письма нет.", ...tail];
  }
  return ["Хода на письмо в этой выгрузке нет.", ...tail];
}

export function weekVerdict(input: Parameters<typeof weekVerdictParts>[0]): string {
  return weekVerdictParts(input).join(" ");
}

export function decisionLabel(ready: boolean, blockers: string[]): string {
  if (ready) return "можно читать";
  return blockers.map(blockerRu).join(". ");
}

function blockerRu(blocker: string): string {
  if (blocker.includes("50")) return "в одном варианте меньше 50 человек";
  if (blocker.includes("SRM")) return "доли вариантов не сходятся с планом";
  if (blocker.includes("7")) return "тест идёт меньше 7 дней";
  return blocker;
}

function biggestDrop(rows: MetricTable["rows"]): string {
  let best = 0;
  let from = "";
  let to = "";
  let fromN = 0;
  let toN = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const drop = num(rows[i - 1].lifetime) - num(rows[i].lifetime);
    if (drop > best) {
      best = drop;
      from = String(rows[i - 1].stage);
      to = String(rows[i].stage);
      fromN = num(rows[i - 1].lifetime);
      toN = num(rows[i].lifetime);
    }
  }
  if (!best) return "Между шагами воронки обрыва нет.";
  return `Самый большой обрыв: ${stageLabel(from, "ru").toLowerCase()} ${fromN} → ${stageLabel(to, "ru").toLowerCase()} ${toN}.`;
}

function countReasons(lines: Recommendation[]): Record<"cf" | "category_popular" | "hero", number> {
  return {
    cf: lines.filter((line) => line.reason === "cf").length,
    category_popular: lines.filter((line) => line.reason === "category_popular").length,
    hero: lines.filter((line) => line.reason === "hero").length,
  };
}

function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export function pct(value: number): string {
  return formatPct(value);
}

export function ruBand(p: number, low: number, high: number): string {
  return formatBand(p, low, high);
}

/** Wilson band for a person-rate. Null when the person count is in (0, 5) or the denominator is empty. */
export function personRateBand(successes: number, n: number): string | null {
  if (!(n > 0) || guardK(n) === null) return null;
  const band = wilsonInterval(successes, n);
  return ruBand(band.p, band.low, band.high);
}

/** Wilson band for a count of orders joined to a visit. Revenue coverage stays a sum, not this rate. */
export function orderCoverageBand(orders: Pick<OrderRow, "orphan" | "countsAsOrder">[]): string | null {
  const rows = orders.filter((order) => order.countsAsOrder !== false);
  const matched = rows.filter((order) => !order.orphan).length;
  return personRateBand(matched, rows.length);
}

/** Revenue coverage is matched euros over all euros. The percent is a sum, not a binomial rate. */
export function revenueShareLine(input: { coverage: number; orderBand: string | null; joined?: string; all?: string }): string {
  const amounts = input.joined && input.all ? `: ${input.joined} из ${input.all}` : "";
  const orders = input.orderBand ? `По числу заказов: ${input.orderBand}.` : "Заказов меньше 5, долю заказов не показываем.";
  const stop = amounts.endsWith(".") ? "" : ".";
  return `${pct(input.coverage)} выручки${amounts}${stop} Это сумма, не доля. ${orders}`;
}

function money(value: number): string {
  return `${Math.round(value)} €`;
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}.${month}.${year}`;
}
