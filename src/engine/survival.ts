export interface SurvivalPoint {
  time: number;
  atRisk: number;
  events: number;
  censored: number;
  survival: number;
  low: number;
  high: number;
  hazard: number;
}

export interface SurvivalFit {
  curve: SurvivalPoint[];
  median: number | null;
  q25: number | null;
  q75: number | null;
  hazardPeak: number | null;
  events: number;
  censored: number;
}

export interface SurvivalObservation {
  time: number;
  event: boolean;
}

const Z95 = 1.959963984540054;

/**
 * Kaplan–Meier with right censoring. Times are days. `event: false` is censored at `time`
 * (follow-up ends at asOf without a second purchase). Greenwood interval uses the log-log transform.
 */
export function kaplanMeier(observations: SurvivalObservation[]): SurvivalFit {
  const rows = observations
    .filter((row) => Number.isFinite(row.time) && row.time >= 0)
    .map((row) => ({ time: row.time, event: row.event }));
  const events = rows.filter((row) => row.event).length;
  const censored = rows.length - events;
  if (!rows.length) {
    return { curve: [], median: null, q25: null, q75: null, hazardPeak: null, events: 0, censored: 0 };
  }
  const times = [...new Set(rows.map((row) => row.time))].sort((a, b) => a - b);
  let atRisk = rows.length;
  let survival = 1;
  let greenwood = 0;
  const curve: SurvivalPoint[] = [];
  let hazardPeak: number | null = null;
  let hazardMax = -1;
  for (const time of times) {
    const here = rows.filter((row) => row.time === time);
    const died = here.filter((row) => row.event).length;
    const lost = here.length - died;
    const hazard = atRisk > 0 ? died / atRisk : 0;
    if (died > 0 && hazard > hazardMax) {
      hazardMax = hazard;
      hazardPeak = time;
    }
    if (died > 0 && atRisk > 0) {
      const next = survival * (1 - died / atRisk);
      if (atRisk > died) greenwood += died / (atRisk * (atRisk - died));
      survival = next;
    }
    const se = survival > 0 && survival < 1 ? survival * Math.sqrt(greenwood) : 0;
    const band = logLogBand(survival, se);
    curve.push({
      time,
      atRisk,
      events: died,
      censored: lost,
      survival,
      low: band.low,
      high: band.high,
      hazard,
    });
    atRisk -= here.length;
  }
  return {
    curve,
    median: quantile(curve, 0.5),
    q25: quantile(curve, 0.75),
    q75: quantile(curve, 0.25),
    hazardPeak,
    events,
    censored,
  };
}

function quantile(curve: SurvivalPoint[], survivalAt: number): number | null {
  const point = curve.find((row) => row.survival <= survivalAt);
  return point ? point.time : null;
}

function logLogBand(survival: number, se: number): { low: number; high: number } {
  if (survival <= 0) return { low: 0, high: 0 };
  if (survival >= 1 || se <= 0) return { low: survival, high: survival };
  const logS = Math.log(survival);
  const scale = se / (survival * Math.abs(Math.log(survival)));
  const low = Math.exp(-Math.exp(Math.log(-logS) + Z95 * scale));
  const high = Math.exp(-Math.exp(Math.log(-logS) - Z95 * scale));
  return { low: clamp01(Math.min(low, high)), high: clamp01(Math.max(low, high)) };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
