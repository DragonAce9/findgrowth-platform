import React from "react";
import { decisionLabel, formatCount, formatPct, formatPp, personRateBand } from "@/engine/client-copy";
import { MOVE_DECISION_RU, MOVE_THRESHOLDS, moveDecision, shownPeople } from "@/engine/stats";
import type { ExperimentReadiness } from "@/engine/experiments";
import type { SurvivalPoint } from "@/engine/survival";
import type { EntityRow, MetricTable, OrderRow } from "@/engine/types";
import { DataNotice } from "./data-notice";
import { CUT_GLOSS, Gloss, MethodDetails } from "./glossary";

const W = 880;
const H = 360;
const PAD = { l: 68, r: 24, t: 28, b: 64 };

/** Diagonal hatch for HiddenStub. `id` must be unique in the document. */
export function HatchDefs({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse">
        <path d="M0 6 L6 0" stroke="var(--muted)" strokeWidth="1" />
      </pattern>
    </defs>
  );
}

function hatchId(label: string): string {
  let hash = 0;
  for (const char of label) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return `hatch-${hash.toString(36)}`;
}

export interface RecencyBucket {
  from: number;
  to: number;
  inCycle: number;
  letter: number;
  other: number;
  inCycleRevenue: number;
  letterRevenue: number;
  otherRevenue: number;
}

export function recencyBuckets(entities: EntityRow[], asOfIso: string, threshold: number): RecencyBucket[] {
  const asOf = Date.parse(asOfIso);
  const size = 10;
  const buyers = entities.filter((entity) => entity.converted && entity.last_purchase_at);
  const points = buyers.map((entity) => {
    const days = (asOf - Date.parse(entity.last_purchase_at ?? asOfIso)) / 86_400_000;
    const letter = days > threshold && entity.n_orders >= 2;
    const inCycle = days <= threshold;
    return { days, letter, inCycle, revenue: entity.ltv };
  });
  const maxDay = Math.max(threshold, ...points.map((point) => point.days), 0);
  const count = Math.floor(maxDay / size) + 1;
  const buckets: RecencyBucket[] = Array.from({ length: count }, (_, index) => ({
    from: index * size,
    to: (index + 1) * size,
    inCycle: 0,
    letter: 0,
    other: 0,
    inCycleRevenue: 0,
    letterRevenue: 0,
    otherRevenue: 0,
  }));
  for (const point of points) {
    const index = Math.min(count - 1, Math.max(0, Math.floor(point.days / size)));
    const bucket = buckets[index];
    if (!bucket) continue;
    if (point.letter) {
      bucket.letter += 1;
      bucket.letterRevenue += point.revenue;
    } else if (point.inCycle) {
      bucket.inCycle += 1;
      bucket.inCycleRevenue += point.revenue;
    } else {
      bucket.other += 1;
      bucket.otherRevenue += point.revenue;
    }
  }
  return buckets;
}

export function RecencyChart({ buckets, threshold }: { buckets: RecencyBucket[]; threshold: number }) {
  const frame = plotFrame(Math.max(...buckets.map((bucket) => bucket.inCycle + bucket.letter + bucket.other), 1));
  const slot = frame.innerW / Math.max(buckets.length, 1);
  const barW = Math.min(26, slot * 0.62);
  const size = buckets[0] ? buckets[0].to - buckets[0].from : 10;
  const xAt = (day: number) => PAD.l + (day / size) * slot;
  const letterN = buckets.reduce((sum, bucket) => sum + bucket.letter, 0);
  const cycleN = buckets.reduce((sum, bucket) => sum + bucket.inCycle, 0);
  const otherN = buckets.reduce((sum, bucket) => sum + bucket.other, 0);
  const last = buckets.length * size;

  return (
    <figure className="plot-figure">
      <div className="plot-scroll">
        <svg className="plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={cycleN === 0 && letterN + otherN > 0 ? "Все покупатели старше цикла" : "Покупатели по дням с последней оплаты"}>
          <HatchDefs id="hatch-recency" />
          <title>{cycleN === 0 && letterN + otherN > 0 ? "Все покупатели старше цикла" : "Покупатели по дням с последней оплаты"}</title>
          <PlotGrid frame={frame} />
          <line x1={xAt(threshold)} x2={xAt(threshold)} y1={PAD.t} y2={frame.base} stroke="var(--rose)" strokeWidth="1.5" />
          <text x={xAt(threshold) + 6} y={PAD.t + 14} fill="var(--rose)" fontSize="13" fontWeight="650">
            {threshold} дней
          </text>
          {buckets.map((bucket, index) => {
            const total = bucket.inCycle + bucket.letter + bucket.other;
            const x = PAD.l + slot * index + (slot - barW) / 2;
            const parts = [
              { n: bucket.other, fill: "var(--sand)" },
              { n: bucket.inCycle, fill: "var(--sage)" },
              { n: bucket.letter, fill: "var(--rose)" },
            ];
            let stacked = 0;
            return (
              <g key={bucket.from}>
                {parts.map((part) => {
                  if (part.n <= 0) return null;
                  const y = frame.y(stacked + part.n);
                  const height = frame.y(stacked) - y;
                  stacked += part.n;
                  return <rect key={part.fill} x={x} y={y} width={barW} height={height} rx="3" fill={part.fill} />;
                })}
                {total > 0 ? (
                  <text x={x + barW / 2} y={frame.y(total) - 8} textAnchor="middle" fill="var(--ink)" fontSize="13" fontWeight="650">
                    {total}
                  </text>
                ) : null}
              </g>
            );
          })}
          {Array.from({ length: Math.floor(last / 30) + 1 }, (_, index) => index * 30).map((day) => (
            <text key={day} x={xAt(day)} y={frame.base + 22} textAnchor="middle" fill="var(--muted)" fontSize="13">
              {day}
            </text>
          ))}
          <text x={(PAD.l + W - PAD.r) / 2} y={H - 14} textAnchor="middle" fill="var(--muted)" fontSize="13">
            Дней с последней оплаты
          </text>
        </svg>
      </div>
      <span className="scroll-hint">График прокручивается вбок.</span>
      <ul className="legend">
        <li>
          <i className="swatch rose" />
          Уже возвращались и старше линии, {letterN}
        </li>
        <li>
          <i className="swatch sage" />
          Последняя покупка левее линии, {cycleN}
        </li>
        <li>
          <i className="swatch sand" />
          Одна покупка и старше линии, {otherN}
        </li>
      </ul>
    </figure>
  );
}

