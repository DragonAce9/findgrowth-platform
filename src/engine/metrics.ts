export type Measure =
  | { op: "count"; field?: string }
  | { op: "sum"; field: string }
  | { op: "ratio"; numerator: Measure; denominator: Measure }
  | { op: "filter"; where: string; value?: string | number | boolean; inner: Measure }
  | { op: "window"; days: number; inner: Measure };

export interface MetricDef {
  name: string;
  description: string;
  owner: string;
  domain: string;
  status: "live" | "roadmap" | "draft";
  grain: string;
  measure: Measure;
  dimensions: string[];
  filters: string[];
  window: number | null;
  expected?: number;
  expectedBy?: string;
}

const LIVE_NAMES = new Set<string>();

export function compileSql(metric: MetricDef): string {
  const expr = compileMeasure(metric.measure);
  const dims = metric.dimensions.length ? metric.dimensions.join(", ") : "1";
  return [
    `-- ${metric.name} grain=${metric.grain}`,
    `SELECT ${dims}, ${expr} AS value`,
    `FROM ${tableForGrain(metric.grain)}`,
    whereClause(metric),
    metric.dimensions.length ? `GROUP BY ${dims}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function whereClause(metric: MetricDef): string {
  const parts: string[] = [];
  if (metric.window) parts.push(`age_days >= ${metric.window}`);
  for (const filter of metric.filters) {
    if (/^[a-z0-9_]+ = .+$/i.test(filter)) parts.push(filter);
    else parts.push(`/* ${filter} */`);
  }
  if (!parts.length) return "";
  const sqlParts = parts.filter((part) => !part.startsWith("/*"));
  const notes = parts.filter((part) => part.startsWith("/*"));
  const where = sqlParts.length ? `WHERE ${sqlParts.join(" AND ")}` : "";
  return [where, ...notes].filter(Boolean).join("\n");
}

function tableForGrain(grain: string): string {
  if (grain === "order") return "fact_purchases";
  if (grain === "exposure") return "fact_exposures";
  if (grain === "entity") return "dim_entity";
  return "run_totals";
}

function compileMeasure(measure: Measure, preds: string[] = []): string {
  switch (measure.op) {
    case "count":
      return countExpr(measure.field, preds);
    case "sum":
      return preds.length ? `SUM(CASE WHEN ${preds.join(" AND ")} THEN ${measure.field} END)` : `SUM(${measure.field})`;
    case "ratio":
      return `(${compileMeasure(measure.numerator, preds)}) / NULLIF(${compileMeasure(measure.denominator, preds)}, 0)`;
    case "filter":
      return compileMeasure(measure.inner, [...preds, predicate(measure.where, measure.value)]);
    case "window":
      if (measure.inner.op === "ratio") {
        const windowPred = `gap_days <= ${measure.days}`;
        return `(${compileMeasure(measure.inner.numerator, [...preds, windowPred])}) / NULLIF(${compileMeasure(measure.inner.denominator, preds)}, 0)`;
      }
      return compileMeasure(measure.inner, [...preds, `age_days <= ${measure.days}`]);
    default:
      return "NULL";
  }
}

function countExpr(field: string | undefined, preds: string[]): string {
  if (!preds.length) return field ? `COUNT(${field})` : "COUNT(*)";
  return `COUNT(CASE WHEN ${preds.join(" AND ")} THEN 1 END)`;
}

function predicate(where: string, value: string | number | boolean | undefined): string {
  if (value === undefined) return where;
  return `${where} = ${sqlLiteral(value)}`;
}

function sqlLiteral(value: string | number | boolean): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${value.replace(/'/g, "''")}'`;
}

export function proposeMetric(draft: MetricDef, catalog: MetricDef[]): MetricDef {
  if (catalog.some((metric) => metric.name === draft.name && metric.status === "live")) {
    throw new Error(`Живое имя ${draft.name} нельзя перезаписать черновиком`);
  }
  return { ...draft, status: "draft", expected: undefined, expectedBy: undefined };
}

export function promoteMetric(
  draft: MetricDef,
  expected: number,
  expectedBy: string,
  actual: number,
): MetricDef {
  if (draft.owner === expectedBy) {
    throw new Error("Автор формулы не подписывает ожидаемое число золотого теста");
  }
  if (LIVE_NAMES.has(draft.name) || draft.status === "live") {
    throw new Error(`Живое имя ${draft.name} не перезаписывается`);
  }
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(`Золотой тест красный: ожидалось ${expected}, получено ${actual}`);
  }
  LIVE_NAMES.add(draft.name);
  return { ...draft, status: "live", expected, expectedBy };
}

export function resetLiveNames(): void {
  LIVE_NAMES.clear();
}
