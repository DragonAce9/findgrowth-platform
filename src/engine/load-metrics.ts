import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { compileSql, type MetricDef } from "./metrics";

export function loadMetricFiles(dir: string): MetricDef[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => parse(readFileSync(join(dir, name), "utf8")) as MetricDef);
}

export function compiledLiveSql(dir: string): Record<string, string> {
  const sql: Record<string, string> = {};
  for (const metric of loadMetricFiles(dir)) {
    if (metric.status === "live") sql[metric.name] = compileSql(metric);
  }
  return sql;
}
