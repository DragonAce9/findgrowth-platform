/** Words for the largest logit contributions. The prose has no digits. */
const PHRASES: Record<string, { low: string; high: string }> = {
  visits: { low: "мало визитов до покупки", high: "много визитов до покупки" },
  visits_before_t1: { low: "мало визитов до покупки", high: "много визитов до покупки" },
  recency: { low: "покупал недавно", high: "давно не покупал" },
  revenue: { low: "небольшой первый чек", high: "крупный первый чек" },
  orders: { low: "мало заказов до этой даты", high: "уже были заказы" },
  pdp_depth: { low: "мало просмотров карточки", high: "много просмотров карточки" },
  days_first_seen_to_t1: { low: "короткий путь до покупки", high: "долгий путь до покупки" },
  discount: { low: "без скидки в первом заказе", high: "скидка в первом заказе" },
  cart_returns: { low: "корзину не возвращали", high: "возвращался в корзину" },
};

export function reasonCodes(
  rows: Array<{ feature: string; standardized: number; coefficient: number }>,
  limit = 3,
): string[] {
  return rows
    .map((row) => ({ ...row, logit: row.coefficient * row.standardized }))
    .filter((row) => Number.isFinite(row.logit) && row.logit !== 0)
    .sort((a, b) => Math.abs(b.logit) - Math.abs(a.logit) || a.feature.localeCompare(b.feature))
    .slice(0, limit)
    .map((row) => {
      const phrase = PHRASES[row.feature];
      if (!phrase) return row.standardized < 0 ? "признак ниже обычного для среза" : "признак выше обычного для среза";
      return row.standardized < 0 ? phrase.low : phrase.high;
    });
}
