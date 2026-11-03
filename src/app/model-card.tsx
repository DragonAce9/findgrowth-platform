import React from "react";
import { formatRatio } from "@/engine/client-copy";
import type { StoredModelCard } from "@/engine/registry";
import { scoringActivation } from "@/engine/scoring-gate";
import { ReasonCodes } from "./reason-codes";
import { GroupedChart } from "./week-charts";

type Band = { value?: unknown; low?: unknown; high?: unknown };

/** Operator card. Missing PSI and champion decision stay a sentence, not a made-up number. */
export function ModelCard({ row }: { row: StoredModelCard | null }) {
  if (!row) return <p className="source">Карточки модели для этого проекта нет.</p>;
  const pr = bandOf(row.metrics, "pr_auc");
  const brier = bandOf(row.metrics, "brier");
  const psi = typeof row.card?.psi === "number" ? row.card.psi : null;
  const bins = calibrationBins(row.card?.calibration);
  const binsHaveBand = bins.some((bin) => bin.low !== undefined && bin.high !== undefined);
  return (
    <article className="proof">
      <div className="proof-kicker">
        Модель v{row.version} <StatusChip status={row.status} />
      </div>
      <h2>Подсказывает товар и ведро покупателя</h2>
      <p className="lede">
        Ведро покупателя — подсказка модели, не список письма. Список письма задаётся на неделе: одна покупка и последняя оплата старше цикла.
      </p>
      <div className="kpis">
        <article className="kpi">
          <div className="val text">{pr ? formatRatio(pr.value) : "—"}</div>
          <div className="lbl">{pr?.low !== undefined && pr.high !== undefined ? `PR-AUC, ${formatRatio(pr.low)}–${formatRatio(pr.high)}` : "PR-AUC, интервал не посчитан"}</div>
        </article>
        <article className="kpi">
          <div className="val text">{brier ? formatRatio(brier.value) : "—"}</div>
          <div className="lbl">
            {brier?.low !== undefined && brier.high !== undefined ? `Brier, ${formatRatio(brier.low)}–${formatRatio(brier.high)}` : "Brier, интервал не посчитан"}
          </div>
        </article>
      </div>
      {bins.length ? (
        <GroupedChart
          title="Калибровка по бинам"
          unit="%"
          groups={bins.map((bin, index) => ({
            label: `Бин ${index + 1}`,
            bars: [
              { value: asPct(bin.predicted), fill: "var(--sand)" },
              {
                value: asPct(bin.observed),
                fill: "var(--sage)",
                band:
                  bin.low !== undefined && bin.high !== undefined
                    ? ([asPct(bin.low), asPct(bin.high)] as [number, number])
                    : undefined,
              },
            ],
          }))}
          legend={[
            { swatch: "sand", text: "Предсказано" },
            { swatch: "sage", text: "Наблюдаемое" },
            ...(binsHaveBand ? [{ swatch: "", text: "Усы — интервал бутстрепа по бинам.", wide: true }] : []),
          ]}
        />
      ) : (
        <p className="note">Калибровка в карточке не записана.</p>
      )}
      {bins.length && !binsHaveBand ? <p className="source">Интервала по бинам в карточке нет.</p> : null}
      {psi === null ? <p className="source">PSI и решение чемпиона движок ещё не записывает.</p> : <p className="lede">PSI {formatRatio(psi)} · порог 0,25</p>}
      {row.card?.synthetic === true ? <p className="note warn">Синтетическая модель: это не факт на экране.</p> : null}
    </article>
  );
}

/** Brand layer: one sentence, no metrics. Absent when the project has no model row. */
export function BrandModelCard({
  row,
  profilingNotice,
  customerNotice,
  bucket,
  reasons,
}: {
  row: StoredModelCard | null;
  profilingNotice?: boolean;
  customerNotice?: boolean;
  bucket: "top" | "middle" | "bottom" | null;
  reasons: string[];
}) {
  if (!row) return null;
  const live = scoringActivation({ profilingNotice, customerNotice }) === "live";
  return (
    <article className="proof">
      <div className="proof-kicker">Модель</div>
      <h2>
        Модель подсказывает товар · {live ? <span className="status ok">✓ в работе</span> : <span className="tag hidden">○ в тени</span>}
      </h2>
      <p className="lede">
        {live
          ? "Предложение и группа письма учитывают её подсказку. Адресов и скоринга в брифе нет."
          : "Предложение и группа письма от неё не меняются, пока оператор не записал уведомление о профилировании."}
      </p>
      <ReasonCodes bucket={bucket} reasons={reasons} />
    </article>
  );
}

function StatusChip({ status }: { status: StoredModelCard["status"] }) {
  if (status === "champion") {
    return (
      <span className="status ok" role="status">
        ✓ чемпион
      </span>
    );
  }
  if (status === "challenger") {
    return (
      <span className="tag" role="status">
        претендент
      </span>
    );
  }
  return (
    <span className="tag hidden" role="status">
      ○ тень
    </span>
  );
}

function calibrationBins(raw: unknown): Array<{ predicted: number; observed: number; low?: number; high?: number }> {
  if (!Array.isArray(raw)) return [];
  const bins: Array<{ predicted: number; observed: number; low?: number; high?: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as { predicted?: unknown; observed?: unknown; low?: unknown; high?: unknown };
    if (typeof row.predicted !== "number" || typeof row.observed !== "number") continue;
    bins.push({
      predicted: row.predicted,
      observed: row.observed,
      low: typeof row.low === "number" ? row.low : undefined,
      high: typeof row.high === "number" ? row.high : undefined,
    });
  }
  return bins;
}

function asPct(value: number): number {
  const scaled = Math.abs(value) <= 1 ? value * 100 : value;
  return Math.round(scaled * 10) / 10;
}

function bandOf(metrics: Record<string, unknown> | null, name: string): { value: number; low?: number; high?: number } | null {
  const raw = metrics?.[name];
  if (!raw || typeof raw !== "object") return null;
  const band = raw as Band;
  if (typeof band.value !== "number") return null;
  return {
    value: band.value,
    low: typeof band.low === "number" ? band.low : undefined,
    high: typeof band.high === "number" ? band.high : undefined,
  };
}
