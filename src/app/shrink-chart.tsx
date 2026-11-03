import React from "react";
import { formatCount } from "@/engine/client-copy";
import { evidenceState, segmentReads, type EvidenceRule } from "@/engine/stats";
import { EvidenceBadge } from "./evidence";
import { MethodDetails } from "./glossary";
import { GroupedChart } from "./week-charts";

/** Raw rate beside the empirical-Bayes rate. Whiskers sit on the shrunk bar. */
export function ShrinkChart({
  title,
  rows,
  rule,
}: {
  title: string;
  rows: Array<{ id: string; label: string; successes: number; n: number }>;
  rule: EvidenceRule;
}) {
  if (!rows.length) return null;
  const reads = segmentReads(rows.map((row) => ({ id: row.id, successes: row.successes, n: row.n })));
  const byId = new Map(reads.map((row) => [row.id, row]));
  const totalS = rows.reduce((sum, row) => sum + row.successes, 0);
  const totalN = rows.reduce((sum, row) => sum + row.n, 0);
  const mean = totalN ? (totalS / totalN) * 100 : 0;
  const anyDiffers = reads.some((row) => row.differs);
  const visible = rows.some((row) => evidenceState(row.n, rule).level !== "hidden");
  const marked = rows.filter((row) => evidenceState(row.n, rule).level !== "enough");
  const pct = (value: number) => Math.round(value * 1000) / 10;
  const groups = rows.map((row) => {
    const read = byId.get(row.id);
    const state = evidenceState(row.n, rule);
    const hidden = state.level === "hidden";
    return {
      label: row.label,
      caption: hidden ? undefined : `n ${formatCount(row.n)}${read?.differs ? " · отличается от среднего" : ""}`,
      evidence: state.level,
      bars:
        hidden || !read
          ? []
          : [
              { value: pct(read.raw), fill: "var(--sand)" },
              {
                value: pct(read.shrunk),
                fill: "var(--rose)",
                band: [pct(read.low), pct(read.high)] as [number, number],
              },
            ],
    };
  });
  return (
    <>
      <GroupedChart
        title={title}
        unit="%"
        groups={groups}
        mark={visible ? mean : undefined}
        legend={[
          { swatch: "sand", text: "Доля в файле" },
          { swatch: "rose", text: "Доля, притянутая к общей" },
          { swatch: "", text: "Усы — коридор неопределённости. Пунктир — среднее по выгрузке.", wide: true },
        ]}
      />
      {marked.length ? (
        <p className="proof-kicker">
          {marked.map((row) => (
            <span key={row.id}>
              {row.label} <EvidenceBadge n={row.n} rule={rule} /> {evidenceState(row.n, rule).reason}
            </span>
          ))}
        </p>
      ) : null}
      <MethodDetails summary="Как читается притянутая доля">
        <p>
          Усаженная доля. Усы — интервал постериора. Пунктир — среднее по срезу. Усадка тянет малые группы к среднему. Усадка —
          доля притянута к общей, потому что в маленькой группе случайный всплеск недостоверен. «Отличается от среднего» — только
          после поправки Бенджамини–Хохберга. Бенджамини–Хохберг — поправка, когда сравнивается много групп сразу. Постериор —
          коридор доли после того, как её притянули к общей.
          {anyDiffers ? " В этом срезе такие группы есть." : " В этом срезе таких групп нет."}
        </p>
      </MethodDetails>
    </>
  );
}