const FUNNEL_LABEL: Record<string, string> = {
  visit: "Зашли",
  pdp: "Карточка",
  cta: "Кнопка",
  checkout: "Оплата",
  purchase: "Купили",
};

export interface RepeatView {
  buckets: Array<{ from: number; to: number; inside: number; late: number }>;
  inside: number;
  late: number;
  none: number;
  early: number;
  windowDays: number;
}

export function repeatView(entities: EntityRow[], windowDays: number): RepeatView {
  const size = 10;
  const gaps: number[] = [];
  let none = 0;
  let early = 0;
  for (const entity of entities) {
    if (!entity.converted || entity.age_days === null) continue;
    if (entity.age_days < windowDays) {
      early += 1;
      continue;
    }
    if (!entity.second_purchase_at || !entity.first_purchase_at) {
      none += 1;
      continue;
    }
    gaps.push((Date.parse(entity.second_purchase_at) - Date.parse(entity.first_purchase_at)) / 86_400_000);
  }
  const maxDay = Math.max(windowDays, ...gaps, 0);
  const count = Math.floor(maxDay / size) + 1;
  const buckets = Array.from({ length: count }, (_, index) => ({
    from: index * size,
    to: (index + 1) * size,
    inside: 0,
    late: 0,
  }));
  let inside = 0;
  let late = 0;
  for (const gap of gaps) {
    const index = Math.min(count - 1, Math.max(0, Math.floor(gap / size)));
    const bucket = buckets[index];
    if (!bucket) continue;
    if (gap <= windowDays) {
      bucket.inside += 1;
      inside += 1;
    } else {
      bucket.late += 1;
      late += 1;
    }
  }
  return { buckets, inside, late, none, early, windowDays };
}

export function RepeatWindowChart({ view }: { view: RepeatView }) {
  const size = view.buckets[0] ? view.buckets[0].to - view.buckets[0].from : 10;
  const extras = [
    view.none > 0 ? { id: "none", label: "Нет второй", n: view.none, fill: "var(--ink)" } : null,
    view.early > 0 ? { id: "early", label: "Рано", n: view.early, fill: "var(--sand)" } : null,
  ].filter((item): item is { id: string; label: string; n: number; fill: string } => item !== null);
  const spacer = extras.length ? 1.2 : 0;
  const extraStep = 1.8;
  const slots = view.buckets.length + spacer + (extras.length ? 1 + (extras.length - 1) * extraStep : 0);
  const frame = plotFrame(Math.max(...view.buckets.map((bucket) => bucket.inside + bucket.late), ...extras.map((item) => item.n), 1));
  const slot = frame.innerW / Math.max(slots, 1);
  const barW = Math.min(26, slot * 0.62);
  const xAt = (day: number) => PAD.l + (day / size) * slot;
  const last = view.buckets.length * size;

  return (
    <figure className="plot-figure">
      <div className="plot-scroll">
        <svg className="plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Дни от первой покупки до второй">
          <HatchDefs id="hatch-cycle" />
          <title>Дни от первой покупки до второй</title>
          <PlotGrid frame={frame} />
          <line x1={xAt(view.windowDays)} x2={xAt(view.windowDays)} y1={PAD.t} y2={frame.base} stroke="var(--rose)" strokeWidth="1.5" />
          <text x={xAt(view.windowDays) + 6} y={PAD.t + 14} fill="var(--rose)" fontSize="13" fontWeight="650">
            {view.windowDays} дней
          </text>
          {view.buckets.map((bucket, index) => {
            const total = bucket.inside + bucket.late;
            const x = PAD.l + slot * index + (slot - barW) / 2;
            const parts = [
              { n: bucket.inside, fill: "var(--sage)" },
              { n: bucket.late, fill: "var(--rose)" },
            ];
            let stacked = 0;
            return (
              <g key={bucket.from}>
                {parts.map((part) => {
                  if (part.n <= 0) return null;
                  const y = frame.y(stacked + part.n);
                  const height = frame.y(stacked) - y;
                  stacked += part.n;
                  return <rect key={part.fill} x={x} y={y} width={barW} height={height} rx="3" fill={part.fill} />;
                })}
                {total > 0 ? (
                  <text x={x + barW / 2} y={frame.y(total) - 8} textAnchor="middle" fill="var(--ink)" fontSize="13" fontWeight="650">
                    {total}
                  </text>
                ) : null}
              </g>
            );
          })}
          {extras.map((item, index) => {
            const x = PAD.l + slot * (view.buckets.length + spacer + index * extraStep) + (slot - barW) / 2;
            const y = frame.y(item.n);
            return (
              <g key={item.id}>
                <rect x={x} y={y} width={barW} height={Math.max(frame.base - y, 0)} rx="3" fill={item.fill} />
                <text x={x + barW / 2} y={y - 8} textAnchor="middle" fill="var(--ink)" fontSize="13" fontWeight="650">
                  {item.n}
                </text>
                <text x={x + barW / 2} y={frame.base + 22} textAnchor="middle" fill="var(--ink)" fontSize="13">
                  {item.label}
                </text>
              </g>
            );
          })}
          {Array.from({ length: Math.floor(last / 30) + 1 }, (_, index) => index * 30).map((day) => (
            <text key={day} x={xAt(day)} y={frame.base + 22} textAnchor="middle" fill="var(--muted)" fontSize="13">
              {day}
            </text>
          ))}
          <text x={PAD.l + (view.buckets.length * slot) / 2} y={H - 14} textAnchor="middle" fill="var(--muted)" fontSize="13">
            Дней от первой покупки до второй
          </text>
        </svg>
      </div>
      <span className="scroll-hint">График прокручивается вбок.</span>
      <ul className="legend">
        <li>
          <i className="swatch sage" />
          Вторая покупка левее линии, {view.inside}
        </li>
        <li>
          <i className="swatch ink" />
          Второй покупки нет, {view.none}
        </li>
        {view.late > 0 ? (
          <li>
            <i className="swatch rose" />
            Вторая покупка позже {view.windowDays} дней, {view.late}
          </li>
        ) : null}
        {view.early > 0 ? (
          <li>
            <i className="swatch sand" />С первой покупки меньше {view.windowDays} дней, {view.early}
          </li>
        ) : null}
      </ul>
    </figure>
  );
}

