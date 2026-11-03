import { pilotChecklist, type PilotChecklist } from "./pilot";
import type { RawEvent, RawNps, RawOrder } from "./types";

export interface RecognizedItem {
  id: string;
  found: boolean;
  title: string;
  detail: string;
}

export interface WantedSlot {
  id: string;
  title: string;
  found: boolean;
  value: string;
}

export interface WantedGroup {
  id: string;
  title: string;
  purpose: string;
  slots: WantedSlot[];
}

export interface BrandStep {
  brand: string;
  viewers: number;
  cart: number;
  buyers: number;
  cartBase: number;
  cartRate: number;
  buyGivenCart: number;
}

export const RECOGNITION_VERSION = 7;

export interface Recognition {
  version: number;
  eventRows: number;
  orderRows: number;
  items: RecognizedItem[];
  groups: WantedGroup[];
  brandSteps: BrandStep[];
  eventCounts: Record<string, number>;
  pilot: PilotChecklist;
}

const VIEW = new Set(["view_pdp", "view_product", "view"]);
const CART = new Set(["ui_click_cta", "cart", "add_to_cart"]);
const BUY = new Set(["view_checkout", "purchase"]);
const AD_CONSENT = ["consent", "advertising_consent", "email_consent", "opt_in", "gdpr_consent", "marketing_consent", "ads_storage"];
const ANALYTICS_CONSENT = ["analytics_storage", "analytics_consent"];
const SENT = new Set(["email_sent", "message_sent", "push_sent", "sms_sent"]);
const OPENED = new Set(["email_open", "email_opened", "message_open", "push_open"]);
const UNSUB = new Set(["email_unsubscribe", "unsubscribe", "email_spam", "spam_complaint"]);
const REVIEW = new Set(["nps", "review", "review_submitted"]);
const MIN_VIEWERS = 200;

