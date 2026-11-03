import { configDigest } from "./hash";
import type { RunConfig } from "./types";

/** Bump when a number on the screen would change for the same file. */
export const METHODOLOGY_VERSION = "2.0";

export function methodologyOf(config: Pick<RunConfig, "methodologyVersion">): string {
  return config.methodologyVersion || METHODOLOGY_VERSION;
}

export function hashRunConfig(config: RunConfig): string {
  return configDigest(
    JSON.stringify({
      methodologyVersion: methodologyOf(config),
      windowDays: config.windowDays,
      replenishmentLow: config.replenishmentLow,
      replenishmentHigh: config.replenishmentHigh,
      stableIdColumn: config.stableIdColumn,
      category: config.category,
      sampleEvery: config.sampleEvery ?? 1,
      skuRoles: config.skuRoles,
    }),
  );
}
