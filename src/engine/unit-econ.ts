import { bootstrapMean } from "./stats";
import { observedCycle } from "./pipeline";
import { repeatWithin } from "./repeat";
import type { EntityRow, OrderRow, RunConfig } from "./types";

export interface UnitCard {
  id: string;
  name: string;
  value: number;
  kind: "money" | "count" | "pct" | "ratio" | "days";
  formula: string;
  source: "file" | "operator" | "model";
  text: string;
}

export interface PnlLine {
  id: string;
  name: string;
  value: number;
  text: string;
  source: "file" | "operator" | "model";
}

export interface AarrrStep {
  id: "acquire" | "activate" | "retain" | "revenue" | "refer";
  name: string;
  n: number | null;
  rate: number | null;
  text: string;
}

export interface UnitEconomics {
  visitors: number;
  buyers: number;
  orders: number;
  revenue: number;
  aov: number;
  observedLtv: number;
  conversion: number;
  mature: number;
  repeated: number;
  repeat: number;
  cycleHigh: number;
  cards: UnitCard[];
  derived: UnitCard[];
  aarrr: AarrrStep[];
  pnl: PnlLine[] | null;
  burn: number | null;
  runwayMonths: number | null;
  cohorts: CohortLtv[];
  estimate: boolean;
}

export interface CohortLtv {
  horizon: 90 | 180 | 365;
  n: number;
  ltv: number;
  low: number;
  high: number;
}