export function FunnelChart({ rows, labels }: { rows: MetricTable["rows"]; labels?: Record<string, string> }) {
  const values = rows.map((row) => Number(row.lifetime ?? 0));
  const frame = plotFrame(Math.max(...values, 1));
  const slot = frame.innerW / Math.max(rows.length, 1);
  const barW = Math.min(72, slot * 0.46);
  let dropAt = -1;
  let dropN = 0;
  for (let index = 1; index < values.length; index += 1) {
    const drop = (values[index - 1] ?? 0) - (values[index] ?? 0);
    if (drop > dropN) {
      dropN = drop;
      dropAt = index;
    }
  }

  return (
    <figure className="plot-figure">
      <div className="plot-scroll">
        <svg className="plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Люди по шагам сайта">
          <HatchDefs id="hatch-funnel" />
          <title>Люди по шагам сайта</title>
          <PlotGrid frame={frame} />
          {rows.map((row, index) => {
            const n = values[index] ?? 0;
            const x = PAD.l + slot * index + (slot - barW) / 2;
            const y = frame.y(n);
            const marked = index === dropAt - 1 || index === dropAt;
            const stage = labels?.[String(row.stage)] ?? FUNNEL_LABEL[String(row.stage)] ?? String(row.stage);
            const previous = values[index - 1] ?? 0;
            const share = index > 0 ? personRateBand(n, previous) ?? (previous > 0 && previous < 5 ? "меньше 5" : undefined) : undefined;
            return (
              <g key={String(row.stage)} role="img" aria-label={share ? `${stage}: ${share}` : stage}>
                <rect x={x} y={y} width={barW} height={Math.max(frame.base - y, 0)} rx="4" fill={marked ? "var(--rose)" : "var(--ink)"} fillOpacity={marked ? 1 : 0.78} />
                <text x={x + barW / 2} y={y - 8} textAnchor="middle" fill="var(--ink)" fontSize="14" fontWeight="650">
                  {formatCount(n)}
                </text>
                <text x={x + barW / 2} y={frame.base + 24} textAnchor="middle" fill="var(--ink)" fontSize="14">
                  {stage}
                </text>
                {share ? (
                  <text x={x + barW / 2} y={frame.base + 42} textAnchor="middle" fill="var(--muted)" fontSize="13">
                    {share}
                  </text>
                ) : null}
              </g>
            );
          })}
          {dropAt > 0 ? (
            <text
              x={PAD.l + slot * dropAt}
              y={(frame.y(values[dropAt - 1] ?? 0) + frame.y(values[dropAt] ?? 0)) / 2}
              textAnchor="middle"
              fill="var(--rose)"
              fontSize="14"
              fontWeight="650"
            >
              −{formatCount(dropN)}
            </text>
          ) : null}
        </svg>
      </div>
      <span className="scroll-hint">График прокручивается вбок.</span>
    </figure>
  );
}