export function recognizeRaw(input: {
  events: RawEvent[];
  orders: RawOrder[];
  nps?: RawNps[];
  stableIdColumn?: string;
  declaredCurrency?: string;
}): Recognition {
  if (!input.events.length && !input.orders.length) {
    return {
      version: RECOGNITION_VERSION,
      eventRows: 0,
      orderRows: 0,
      items: [
        {
          id: "raw",
          found: false,
          title: "Сырой файл",
          detail: "Для этого прогона разбор не сохранился. Откройте данные ещё раз.",
        },
      ],
      groups: wantedGroups(emptyCounts()),
      brandSteps: [],
      eventCounts: {},
      pilot: pilotChecklist({ events: [], orders: [] }),
    };
  }

  const eventCounts = new Map<string, number>();
  let emailEvents = 0;
  let stableHits = 0;
  let userIdHits = 0;
  let channelHits = 0;
  let campaignHits = 0;
  let deviceHits = 0;
  let browserHits = 0;
  let countryHits = 0;
  let cityHits = 0;
  let scrollHits = 0;
  let experimentHits = 0;
  let removeHits = 0;
  let adConsentHits = 0;
  let analyticsConsentHits = 0;
  let sentHits = 0;
  let openedHits = 0;
  let unsubHits = 0;
  let reviewHits = input.nps?.length ?? 0;
  let sawBrand = false;
  const brandUsers = new Map<string, { view: Set<string>; cart: Set<string>; buy: Set<string> }>();

  for (const event of input.events) {
    const label = eventLabel(event.event_name);
    eventCounts.set(label, (eventCounts.get(label) ?? 0) + 1);
    if (filled(event.user_email)) emailEvents += 1;
    if (input.stableIdColumn && filled(event[input.stableIdColumn])) stableHits += 1;
    if (filled(event.user_id) || filled(event.customer_id)) userIdHits += 1;
    if (filled(event.utm_source) || filled(event.utm_medium)) channelHits += 1;
    if (filled(event.utm_campaign)) campaignHits += 1;
    if (filled(event.device_type) || filled(event.device_category)) deviceHits += 1;
    if (filled(event.browser)) browserHits += 1;
    if (filled(event.country) || filled(event.geo_country)) countryHits += 1;
    if (filled(event.city) || filled(event.geo_city)) cityHits += 1;
    if (event.event_name === "scroll" || event.event_name.startsWith("scroll_")) scrollHits += 1;
    if (event.event_name === "experiment_exposure" || filled(event.experiment_id) || filled(event.variant)) experimentHits += 1;
    if (event.event_name === "remove_from_cart") removeHits += 1;
    if (AD_CONSENT.some((key) => filled(event[key]))) adConsentHits += 1;
    if (ANALYTICS_CONSENT.some((key) => filled(event[key]))) analyticsConsentHits += 1;
    if (SENT.has(event.event_name)) sentHits += 1;
    if (OPENED.has(event.event_name)) openedHits += 1;
    if (UNSUB.has(event.event_name)) unsubHits += 1;
    if (REVIEW.has(event.event_name) || filled(event.review_score)) reviewHits += 1;

    if (!("brand" in event)) continue;
    sawBrand = true;
    const brand = typeof event.brand === "string" && event.brand.trim() ? event.brand.trim() : "без бренда";
    const user = String(event.user_id ?? event.user_email ?? event.anonymous_id ?? event.session_id ?? "");
    if (!user) continue;
    const bucket = brandUsers.get(brand) ?? { view: new Set<string>(), cart: new Set<string>(), buy: new Set<string>() };
    if (VIEW.has(event.event_name)) bucket.view.add(user);
    if (CART.has(event.event_name)) bucket.cart.add(user);
    if (BUY.has(event.event_name)) bucket.buy.add(user);
    brandUsers.set(brand, bucket);
  }

  let emailOrders = 0;
  let customerHits = 0;
  let paid = 0;
  let namedRevenue = 0;
  let unnamedRevenue = 0;
  let quantitySum = 0;
  let revenueSum = 0;
  let renewals = 0;
  let basketLines = 0;
  const currencies = new Set<string>();

  for (const order of input.orders) {
    if (order.counts_as_order === false) {
      basketLines += 1;
      continue;
    }
    paid += 1;
    if (filled(order.email)) emailOrders += 1;
    if (filled(order.customer_id)) customerHits += 1;
    if (order.is_subscription_renewal) renewals += 1;
    if (order.currency) currencies.add(order.currency);
    const reviewScore = (order as { review_score?: unknown }).review_score;
    if (filled(reviewScore)) reviewHits += 1;
    if (order.status === "cancelled" || order.status === "refunded") continue;
    const numeric = !order.product_name?.trim() || /^\d+$/.test(order.product_name.trim());
    if (numeric) unnamedRevenue += order.revenue;
    else namedRevenue += order.revenue;
    quantitySum += order.quantity;
    revenueSum += order.revenue;
  }

  const sold = input.orders.filter(
    (order) => order.counts_as_order !== false && order.status !== "cancelled" && order.status !== "refunded",
  ).length;
  const brandSteps = sawBrand ? pickSteps(brandUsers) : [];
  const eventDetail = [...eventCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${label} ${num(count)}`)
    .join(", ");

  const items: RecognizedItem[] = [
    {
      id: "events",
      found: input.events.length > 0,
      title: "События",
      detail: input.events.length
        ? `${num(input.events.length)} строк. ${eventDetail}.`
        : "Событий сайта в файле нет.",
    },
    {
      id: "orders",
      found: paid > 0,
      title: "Заказы",
      detail: paid
        ? `${num(paid)} заказов${basketLines ? `, ещё ${num(basketLines)} строк состава корзины` : ""}${renewals ? `, из них продлений ${num(renewals)}` : ""}.`
        : "Заказов в файле нет.",
    },
    {
      id: "email",
      found: emailEvents + emailOrders > 0,
      title: "Почта",
      detail:
        emailEvents + emailOrders > 0
          ? `Адрес есть у ${num(emailEvents)} событий и ${num(emailOrders)} заказов. В расчёте он остаётся хешем и в отчёт не попадает.`
          : "Адреса почты в файле нет.",
    },
    {
      id: "identity",
      found: stableHits + userIdHits + customerHits > 0,
      title: "Идентификатор",
      detail: identityDetail(input.stableIdColumn, stableHits, userIdHits, customerHits),
    },
    {
      id: "brand",
      found: namedRevenue > 0 || sawBrand,
      title: "Бренд",
      detail: brandDetail(namedRevenue, unnamedRevenue, brandSteps, sawBrand),
    },
    {
      id: "price",
      found: revenueSum > 0,
      title: "Цена",
      detail: revenueSum
        ? `Сумма оплаченных заказов ${num(Math.round(revenueSum))}. Средний чек ${sold ? num(Math.round(revenueSum / sold)) : "0"}.`
        : "Цены в заказах нет.",
    },
    {
      id: "currency",
      found: currencies.size > 0,
      title: "Валюта",
      detail: currencies.size
        ? `В строках заказа указано: ${[...currencies].join(", ")}.`
        : input.declaredCurrency
          ? `В строках заказа валюты нет. В настройке бренда указано ${input.declaredCurrency}.`
          : "В строках заказа валюты нет.",
    },
    {
      id: "quantity",
      found: sold > 0 && quantitySum > 0,
      title: "Число штук",
      detail: quantityDetail(quantitySum, sold),
    },
    {
      id: "channel",
      found: channelHits > 0,
      title: "Источник",
      detail: channelHits
        ? `Метка источника есть у ${num(channelHits)} событий.`
        : "Меток источника нет, канал из файла не собрать.",
    },
    {
      id: "device",
      found: deviceHits > 0,
      title: "Устройство",
      detail: deviceHits ? `Тип устройства есть у ${num(deviceHits)} событий.` : "Типа устройства в файле нет.",
    },
    {
      id: "scroll",
      found: scrollHits > 0,
      title: "Прокрутка",
      detail: scrollHits ? `Прокрутка страницы есть у ${num(scrollHits)} событий.` : "Прокрутки страницы в файле нет.",
    },
    {
      id: "experiment",
      found: experimentHits > 0,
      title: "Тест",
      detail: experimentHits ? `Попадание в тест есть у ${num(experimentHits)} событий.` : "Тестов в файле нет.",
    },
    {
      id: "remove",
      found: removeHits > 0,
      title: "Снятие с корзины",
      detail: removeHits ? `${num(removeHits)} событий снятия с корзины.` : "Снятия с корзины в загруженном файле нет.",
    },
    {
      id: "nps",
      found: (input.nps?.length ?? 0) > 0,
      title: "Оценки",
      detail: input.nps?.length ? `${num(input.nps.length)} оценок.` : "Оценок в файле нет.",
    },
    {
      id: "consent",
      found: adConsentHits > 0,
      title: "Согласие",
      detail: adConsentHits
        ? `Поле согласия на рекламу есть у ${num(adConsentHits)} событий.`
        : "Поля согласия на рекламу в файле нет.",
    },
  ];

  const groups = wantedGroups({
    viewHits: (eventCounts.get("просмотр товара") ?? 0) + (eventCounts.get("заход") ?? 0),
    cartHits: eventCounts.get("корзина") ?? 0,
    removeHits,
    purchaseHits: eventCounts.get("покупка") ?? 0,
    scrollHits,
    channelHits,
    campaignHits,
    deviceHits,
    browserHits,
    countryHits,
    cityHits,
    price: revenueSum > 0,
    currencyFound: currencies.size > 0,
    quantityFound: sold > 0 && quantitySum > 0,
    brandFound: namedRevenue + unnamedRevenue > 0 || sawBrand,
    identity: stableHits + userIdHits + customerHits,
    email: emailEvents + emailOrders,
    adConsentHits,
    analyticsConsentHits,
    sentHits,
    openedHits,
    unsubHits,
    experimentHits,
    reviewHits,
    renewals,
  });

  return {
    version: RECOGNITION_VERSION,
    eventRows: input.events.length,
    orderRows: paid,
    items,
    groups,
    brandSteps,
    eventCounts: Object.fromEntries(eventCounts),
    pilot: pilotChecklist({ events: input.events, orders: input.orders }),
  };
}

function pickSteps(brands: Map<string, { view: Set<string>; cart: Set<string>; buy: Set<string> }>): BrandStep[] {
  const rows: BrandStep[] = [];
  for (const [brand, bucket] of brands) {
    const viewers = bucket.view.size;
    if (viewers < MIN_VIEWERS) continue;
    const cart = [...bucket.cart].filter((user) => bucket.view.has(user)).length;
    const buyers = [...bucket.buy].filter((user) => bucket.cart.has(user)).length;
    rows.push({
      brand,
      viewers,
      cart,
      buyers,
      cartBase: bucket.cart.size,
      cartRate: cart / viewers,
      buyGivenCart: bucket.cart.size ? buyers / bucket.cart.size : 0,
    });
  }
  if (rows.length < 2) return [];
  const sorted = rows.sort((a, b) => a.cartRate - b.cartRate || b.viewers - a.viewers);
  if (sorted.length <= 6) return sorted;
  const chosen = new Map<string, BrandStep>();
  for (const row of sorted.slice(0, 3)) chosen.set(row.brand, row);
  for (const row of sorted.slice(-3)) chosen.set(row.brand, row);
  return [...chosen.values()].sort((a, b) => a.cartRate - b.cartRate);
}

function brandDetail(named: number, unnamed: number, steps: BrandStep[], sawBrand: boolean): string {
  const total = named + unnamed;
  let money: string;
  if (!total) money = sawBrand ? "Бренд есть в событиях сайта." : "Бренда в файле нет.";
  else if (!sawBrand && unnamed === 0) money = "Отдельного поля бренда нет. Название товара есть у всех заказов.";
  else if (!sawBrand) money = `Отдельного поля бренда нет. Название есть у ${share(named, total)} выручки, у ${share(unnamed, total)} в названии только номер.`;
  else if (unnamed === 0) money = "Имя бренда есть у всех заказов.";
  else money = `Имя бренда есть у ${share(named, total)} выручки. У ${share(unnamed, total)} в названии только номер товара.`;
  if (!steps.length) return money;
  const low = steps[0];
  const high = steps[steps.length - 1];
  return `${money} После просмотра в корзину кладут от ${pct(low.cartRate)} (${low.brand}) до ${pct(high.cartRate)} (${high.brand}).`;
}

function quantityDetail(quantitySum: number, sold: number): string {
  if (!sold) return "Числа штук в заказах нет.";
  const mean = quantitySum / sold;
  if (Math.abs(mean - 1) < 0.05) return "В каждом заказе одна позиция.";
  return `В заказе в среднем ${mean.toFixed(1).replace(".", ",")} позиций.`;
}

function identityDetail(column: string | undefined, stableHits: number, userIdHits: number, customerHits: number): string {
  if (!stableHits && !userIdHits && !customerHits) return "Идентификатора визита и покупателя в файле нет.";
  const parts: string[] = [];
  if (column && stableHits) parts.push(`колонка ${column} заполнена у ${num(stableHits)} событий`);
  if (userIdHits) parts.push(`user_id есть у ${num(userIdHits)} событий`);
  if (customerHits) parts.push(`customer_id есть у ${num(customerHits)} заказов`);
  if (column && !stableHits) parts.push(`колонки ${column} в строках нет`);
  const text = parts.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function eventLabel(name: string): string {
  if (VIEW.has(name)) return "просмотр товара";
  if (name === "view_landing" || name === "view_category") return "заход";
  if (CART.has(name)) return "корзина";
  if (name === "ui_click") return "кнопка";
  if (BUY.has(name)) return "покупка";
  if (name.startsWith("scroll")) return "прокрутка";
  if (name === "experiment_exposure") return "тест";
  if (name === "remove_from_cart") return "снятие с корзины";
  return name;
}

interface WantedCounts {
  viewHits: number;
  cartHits: number;
  removeHits: number;
  purchaseHits: number;
  scrollHits: number;
  channelHits: number;
  campaignHits: number;
  deviceHits: number;
  browserHits: number;
  countryHits: number;
  cityHits: number;
  price: boolean;
  currencyFound: boolean;
  quantityFound: boolean;
  brandFound: boolean;
  identity: number;
  email: number;
  adConsentHits: number;
  analyticsConsentHits: number;
  sentHits: number;
  openedHits: number;
  unsubHits: number;
  experimentHits: number;
  reviewHits: number;
  renewals: number;
}

function emptyCounts(): WantedCounts {
  return {
    viewHits: 0,
    cartHits: 0,
    removeHits: 0,
    purchaseHits: 0,
    scrollHits: 0,
    channelHits: 0,
    campaignHits: 0,
    deviceHits: 0,
    browserHits: 0,
    countryHits: 0,
    cityHits: 0,
    price: false,
    currencyFound: false,
    quantityFound: false,
    brandFound: false,
    identity: 0,
    email: 0,
    adConsentHits: 0,
    analyticsConsentHits: 0,
    sentHits: 0,
    openedHits: 0,
    unsubHits: 0,
    experimentHits: 0,
    reviewHits: 0,
    renewals: 0,
  };
}

function slot(id: string, title: string, found: boolean, value: string): WantedSlot {
  return { id, title, found, value: found ? value : "Нет в файле" };
}

function countSlot(id: string, title: string, count: number): WantedSlot {
  return slot(id, title, count > 0, num(count));
}

function wantedGroups(counts: WantedCounts): WantedGroup[] {
  return [
    {
      id: "site",
      title: "Сайт",
      purpose: "Где человек остановился до покупки.",
      slots: [
        countSlot("view", "Просмотр", counts.viewHits),
        countSlot("cart", "Корзина", counts.cartHits),
        countSlot("remove", "Снятие с корзины", counts.removeHits),
        countSlot("purchase", "Покупка", counts.purchaseHits),
        countSlot("scroll", "Прокрутка", counts.scrollHits),
      ],
    },
    {
      id: "channel",
      title: "Канал",
      purpose: "Откуда человек пришёл и какая кампания его привела.",
      slots: [countSlot("source", "Источник", counts.channelHits), countSlot("campaign", "Кампания", counts.campaignHits)],
    },
    {
      id: "place",
      title: "Устройство и место",
      purpose: "С какого экрана и из какой страны был визит.",
      slots: [
        countSlot("device", "Устройство", counts.deviceHits),
        countSlot("browser", "Браузер", counts.browserHits),
        countSlot("country", "Страна", counts.countryHits),
        countSlot("city", "Город", counts.cityHits),
      ],
    },
    {
      id: "money",
      title: "Деньги и товар",
      purpose: "Сколько заплатили, в какой валюте и за какой бренд.",
      slots: [
        slot("price", "Цена", counts.price, "Есть"),
        slot("currency", "Валюта", counts.currencyFound, "Есть"),
        slot("quantity", "Число штук", counts.quantityFound, "Есть"),
        slot("brand", "Бренд", counts.brandFound, "Есть"),
      ],
    },
    {
      id: "person",
      title: "Человек",
      purpose: "Кого можно связать и кому можно писать.",
      slots: [
        slot("identity", "Идентификатор", counts.identity > 0, "Есть"),
        countSlot("email", "Почта", counts.email),
        countSlot("ad-consent", "Согласие на рекламу", counts.adConsentHits),
        countSlot("analytics-consent", "Согласие на аналитику", counts.analyticsConsentHits),
      ],
    },
    {
      id: "letters",
      title: "Письма",
      purpose: "Путь сообщения: отправка, открытие, отписка.",
      slots: [
        countSlot("sent", "Отправка", counts.sentHits),
        countSlot("opened", "Открытие", counts.openedHits),
        countSlot("unsub", "Отписка", counts.unsubHits),
      ],
    },
    {
      id: "test",
      title: "Тест",
      purpose: "Какой вариант человек увидел.",
      slots: [countSlot("experiment", "Попадание в вариант", counts.experimentHits)],
    },
    {
      id: "after",
      title: "После заказа",
      purpose: "Оценка покупки и продление подписки.",
      slots: [countSlot("review", "Оценка", counts.reviewHits), countSlot("renewal", "Продление", counts.renewals)],
    },
  ];
}

function filled(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function num(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function share(part: number, whole: number): string {
  return whole ? pct(part / whole) : "0%";
}