export function unitEconomics(entities: EntityRow[], config: RunConfig, orders: OrderRow[] = []): UnitEconomics {
  const weight = config.sampleEvery && config.sampleEvery > 1 ? config.sampleEvery : 1;
  const estimate = weight > 1;
  const visitors = entities.length * weight;
  const buyers = entities.filter((entity) => entity.converted);
  const rawRevenue = buyers.reduce((sum, entity) => sum + entity.ltv, 0);
  const rawOrders = buyers.reduce((sum, entity) => sum + entity.n_orders, 0);
  const revenue = rawRevenue * weight;
  const orderCount = rawOrders * weight;
  const aov = orderCount ? revenue / orderCount : 0;
  const observedLtv = buyers.length ? rawRevenue / buyers.length : 0;
  const conversion = entities.length ? buyers.length / entities.length : 0;
  const repeatStats = repeatWithin(entities, config.windowDays);
  const repeat = repeatStats.p;
  const cycle = observedCycle(entities, config);
  const acquire = entities.filter((entity) => entity.funnel_depth >= 1).length;
  const activate = entities.filter((entity) => entity.funnel_depth >= 2).length;
  const purchased = entities.filter((entity) => entity.funnel_depth >= 5).length;
  const margin = rateOf(config.grossMargin);
  const marketing = moneyOf(config.marketingSpend);
  const opex = moneyOf(config.opex);
  const taxRate = rateOf(config.taxRate);
  const cash = moneyOf(config.cash);

  const cards: UnitCard[] = [
    card("visitors", "Зашли", visitors, "count", "Люди с визитом", "file", "Знаменатель воронки и конверсии."),
    card("buyers", "Купили", buyers.length * weight, "count", "Люди с оплатой без продления", "file", estimate ? "Оценка: число умножено на шаг выборки." : "Числитель конверсии сайта."),
    card("conversion", "Конверсия сайта", conversion, "pct", "Купили ÷ зашли", "file", "Не конверсия лида из рекламного кабинета."),
    card("orders", "Оплаты", orderCount, "count", "Оплаченные заказы без продления", "file", estimate ? "Оценка: выборка масштабирована. Продления в средний чек не входят." : "Продления в средний чек не входят."),
    card("revenue", "Выручка", revenue, "money", "Сумма LTV покупателей", "file", "Уже заплаченное в срезе, не выручка подписки."),
    card("aov", "Средний чек", aov, "money", "Выручка ÷ оплаты", "file", "Чек по оплатам без продления."),
    card("ltv", "Уже заплачено", observedLtv, "money", "Выручка ÷ купили", "file", "Наблюдаемый LTV. Это не прогноз ARPU ÷ отток."),
    card("repeat", "Повтор", repeat, "pct", `Вторая покупка за ${config.windowDays} дней`, "file", estimate ? "Оценка по выборке. Интервал шире, чем у полной базы." : "Только зрелые покупатели."),
    card("cycle", "Цикл", cycle.high, "days", cycle.fromData ? "Медиана дней до второй покупки" : "Заданный цикл", "file", "Не месячный отток подписки."),
  ];

  const derived: UnitCard[] = [];
  let cac: number | null = null;
  if (marketing !== null && buyers.length) {
    cac = marketing / buyers.length;
    derived.push(card("cac", "CAC", cac, "money", "Маркетинг оператора ÷ купили", "model", "Знаменатель — покупатели среза, не лиды кабинета."));
  }
  if (marketing !== null && marketing > 0) {
    derived.push(card("roas", "ROAS", revenue / marketing, "ratio", "Выручка среза ÷ маркетинг", "model", "Выручка уже заплаченная, не ставка письма."));
  }
  if (observedLtv && margin !== null) {
    derived.push(
      card("cltv", "Вклад с клиента", observedLtv * margin, "money", "Уже заплачено × маржа", "model", "Маржа — допуск оператора, сумма — из файла."),
    );
  }
  if (cac !== null && cac > 0 && observedLtv && margin !== null) {
    derived.push(
      card("ltvcac", "LTV : CAC", (observedLtv * margin) / cac, "ratio", "Вклад с клиента ÷ CAC", "model", "В числителе наблюдаемый вклад, не формула подписки."),
    );
  }
  if (cac !== null && aov > 0 && margin !== null && aov * margin > 0) {
    const paybackOrders = cac / (aov * margin);
    derived.push(card("payback-orders", "Окупаемость, заказы", paybackOrders, "ratio", "CAC ÷ (чек × маржа)", "model", "Сколько оплат закрывают стоимость привлечения."));
    derived.push(
      card("payback-days", "Окупаемость, дни", paybackOrders * cycle.high, "days", "Заказы × цикл", "model", "Грубый срок: цикл из файла, не календарный месяц."),
    );
  }

  const pnl = buildPnl({ revenue, margin, marketing, opex, taxRate });
  let burn: number | null = null;
  let runwayMonths: number | null = null;
  if (pnl && (opex !== null || marketing !== null)) {
    const gross = pnl.find((line) => line.id === "gross")?.value ?? 0;
    burn = Math.max(0, (opex ?? 0) + (marketing ?? 0) - gross);
    if (cash !== null) {
      runwayMonths = burn > 0 ? cash / burn : Number.POSITIVE_INFINITY;
      derived.push(
        card(
          "runway",
          "Запас кассы",
          Number.isFinite(runwayMonths) ? runwayMonths : 0,
          "ratio",
          burn > 0 ? "Касса ÷ выжигание среза" : "Выручка покрывает расходы",
          "model",
          burn > 0 ? "Касса — допуск оператора. Единица — этот срез, не календарный месяц." : "При этих допусках срез кассу не сжигает.",
        ),
      );
    }
  }

  return {
    visitors,
    buyers: buyers.length,
    orders: orderCount,
    revenue,
    aov,
    observedLtv,
    conversion,
    mature: repeatStats.n,
    repeated: repeatStats.successes,
    repeat,
    cycleHigh: cycle.high,
    cards,
    derived,
    aarrr: [
      {
        id: "acquire",
        name: "Acquire",
        n: acquire,
        rate: null,
        text: "Зашли. Первый шаг воронки файла.",
      },
      {
        id: "activate",
        name: "Activate",
        n: activate,
        rate: acquire ? activate / acquire : null,
        text: "Смотрели товар. Доля от зашедших.",
      },
      {
        id: "retain",
        name: "Retain",
        n: repeatStats.successes,
        rate: repeatStats.n ? repeat : null,
        text: `Вторая покупка у зрелых за ${config.windowDays} дней.`,
      },
      {
        id: "revenue",
        name: "Revenue",
        n: purchased,
        rate: acquire ? purchased / acquire : null,
        text: "Купили. Продления не входят.",
      },
      {
        id: "refer",
        name: "Refer",
        n: null,
        rate: null,
        text: "Реферала в файле нет. Карточку не заполняем.",
      },
    ],
    pnl,
    burn,
    runwayMonths,
    cohorts: cohortHorizons(entities, orders, config.asOf),
    estimate,
  };
}

