import { experimentReadiness } from "./experiments";
import { observedCycle, type Pocket, type Workspace } from "./pipeline";
import type { Recommendation, RunConfig } from "./types";

export interface Intervention {
  title: string;
  who: string;
  when: string;
  channel: string;
  why: string;
  measure30: string;
  measure60: string;
}

export interface FrenchReport {
  title: string;
  asOf: string;
  windowDays: number;
  replenishment: string;
  cycleHigh: number;
  cycleFromData: boolean;
  cyclePairs: number;
  priorCycle: string;
  coverage: number;
  repeat: number;
  funnelPurchase: number;
  experiments: ReturnType<typeof experimentReadiness>;
  pockets: Pocket[];
  interventions: Intervention[];
  recommendations: Recommendation[];
  hitRate: number | null;
  hitRatePopular: number | null;
  fallbackRate: number | null;
  narrative: string[];
}

export function buildReport(input: {
  workspace: Workspace;
  config: RunConfig;
  pockets: Pocket[];
  recommendations: Recommendation[];
  fallbackRate: number | null;
}): FrenchReport {
  const funnel = input.workspace.metrics.find((table) => table.name === "site_funnel");
  const purchase = Number(funnel?.rows.find((row) => row.stage === "purchase")?.lifetime ?? 0);
  const repeat = Number(input.workspace.metrics.find((table) => table.name === "repeat_rate")?.rows[0]?.value ?? 0);
  const cycle = observedCycle(input.workspace.entities, input.config);
  const priorCycle = `${input.config.replenishmentLow}–${input.config.replenishmentHigh}`;
  const experiments = experimentReadiness(input.workspace.exposures, input.config.asOf);
  const interventions = input.pockets.map((pocket) => ({
    title: pocket.title,
    who: pocket.who,
    when: cycle.hazardPeak
      ? `Autour du pic de risque, jour ${Math.round(cycle.hazardPeak)}`
      : `Autour du cycle observé, ${cycle.high} jours`,
    channel: pocket.id === "friction" ? "fiche produit" : "email post-achat",
    why: pocket.evidence.join(", "),
    measure30: "réachat observé à 30 jours",
    measure60: "réachat observé à 60 jours",
  }));
  const narrative = [
    `Couverture d'identité ${pct(input.workspace.identityCoverage)}. Fenêtre de réachat plateforme : ${input.config.windowDays} jours.`,
    cycle.fromData
      ? `Cycle observé : médiane ${cycle.high} jours sur ${cycle.n} deuxièmes achats. Cycle saisi : ${priorCycle} jours.`
      : `Cycle saisi : ${priorCycle} jours. Deuxièmes achats : ${cycle.n}, pas assez pour une médiane propre.`,
    input.workspace.modelReady
      ? `Le hit rate du rapport précédent est ${pct(input.workspace.hitRate ?? 0)}, contre ${pct(input.workspace.hitRatePopular ?? 0)} pour le SKU populaire du même rôle.`
      : "Le hit rate est vide : aucune fenêtre complète ne sépare ce run du rapport précédent.",
    ...experiments
      .filter((item) => !item.ready)
      .map((item) => `Le test ${item.experiment_id} n'est pas prêt : ${item.blockers.join(", ")}. Aucune recommandation de déploiement.`),
  ];
  return {
    title: "Diagnostic de rétention",
    asOf: input.config.asOf,
    windowDays: input.config.windowDays,
    replenishment: cycle.fromData ? String(cycle.high) : priorCycle,
    cycleHigh: cycle.high,
    cycleFromData: cycle.fromData,
    cyclePairs: cycle.n,
    priorCycle,
    coverage: input.workspace.identityCoverage,
    repeat,
    funnelPurchase: purchase,
    experiments,
    pockets: input.pockets,
    interventions,
    recommendations: input.recommendations,
    hitRate: input.workspace.hitRate,
    hitRatePopular: input.workspace.hitRatePopular,
    fallbackRate: input.fallbackRate,
    narrative,
  };
}

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10} %`;
}