export function ExperimentChart({ items }: { items: ExperimentReadiness[] }) {
  const peak = Math.max(...items.flatMap((item) => Object.values(item.n)), 50);
  const frame = plotFrame(peak, 50);
  const slot = frame.innerW / Math.max(items.length, 1);
  const barW = 56;
  const gap = 14;

  return (
    <figure className="plot-figure">
      <div className="plot-scroll">
        <svg className="plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Люди в вариантах тестов">
          <HatchDefs id="hatch-experiment" />
          <title>Люди в вариантах тестов</title>
          <PlotGrid frame={frame} mark={50} />
          {items.map((item, index) => {
            const arms = Object.entries(item.n).sort((a, b) => variantOrder(a[0]) - variantOrder(b[0]));
            const pair = arms.length * barW + (arms.length - 1) * gap;
            const origin = PAD.l + slot * index + (slot - pair) / 2;
            const center = PAD.l + slot * index + slot / 2;
            return (
              <g key={item.experiment_id}>
                {arms.map(([variant, n], arm) => {
                  const x = origin + arm * (barW + gap);
                  const y = frame.y(n);
                  return (
                    <g key={variant}>
                      <rect x={x} y={y} width={barW} height={Math.max(frame.base - y, 0)} rx="4" fill={variant === "variant" ? "var(--rose)" : "var(--sage)"} />
                      <text x={x + barW / 2} y={y - 8} textAnchor="middle" fill="var(--ink)" fontSize="14" fontWeight="650">
                        {n}
                      </text>
                    </g>
                  );
                })}
                <text x={center} y={frame.base + 22} textAnchor="middle" fill="var(--ink)" fontSize="14" fontWeight="650">
                  {item.experiment_id}
                </text>
                <text x={center} y={frame.base + 42} textAnchor="middle" fill={item.ready ? "var(--sage)" : "var(--rose)"} fontSize="13">
                  {item.ready ? "можно читать" : "оставляем"} · {Math.round(item.duration_days)} дн.
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <span className="scroll-hint">График прокручивается вбок.</span>
      <ul className="legend">
        <li>
          <i className="swatch sage" /> Контроль
        </li>
        <li>
          <i className="swatch rose" /> Вариант
        </li>
        <li>
          <i className="swatch dash" /> Порог 50 человек
        </li>
        {items.map((item) => {
          const arms = Object.entries(item.n);
          const total = arms.reduce((sum, [, n]) => sum + n, 0);
          const shares = arms
            .sort((a, b) => variantOrder(a[0]) - variantOrder(b[0]))
            .map(([variant, n]) => {
              const band = personRateBand(n, total);
              const count = shownPeople(n).text;
              return band ? `${variantLabel(variant)} ${count} (${band})` : `${variantLabel(variant)} ${count}`;
            })
            .join(" · ");
          return (
            <li key={item.experiment_id} className="wide">
              {item.experiment_id}: {shares}
              {item.ready ? "" : `. ${cap(decisionLabel(false, item.blockers))}`}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

interface Frame {
  yMax: number;
  ticks: number[];
  innerW: number;
  base: number;
  y: (value: number) => number;
}

function plotFrame(peak: number, include?: number, height = H): Frame {
  const yMax = axisMax(Math.max(peak, include ?? 0));
  const innerH = height - PAD.t - PAD.b;
  return {
    yMax,
    ticks: axisTicks(yMax),
    innerW: W - PAD.l - PAD.r,
    base: PAD.t + innerH,
    y: (value) => PAD.t + innerH - (value / yMax) * innerH,
  };
}

function PlotGrid({ frame, mark, unit = "Человек" }: { frame: Frame; mark?: number; unit?: string }) {
  return (
    <g>
      <text x={PAD.l} y={16} fill="var(--muted)" fontSize="13">
        {unit}
      </text>
      {frame.ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={frame.y(tick)}
            y2={frame.y(tick)}
            stroke={tick === mark ? "var(--ink)" : "var(--line)"}
            strokeDasharray={tick === mark ? "4 4" : undefined}
            strokeWidth={tick === 0 || tick === mark ? 1.25 : 1}
          />
          <text x={PAD.l - 10} y={frame.y(tick)} textAnchor="end" dominantBaseline="middle" fill="var(--muted)" fontSize="13">
            {formatAxis(tick)}
          </text>
        </g>
      ))}
    </g>
  );
}

export interface ChartColumn {
  label: string;
  value: number;
  fill?: string;
  caption?: string;
  /** Interval whisker in the same units as `value`. */
  band?: [number, number];
  evidence?: "enough" | "thin" | "hidden";
}

export interface ScatterPoint {
  x: number;
  y: number;
  fill: string;
}

export function ScatterChart({
  title,
  xLabel,
  yLabel = "Человек",
  points,
  vLine,
  legend,
}: {
  title: string;
  xLabel: string;
  yLabel?: string;
  points: ScatterPoint[];
  vLine?: { x: number; label: string };
  legend?: Array<{ swatch: string; text: string; wide?: boolean }>;
}) {
  const xPeak = Math.max(...points.map((point) => point.x), vLine?.x ?? 0, 1);
  const frame = plotFrame(Math.max(...points.map((point) => point.y), 1));
  const xMax = axisMax(xPeak);
  const xTicks = axisTicks(xMax);
  const xAt = (value: number) => PAD.l + (value / xMax) * frame.innerW;

  return (
    <figure className="plot-figure">
      <div className="plot-scroll">
        <svg className="plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
          <HatchDefs id={hatchId(`scatter-${title}`)} />
          <title>{title}</title>
          <PlotGrid frame={frame} unit={yLabel} />
          {xTicks.map((tick) => (
            <text key={`x-${tick}`} x={xAt(tick)} y={frame.base + 22} textAnchor="middle" fill="var(--muted)" fontSize="13">
              {formatAxis(tick)}
            </text>
          ))}
          <text x={PAD.l + frame.innerW / 2} y={H - 8} textAnchor="middle" fill="var(--muted)" fontSize="13">
            {xLabel}
          </text>
          {vLine ? (
            <>
              <line x1={xAt(vLine.x)} x2={xAt(vLine.x)} y1={PAD.t} y2={frame.base} stroke="var(--rose)" strokeWidth="1.5" />
              <text x={Math.min(xAt(vLine.x) + 6, W - PAD.r - 8)} y={PAD.t + 14} fill="var(--rose)" fontSize="13" fontWeight="650">
                {vLine.label}
              </text>
            </>
          ) : null}
          {points.map((point, index) => {
            const jitterX = ((index % 7) - 3) * 3.2;
            const jitterY = ((index % 5) - 2) * 1.4;
            return (
              <circle
                key={index}
                cx={xAt(point.x) + jitterX}
                cy={frame.y(point.y) + jitterY}
                r="5"
                fill={point.fill}
                fillOpacity="0.72"
              />
            );
          })}
        </svg>
      </div>
      <span className="scroll-hint">График прокручивается вбок.</span>
      {legend?.length ? (
        <ul className="legend">
          {legend.map((item) => (
            <li key={item.text} className={item.wide ? "wide" : undefined}>
              {item.swatch ? <i className={`swatch ${item.swatch}`} /> : null}
              {item.text}
            </li>
          ))}
        </ul>
      ) : null}
    </figure>
  );
}

export function ColumnChart({
  title,
  unit = "Человек",
  columns,
  legend,
}: {
  title: string;
  unit?: string;
  columns: ChartColumn[];
  legend?: Array<{ swatch: string; text: string; wide?: boolean }>;
}) {
  if (columns.length > 0 && columns.every((column) => column.evidence === "hidden")) {
    return <p className="note">{columns[0]?.caption || "Все столбцы скрыты: людей меньше порога."}</p>;
  }
  const peak = Math.max(...columns.map((column) => Math.max(column.value, column.band?.[1] ?? 0)), 1);
  const frame = plotFrame(peak);
  const slot = frame.innerW / Math.max(columns.length, 1);
  const barW = Math.min(72, slot * 0.46);
  const anyBand = columns.some((column) => column.band);
  const heading = anyBand ? `${title} с интервалами` : title;
  return (
    <figure className="plot-figure">
      <div className="plot-scroll">
        <svg className="plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={heading}>
          <HatchDefs id={hatchId(`column-${title}`)} />
          <title>{heading}</title>
          <PlotGrid frame={frame} unit={unit} />
          {columns.map((column, index) => {
            const x = PAD.l + slot * index + (slot - barW) / 2;
            const hidden = column.evidence === "hidden";
            const y = frame.y(hidden ? 0 : column.value);
            const dark = column.fill === "var(--ink)" || column.fill === "var(--rose)";
            return (
              <g key={`${column.label}-${index}`} role="img" aria-label={column.label}>
                {hidden ? (
                  <rect x={x} y={frame.base - 18} width={barW} height={18} fill={`url(#${hatchId(`column-${title}`)})`} />
                ) : (
                  <rect x={x} y={y} width={barW} height={Math.max(frame.base - y, 0)} rx="4" fill={column.fill ?? "var(--ink)"} />
                )}
                {column.band && !hidden ? <Whisker cx={x + barW / 2} y0={frame.y(column.band[0])} y1={frame.y(column.band[1])} dark={dark} /> : null}
                {hidden ? null : (
                  <text x={x + barW / 2} y={y - 8} textAnchor="middle" fill="var(--ink)" fontSize="14" fontWeight="650">
                    {formatAxis(column.value)}
                  </text>
                )}
                <text x={x + barW / 2} y={frame.base + 22} textAnchor="middle" fill="var(--ink)" fontSize="14">
                  {column.label}
                </text>
                {hidden ? (
                  <text x={x + barW / 2} y={frame.base + 40} textAnchor="middle" fill="var(--muted)" fontSize="13">
                    скрыто
                  </text>
                ) : column.caption ? (
                  <text x={x + barW / 2} y={frame.base + 40} textAnchor="middle" fill="var(--muted)" fontSize="13">
                    {column.caption}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <span className="scroll-hint">График прокручивается вбок.</span>
      {legend?.length ? (
        <ul className="legend">
          {legend.map((item) => (
            <li key={item.text} className={item.wide ? "wide" : undefined}>
              {item.swatch ? <i className={`swatch ${item.swatch}`} /> : null}
              {item.text}
            </li>
          ))}
        </ul>
      ) : null}
    </figure>
  );
}

export interface StackColumn {
  label: string;
  parts: Array<{ value: number; fill: string }>;
  caption?: string;
  /** Interval of the stack total, in the same units as the parts. */
  band?: [number, number];
  evidence?: "enough" | "thin" | "hidden";
}

function axisName(label: string): [string, string?] {
  const words = label.split(" ");
  if (words.length < 2) return [label];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

export function StackedChart({
  title,
  unit = "Человек",
  columns,
  legend,
}: {
  title: string;
  unit?: string;
  columns: StackColumn[];
  legend?: Array<{ swatch: string; text: string; wide?: boolean }>;
}) {
  if (columns.length > 0 && columns.every((column) => column.evidence === "hidden")) {
    return <p className="note">Все столбцы скрыты: людей меньше порога.</p>;
  }
  const hatch = hatchId(`stack-${title}`);
  const peak = Math.max(
    ...columns.map((column) => Math.max(column.parts.reduce((sum, part) => sum + part.value, 0), column.band?.[1] ?? 0)),
    1,
  );
  const frame = plotFrame(peak);
  const slot = frame.innerW / Math.max(columns.length, 1);
  const barW = Math.min(72, slot * 0.46);
  const anyBand = columns.some((column) => column.band);
  const heading = anyBand ? `${title} с интервалами` : title;
  return (
    <figure className="plot-figure">
      <div className="plot-scroll">
        <svg className="plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={heading}>
          <HatchDefs id={hatch} />
          <title>{heading}</title>
          <PlotGrid frame={frame} unit={unit} />
          {columns.map((column, index) => {
            const x = PAD.l + slot * index + (slot - barW) / 2;
            const hidden = column.evidence === "hidden";
            const total = column.parts.reduce((sum, part) => sum + part.value, 0);
            let stacked = 0;
            return (
              <g key={`${column.label}-${index}`} role="img" aria-label={column.label}>
                {hidden ? <rect x={x} y={frame.base - 18} width={barW} height={18} fill={`url(#${hatch})`} /> : null}
                {hidden
                  ? null
                  : column.parts.map((part, partIndex) => {
                  if (part.value <= 0) return null;
                  const y = frame.y(stacked + part.value);
                  const height = frame.y(stacked) - y;
                  const marked = stacked;
                  stacked += part.value;
                  return (
                    <g key={`${column.label}-${partIndex}`}>
                      <rect x={x} y={y} width={barW} height={height} rx="3" fill={part.fill} />
                      {height >= 22 ? (
                        <text x={x + barW / 2} y={frame.y(marked + part.value / 2)} textAnchor="middle" dominantBaseline="middle" fill="#fffdf9" fontSize="13" fontWeight="650">
                          {formatAxis(part.value)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
                {column.band && !hidden ? (
                  <Whisker cx={x + barW / 2} y0={frame.y(column.band[0])} y1={frame.y(column.band[1])} dark={false} />
                ) : null}
                {hidden || total <= 0 ? null : (
                  <text x={x + barW / 2} y={frame.y(total) - 8} textAnchor="middle" fill="var(--ink)" fontSize="14" fontWeight="650">
                    {formatAxis(total)}
                  </text>
                )}
                <text x={x + barW / 2} y={frame.base + 22} textAnchor="middle" fill="var(--ink)" fontSize="14">
                  {column.caption ? column.label : axisName(column.label)[0]}
                </text>
                {!column.caption && axisName(column.label)[1] ? (
                  <text x={x + barW / 2} y={frame.base + 38} textAnchor="middle" fill="var(--ink)" fontSize="14">
                    {axisName(column.label)[1]}
                  </text>
                ) : null}
                {hidden ? (
                  <text x={x + barW / 2} y={frame.base + 40} textAnchor="middle" fill="var(--muted)" fontSize="13">
                    скрыто
                  </text>
                ) : column.caption ? (
                  <text x={x + barW / 2} y={frame.base + 40} textAnchor="middle" fill="var(--muted)" fontSize="13">
                    {column.caption}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <span className="scroll-hint">График прокручивается вбок.</span>
      {legend?.length ? (
        <ul className="legend">
          {legend.map((item) => (
            <li key={item.text} className={item.wide ? "wide" : undefined}>
              {item.swatch ? <i className={`swatch ${item.swatch}`} /> : null}
              {item.text}
            </li>
          ))}
        </ul>
      ) : null}
    </figure>
  );
}

export function orderJoinColumns(orders: OrderRow[]): ChartColumn[] {
  const bins = {
    first: { n: 0, revenue: 0 },
    again: { n: 0, revenue: 0 },
    renewal: { n: 0, revenue: 0 },
    orphan: { n: 0, revenue: 0 },
  };
  const seen = new Set<string>();
  const dated = [...orders].sort((a, b) => a.purchased_at.localeCompare(b.purchased_at));
  for (const order of dated) {
    if (order.countsAsOrder === false) continue;
    if (order.orphan) {
      bins.orphan.n += 1;
      bins.orphan.revenue += order.revenue;
      continue;
    }
    if (order.is_subscription_renewal) {
      bins.renewal.n += 1;
      bins.renewal.revenue += order.revenue;
      continue;
    }
    const id = order.entity_id ?? order.order_id;
    if (seen.has(id)) {
      bins.again.n += 1;
      bins.again.revenue += order.revenue;
    } else {
      seen.add(id);
      bins.first.n += 1;
      bins.first.revenue += order.revenue;
    }
  }
  return [
    { label: "Первая", value: bins.first.revenue, fill: "var(--sage)", caption: ordersCaption(bins.first.n) },
    { label: "Вторая", value: bins.again.revenue, fill: "var(--ink)", caption: ordersCaption(bins.again.n) },
    { label: "Продление", value: bins.renewal.revenue, fill: "var(--sand)", caption: ordersCaption(bins.renewal.n) },
    { label: "Без визита", value: bins.orphan.revenue, fill: "var(--rose)", caption: ordersCaption(bins.orphan.n) },
  ].filter((column) => column.value > 0);
}

function ordersCaption(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "заказ" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "заказа" : "заказов";
  return `${count} ${word}`;
}

export interface ChartGroup {
  label: string;
  caption?: string;
  evidence?: "enough" | "thin" | "hidden";
  bars: Array<{ value: number; fill: string; band?: [number, number] }>;
}

export function GroupedChart({
  title,
  unit = "Имён",
  groups,
  legend,
  mark,
}: {
  title: string;
  unit?: string;
  groups: ChartGroup[];
  legend?: Array<{ swatch: string; text: string; wide?: boolean }>;
  /** Dashed pooled mean, in the same units as the bars. */
  mark?: number;
}) {
  if (groups.length > 0 && groups.every((group) => group.evidence === "hidden")) {
    return <p className="note">Все столбцы скрыты: людей меньше порога.</p>;
  }
  const hatch = hatchId(`group-${title}`);
  const values = groups.flatMap((group) =>
    group.evidence === "hidden" ? [] : group.bars.flatMap((bar) => [bar.value, bar.band?.[1] ?? 0]),
  );
  const peak = Math.max(...values, mark ?? 0, 1);
  const frame = plotFrame(peak);
  const slot = frame.innerW / Math.max(groups.length, 1);
  const arms = Math.max(...groups.map((group) => group.bars.length), 1);
  const barW = Math.min(28, (slot * 0.7) / arms);
  const gap = 6;
  const anyBand = groups.some((group) => group.bars.some((bar) => bar.band));
  const heading = anyBand ? `${title} с интервалами` : title;
  return (
    <figure className="plot-figure">
      <div className="plot-scroll">
        <svg className="plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={heading}>
          <HatchDefs id={hatch} />
          <title>{heading}</title>
          <PlotGrid frame={frame} unit={unit} />
          {mark !== undefined ? (
            <g>
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={frame.y(mark)}
                y2={frame.y(mark)}
                stroke="var(--ink)"
                strokeDasharray="4 4"
                strokeWidth={1.25}
              />
              <text x={W - PAD.r} y={frame.y(mark) - 6} textAnchor="end" fill="var(--ink)" fontSize="12">
                среднее
              </text>
            </g>
          ) : null}
          {groups.map((group, index) => {
            const pair = arms * barW + (arms - 1) * gap;
            const origin = PAD.l + slot * index + (slot - pair) / 2;
            const center = PAD.l + slot * index + slot / 2;
            const hidden = group.evidence === "hidden";
            return (
              <g key={group.label} role="img" aria-label={group.caption ? `${group.label}: ${group.caption}` : group.label}>
                {hidden ? (
                  <rect x={origin} y={frame.base - 18} width={Math.max(pair, barW)} height={18} fill={`url(#${hatch})`} />
                ) : (
                  group.bars.map((bar, arm) => {
                    const x = origin + arm * (barW + gap);
                    const y = frame.y(bar.value);
                    const dark = bar.fill === "var(--ink)" || bar.fill === "var(--rose)";
                    return (
                      <g key={`${group.label}-${arm}`}>
                        <rect x={x} y={y} width={barW} height={Math.max(frame.base - y, 0)} rx="3" fill={bar.fill} />
                        {bar.band ? (
                          <Whisker cx={x + barW / 2} y0={frame.y(bar.band[0])} y1={frame.y(bar.band[1])} dark={dark} />
                        ) : null}
                        <text x={x + barW / 2} y={y - 8} textAnchor="middle" fill="var(--ink)" fontSize="13" fontWeight="650">
                          {formatAxis(bar.value)}
                        </text>
                      </g>
                    );
                  })
                )}
                <text x={center} y={frame.base + 22} textAnchor="middle" fill="var(--ink)" fontSize="13">
                  {axisName(group.label)[0]}
                </text>
                {axisName(group.label)[1] ? (
                  <text x={center} y={frame.base + 38} textAnchor="middle" fill="var(--ink)" fontSize="13">
                    {axisName(group.label)[1]}
                  </text>
                ) : null}
                {hidden ? (
                  <text x={center} y={frame.base + (axisName(group.label)[1] ? 54 : 40)} textAnchor="middle" fill="var(--muted)" fontSize="13">
                    скрыто
                  </text>
                ) : group.caption ? (
                  <text x={center} y={frame.base + (axisName(group.label)[1] ? 54 : 40)} textAnchor="middle" fill="var(--muted)" fontSize="13">
                    {group.caption}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <span className="scroll-hint">График прокручивается вбок.</span>
      {legend?.length ? (
        <ul className="legend">
          {legend.map((item) => (
            <li key={item.text} className={item.wide ? "wide" : undefined}>
              {item.swatch ? <i className={`swatch ${item.swatch}`} /> : null}
              {item.text}
            </li>
          ))}
        </ul>
      ) : null}
    </figure>
  );
}

function axisMax(value: number): number {
  if (value <= 0) return 1;
  const padded = value * 1.22;
  const pow = 10 ** Math.floor(Math.log10(padded));
  const n = padded / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * pow;
}

function axisTicks(max: number): number[] {
  const step = max <= 25 ? 5 : niceStep(max / 4);
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 0.01; value += step) ticks.push(Math.round(value));
  return ticks;
}

function niceStep(value: number): number {
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * pow;
}

function variantOrder(name: string): number {
  if (name === "control") return 0;
  if (name === "variant") return 1;
  return 2;
}

function variantLabel(name: string): string {
  if (name === "control") return "контроль";
  if (name === "variant") return "вариант";
  return name;
}

function cap(text: string): string {
  return text
    .split(". ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(". ");
}

function formatAxis(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: Number.isInteger(rounded) ? 0 : 1 }).format(rounded);
}

function Whisker({ cx, y0, y1, dark }: { cx: number; y0: number; y1: number; dark: boolean }) {
  const same = Math.abs(y0 - y1) < 0.5;
  return (
    <g>
      {dark && !same ? <line x1={cx} x2={cx} y1={y0} y2={y1} stroke="#fffdf9" strokeWidth={3.25} /> : null}
      {same ? null : <line x1={cx} x2={cx} y1={y0} y2={y1} stroke="var(--ink)" strokeWidth={1.25} opacity={0.9} />}
      <line x1={cx - 5} x2={cx + 5} y1={y0} y2={y0} stroke="var(--ink)" strokeWidth={1.25} />
      {same ? null : <line x1={cx - 5} x2={cx + 5} y1={y1} y2={y1} stroke="var(--ink)" strokeWidth={1.25} />}
    </g>
  );
}

function endLabel(value: number): string {
  const pp = Math.round(value * 1000) / 10;
  const body = (Number.isInteger(pp) ? String(Math.abs(pp)) : Math.abs(pp).toFixed(1)).replace(".", ",");
  if (pp > 0) return `+${body}`;
  if (pp < 0) return `\u2212${body}`;
  return body;
}

/** Horizontal difference of proportions. Height 72. Zero stays inside the axis. */
export function DiffScale({ diff, low, high, width = W }: { diff: number | null; low: number; high: number; width?: number }) {
  if (diff === null || !Number.isFinite(diff)) return null;
  const height = 72;
  const pad = 72;
  const lo = Math.min(low, 0);
  const hi = Math.max(high, 0);
  const span = Math.max(hi - lo, 1e-6);
  const min = lo - span * 0.1;
  const max = hi + span * 0.1;
  const x = (value: number) => pad + ((value - min) / (max - min)) * (width - pad * 2);
  const touches = low < 0 && high > 0;
  const barY = 30;
  const fill = low > 0 ? "rgba(15, 118, 110, 0.18)" : high < 0 ? "rgba(185, 28, 28, 0.14)" : "var(--paper-2)";
  const label = `${formatPp(diff, low, high)}${touches ? ", задевает ноль" : ""}`;
  return (
    <figure className="scale-figure">
      <svg className="scale" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Разница повтора ${label}`}>
        <title>Шкала разницы повтора</title>
        <text x={8} y={16} fill="var(--muted)" fontSize="12">
          меньше повтора ←
        </text>
        <text x={width - 8} y={16} textAnchor="end" fill="var(--muted)" fontSize="12">
          → больше повтора
        </text>
        <rect x={x(low)} y={barY} width={Math.max(x(high) - x(low), 2)} height={12} rx={6} fill={fill} />
        <line x1={x(low)} x2={x(low)} y1={barY - 2} y2={barY + 18} stroke="var(--muted)" strokeWidth={2} />
        <line x1={x(high)} x2={x(high)} y1={barY - 2} y2={barY + 18} stroke="var(--muted)" strokeWidth={2} />
        <line x1={x(0)} x2={x(0)} y1={barY - 8} y2={barY + 28} stroke="var(--ink)" strokeWidth={1.5} />
        <circle cx={x(diff)} cy={barY + 6} r={6} fill="var(--ink)" />
        <text x={x(low)} y={height - 4} textAnchor="middle" fill="var(--muted)" fontSize="13">
          {endLabel(low)}
        </text>
        <text x={x(high)} y={height - 4} textAnchor="middle" fill="var(--muted)" fontSize="13">
          {endLabel(high)}
        </text>
        <text x={x(diff)} y={barY - 6} textAnchor="middle" fill="var(--ink)" fontSize="13" fontWeight="650">
          {endLabel(diff)}
        </text>
      </svg>
      <p className="source">Разница повтора в процентных пунктах.</p>
      <MethodDetails summary="Как посчитан коридор">
        <p>Интервал Ньюкомба 95 %. Ньюкомб — способ посчитать коридор разницы двух долей.</p>
      </MethodDetails>
    </figure>
  );
}

export function StepChart({
  curve,
  median,
  hazardPeak,
  window,
  prior,
  n,
  size = "full",
}: {
  curve: SurvivalPoint[];
  median: number | null;
  q25?: number | null;
  hazardPeak: number | null;
  window: { low: number; high: number; fromData: boolean };
  prior: { low: number; high: number };
  n: number;
  size?: "full" | "small";
}) {
  if (n === 0) {
    return (
      <>
        <p className="note">
          Вторых покупок в выгрузке нет, своей линии дней до второй покупки ещё нет. Пока окно задано заранее: день {prior.low}–{prior.high}.
        </p>
        <MethodDetails summary="Откуда это окно">
          <p>
            Окно — день {prior.low}–{prior.high} из приора категории. Приор — то, что накоплено с прошлых срезов, до этого письма.
          </p>
        </MethodDetails>
      </>
    );
  }
  if (!curve.length) {
    return (
      <DataNotice
        seen={`Кривая цикла в этом срезе не посчитана. Окно — день ${window.low}–${window.high}.`}
        why="Движок не отдал точки кривой."
        means="Окно отправки на экране есть, полосы Гринвуда нет."
      />
    );
  }
  const small = size === "small";
  const height = small ? 160 : H;
  const width = small ? 520 : W;
  const pad = small ? { l: 44, r: 16, t: 20, b: 36 } : PAD;
  const xTop = Math.max(30, Math.ceil(Math.max(...curve.map((point) => point.time), window.high, prior.high, hazardPeak ?? 0) / 30) * 30);
  const x = (time: number) => pad.l + (Math.min(Math.max(time, 0), xTop) / xTop) * (width - pad.l - pad.r);
  const y = (survival: number) => pad.t + (1 - Math.min(Math.max(survival, 0), 1)) * (height - pad.t - pad.b);
  const thin = n < 8;
  const forward = curve.map((point) => `${x(point.time)},${y(point.high)}`).join(" ");
  const back = [...curve].reverse().map((point) => `${x(point.time)},${y(point.low)}`).join(" ");
  let step = `M ${x(0)} ${y(1)}`;
  for (const point of curve) step += ` H ${x(point.time)} V ${y(point.survival)}`;
  step += ` H ${x(xTop)}`;
  const ticks = small ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
  const dayTicks: number[] = [];
  for (let day = 0; day <= xTop; day += 30) dayTicks.push(day);
  const peak = hazardPeak;
  const aria = `Доля без второй покупки по дням: медиана ${median ?? "нет"} день, окно отправки день ${window.low}–${window.high}${peak !== null ? `, пик на ${Math.round(peak)}-й день` : ""}, ${n} пар, полоса — интервал Гринвуда 95 %`;
  return (
    <figure className="plot-figure">
      <div className={small ? undefined : "plot-scroll"}>
        <svg className={small ? "plot small" : "plot"} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={aria}>
          <title>Кривая цикла</title>
          {!window.fromData || thin ? (
            <rect x={x(prior.low)} y={pad.t} width={Math.max(x(prior.high) - x(prior.low), 1)} height={height - pad.t - pad.b} fill="var(--paper-2)" />
          ) : null}
          <rect
            x={x(window.low)}
            y={pad.t}
            width={Math.max(x(window.high) - x(window.low), 1)}
            height={height - pad.t - pad.b}
            fill="var(--rose)"
            opacity={0.08}
          />
          <polygon points={`${forward} ${back}`} fill="var(--sage)" opacity={0.16} />
          {ticks.map((tick) =>
            small && tick === 1 ? null : (
              <line
                key={tick}
                x1={pad.l}
                x2={width - pad.r}
                y1={y(tick)}
                y2={y(tick)}
                stroke={tick === 0 || tick === 0.5 ? "var(--line)" : "var(--line)"}
                strokeWidth={1}
              />
            ),
          )}
          {(small ? [0, 0.5, 1] : ticks).map((tick) => (
            <text key={`y-${tick}`} x={pad.l - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle" fill="var(--muted)" fontSize="13">
              {Math.round(tick * 100)} %
            </text>
          ))}
          {dayTicks.map((day) => (
            <text key={day} x={x(day)} y={height - 8} textAnchor="middle" fill="var(--muted)" fontSize="12">
              {day}
            </text>
          ))}
          <path d={step} fill="none" stroke="var(--ink)" strokeWidth={thin ? 1.5 : 2} strokeLinejoin="miter" />
          {median !== null ? (
            <line x1={x(median)} x2={x(median)} y1={pad.t} y2={height - pad.b} stroke="var(--rose)" strokeDasharray="4 4" strokeWidth={1.25} />
          ) : null}
          {peak !== null ? (
            <polygon points={`${x(peak)},${pad.t + 2} ${x(peak) - 6},${pad.t + 14} ${x(peak) + 6},${pad.t + 14}`} fill="var(--ink)" />
          ) : null}
          <text x={Math.min(x(window.high) + 6, width - pad.r)} y={pad.t + 14} fill="var(--rose)" fontSize="13">
            окно отправки: день {window.low}–{window.high}
          </text>
        </svg>
      </div>
      {small ? null : <span className="scroll-hint">График прокручивается вбок.</span>}
      {thin ? (
        <>
          <p className="source">
            <span className="tag thin">◐ мало данных</span> Линия дней до второй покупки притянута к обычной для категории, день {prior.low}–{prior.high}.
          </p>
          <MethodDetails summary="Почему линия притянута">
            <p>
              Усадка к приору категории, день {prior.low}–{prior.high}. Усадка — доля притянута к общей, потому что в маленькой группе
              случайный всплеск недостоверен. Приор — то, что накоплено с прошлых срезов, до этого письма.
            </p>
          </MethodDetails>
        </>
      ) : null}
      {peak !== null && peak > window.high ? (
        <>
          <p className="source">День, когда вторая покупка вероятнее всего, — день {Math.round(peak)}, он за пределами окна.</p>
          <MethodDetails summary="Как назван этот день">
            <p>Пик хазарда — день {Math.round(peak)}, за пределами окна.</p>
          </MethodDetails>
        </>
      ) : null}
    </figure>
  );
}

/** One-slice posterior. Cross-slice storage is named in the source when it is absent. */
export function AccumulationScale({
  prob,
  moveName,
  slices = 1,
  stored = false,
}: {
  prob: number;
  moveName: string;
  slices?: number;
  stored?: boolean;
}) {
  const decision = moveDecision(prob);
  const word = MOVE_DECISION_RU[decision];
  const width = W;
  const height = 72;
  const pad = 16;
  const x = (value: number) => pad + value * (width - pad * 2);
  const marker = decision === "stop" ? "■ остановить" : decision === "scale" ? "↑ масштабировать" : "→ продолжать";
  return (
    <figure className="scale-figure">
      <h2>
        Накоплено по ходу «{moveName}» за {slices} <Gloss title={CUT_GLOSS}>срез</Gloss>
      </h2>
      <svg className="scale" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Накопленная вероятность ${prob.toFixed(2).replace(".", ",")} из 1; пороги ${MOVE_THRESHOLDS.stopAt.toString().replace(".", ",")} и ${MOVE_THRESHOLDS.scaleAt.toString().replace(".", ",")}; решение — ${word}`}>
        <title>Шкала накопления</title>
        <rect x={x(0)} y={28} width={x(MOVE_THRESHOLDS.stopAt) - x(0)} height={16} fill="var(--danger-soft)" />
        <rect x={x(MOVE_THRESHOLDS.stopAt)} y={28} width={x(MOVE_THRESHOLDS.scaleAt) - x(MOVE_THRESHOLDS.stopAt)} height={16} fill="var(--gold-soft)" />
        <rect x={x(MOVE_THRESHOLDS.scaleAt)} y={28} width={x(1) - x(MOVE_THRESHOLDS.scaleAt)} height={16} fill="var(--sage-soft)" />
        <line x1={x(MOVE_THRESHOLDS.stopAt)} x2={x(MOVE_THRESHOLDS.stopAt)} y1={22} y2={50} stroke="var(--ink)" strokeWidth={1.25} />
        <line x1={x(MOVE_THRESHOLDS.scaleAt)} x2={x(MOVE_THRESHOLDS.scaleAt)} y1={22} y2={50} stroke="var(--ink)" strokeWidth={1.25} />
        <circle cx={x(prob)} cy={36} r={6} fill="var(--ink)" />
        <text x={x(prob)} y={16} textAnchor="middle" fill="var(--ink)" fontSize="13" fontWeight="650">
          {prob.toFixed(2).replace(".", ",")}
        </text>
      </svg>
      <p className="lede">
        Вероятность, что письмо даёт повтор чаще: {formatPct(prob)}. Решение: {marker}.
      </p>
      {slices === 1 ? (
        <>
          <p className="lede">Первая выгрузка: вывод ещё рано считать точным.</p>
          <MethodDetails summary="Что это значит для решения">
            <p>
              Первый срез: это только накопление в приор, не решение. Приор — то, что накоплено с прошлых срезов, до этого письма.
            </p>
          </MethodDetails>
        </>
      ) : null}
      {stored ? null : <p className="source">Накопление между срезами ещё не хранится: шкала по одному срезу.</p>}
    </figure>
  );
}