function buildPnl(input: {
  revenue: number;
  margin: number | null;
  marketing: number | null;
  opex: number | null;
  taxRate: number | null;
}): PnlLine[] | null {
  if (input.margin === null) return null;
  const cogs = input.revenue * (1 - input.margin);
  const gross = input.revenue * input.margin;
  const lines: PnlLine[] = [
    { id: "revenue", name: "Выручка", value: input.revenue, text: "Уже заплаченное в срезе", source: "file" },
    { id: "cogs", name: "COGS", value: -cogs, text: "Выручка × (1 − маржа оператора)", source: "model" },
    { id: "gross", name: "Валовая прибыль", value: gross, text: "Выручка × маржа", source: "model" },
  ];
  if (input.opex !== null) {
    lines.push({ id: "opex", name: "OPEX", value: -input.opex, text: "Постоянные расходы без маркетинга", source: "operator" });
  }
  if (input.marketing !== null) {
    lines.push({ id: "marketing", name: "Маркетинг", value: -input.marketing, text: "Расход оператора на срез", source: "operator" });
  }
  if (input.opex !== null && input.marketing !== null) {
    const ebit = gross - input.opex - input.marketing;
    lines.push({ id: "ebit", name: "EBIT", value: ebit, text: "Валовая прибыль − OPEX − маркетинг", source: "model" });
    if (input.taxRate !== null) {
      const tax = ebit > 0 ? ebit * input.taxRate : 0;
      lines.push({ id: "tax", name: "Налог", value: -tax, text: "С положительного EBIT", source: "model" });
      lines.push({ id: "net", name: "Чистая прибыль", value: ebit - tax, text: "EBIT − налог. Срез, не месяц.", source: "model" });
    }
  }
  return lines;
}

function card(
  id: string,
  name: string,
  value: number,
  kind: UnitCard["kind"],
  formula: string,
  source: UnitCard["source"],
  text: string,
): UnitCard {
  return { id, name, value, kind, formula, source, text };
}

function moneyOf(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function rateOf(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.min(value, 1);
}

/** Observed spend inside the horizon, only for buyers old enough to have finished it. Not ARPU / churn. */
function cohortHorizons(entities: EntityRow[], orders: OrderRow[], asOf: string): CohortLtv[] {
  const horizons = [90, 180, 365] as const;
  return horizons.map((horizon) => {
    const eligible = entities.filter(
      (entity) => entity.converted && entity.first_purchase_at && entity.age_days !== null && entity.age_days >= horizon,
    );
    const values = eligible.map((entity) => horizonRevenue(entity, orders, horizon));
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const band = values.length ? bootstrapMean(values, { seed: horizon, reps: 300 }) : { mean: 0, low: 0, high: 0 };
    return { horizon, n: eligible.length, ltv: mean, low: band.low, high: band.high };
  });
}

function horizonRevenue(entity: EntityRow, orders: OrderRow[], horizon: number): number {
  if (!entity.first_purchase_at) return 0;
  const start = Date.parse(entity.first_purchase_at);
  const end = start + horizon * 86_400_000;
  if (!orders.length) return entity.age_days !== null && entity.age_days >= horizon ? entity.ltv : 0;
  return orders
    .filter(
      (order) =>
        order.entity_id === entity.entity_id &&
        order.status === "paid" &&
        !order.is_subscription_renewal &&
        order.countsAsOrder &&
        Date.parse(order.purchased_at) >= start &&
        Date.parse(order.purchased_at) <= end,
    )
    .reduce((sum, order) => sum + order.revenue, 0);
}
