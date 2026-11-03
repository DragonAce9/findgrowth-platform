import type { RunConfig } from "./types";

export type ScoringMode = "shadow" | "live";

/** Live scoring (anything that would change an offer) stays shadow until both notices are recorded. */
export function scoringActivation(config: Pick<RunConfig, "profilingNotice" | "customerNotice">): ScoringMode {
  if (config.profilingNotice === true && config.customerNotice === true) return "live";
  return "shadow";
}

/** Gate for publishing a champion. There is no live scorer in this build; the gate still refuses without the flag. */
export function publishChampion(config: Pick<RunConfig, "profilingNotice" | "customerNotice">): void {
  if (scoringActivation(config) !== "live") {
    throw new Error("Скоринг остаётся в тени: нет уведомления о профилировании или отметки для покупателя.");
  }
}

/**
 * Session scoring is deferred until site connectors exist.
 * Required inputs, when that model is built: session velocity, intent ratio, cart friction.
 * This function is the only entry point. It does not score a session.
 */
export function assertSessionScoringAllowed(config: Pick<RunConfig, "advertisingConsent">): void {
  if (config.advertisingConsent !== true) {
    throw new Error("Сессионный скоринг не запускается: нет согласия на cookie.");
  }
}

/** A project without poolingConsent is left out of every pooled training set. */
export function pooledTrainingIds(projects: Array<{ id: string; poolingConsent?: boolean }>): string[] {
  return projects.filter((project) => project.poolingConsent === true).map((project) => project.id);
}

/** GBM stays off until the training set has at least 500 positives. This does not fit a model. */
export function assertGbmAllowed(positives: number): void {
  if (!(positives >= 500)) {
    throw new Error("GBM refused: fewer than 500 positives.");
  }
}

/**
 * Below 100 positives the bucket is the RFM rule. Elastic-net and Cox do not write a score, even in shadow.
 * This is not the GBM gate.
 */
export function assertModelShadowAllowed(positives: number): void {
  if (!(positives >= 100)) {
    throw new Error("Модель не пишется даже в тень: меньше 100 позитивов. Ведро назначает правило RFM.");
  }
}
