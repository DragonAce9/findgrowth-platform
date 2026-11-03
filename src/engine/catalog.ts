import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export interface MartCard {
  name: string;
  domain: string;
  status: "live" | "roadmap";
  grain: string;
}

export function martCatalog(): MartCard[] {
  const path = join(dirname(fileURLToPath(import.meta.url)), "../../methodology/mart-catalog.yaml");
  return parse(readFileSync(path, "utf8")) as MartCard[];
}

export function liveMarts(): MartCard[] {
  return martCatalog().filter((card) => card.status === "live");
}
