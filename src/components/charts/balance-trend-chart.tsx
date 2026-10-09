"use client";

import { useId, useState } from "react";
import { niceRange } from "@/lib/scale";
import { useElementWidth } from "./chart-utils";

export type BalancePointDatum = {
  /** Major-unit value, used only for geometry. */
  value: number;
  /** Exact balance, formatted on the server from integer minor units. */
  text: string;
  /** "Oct 8, 2026" */
  title: string;
  /** Short axis label, e.g. "Oct 8". */
  label: string;
};

const HEIGHT = 240;
const MARGIN = { top: 14, right: 14, bottom: 28, left: 52 };

/**
 * Combined end-of-day balance over time: a single series, so no legend. A
 * crosshair snaps to the nearest day, and arrow keys step through the days
 * for keyboard users.
 */
export function BalanceTrendChart({
  data,
  formatTick,
}: {
  data: BalancePointDatum[];
  /** Compact axis labels keyed by tick value, prepared on the server. */
  formatTick: Record<string, string>;
}) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId();
  const tooltipId = useId();

  const values = data.map((d) => d.value);
  const { ticks, bottom, top } = niceRange(Math.min(...values), Math.max(...values), 4);
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (index: number) => MARGIN.left + (data.length > 1 ? (index / (data.length - 1)) * plotWidth : plotWidth / 2);
  const y = (value: number) => MARGIN.top + plotHeight - ((value - bottom) / (top - bottom || 1)) * plotHeight;

  const line = data.map((d, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1).toFixed(1)},${MARGIN.top + plotHeight} L${x(0).toFixed(1)},${MARGIN.top + plotHeight} Z`;

  const labelEvery = Math.max(1, Math.ceil(data.length / (width < 520 ? 3 : 6)));
  const lastIndex = data.length - 1;
  const current = active === null ? null : data[active];

  function nearest(clientX: number, rect: DOMRect): number {
    const ratio = (clientX - rect.left - MARGIN.left) / (plotWidth || 1);
    return Math.min(lastIndex, Math.max(0, Math.round(ratio * lastIndex)));
  }

  return (
    <div
      ref={ref}
      className="relative"
      style={{ height: HEIGHT }}
      tabIndex={0}
      role="group"
      aria-label={`Gráfico de líneas de tu saldo combinado durante ${data.length} días, con un saldo final de ${data[lastIndex]?.text}. Usa las flechas izquierda y derecha para leer cada día.`}
      aria-describedby={current ? tooltipId : undefined}
      onPointerMove={(event) => setActive(nearest(event.clientX, event.currentTarget.getBoundingClientRect()))}
      onPointerLeave={() => setActive(null)}
      onBlur={() => setActive(null)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? lastIndex) - 1));
        else if (event.key === "ArrowRight") setActive((i) => Math.min(lastIndex, (i ?? -1) + 1));
        else if (event.key === "Home") setActive(0);
        else if (event.key === "End") setActive(lastIndex);
        else if (event.key === "Escape") setActive(null);
        else return;
        event.preventDefault();
      }}
    >
      {width > 0 ? (
        <svg width={width} height={HEIGHT} aria-hidden="true" className="rounded-lg outline-none">
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-in)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--chart-in)" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {ticks.map((tick, index) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={y(tick)}
                y2={y(tick)}
                className={index === 0 ? "stroke-chart-axis" : "stroke-chart-grid"}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="tabular fill-muted-foreground text-[11px]">
                {formatTick[String(tick)] ?? tick}
              </text>
            </g>
          ))}

          {data.map((d, index) =>
            index % labelEvery === 0 && index < lastIndex - labelEvery / 2 ? (
              <text key={d.title} x={x(index)} y={HEIGHT - 8} textAnchor={index === 0 ? "start" : "middle"} className="fill-muted-foreground text-[11px]">
                {d.label}
              </text>
            ) : null,
          )}
          <text x={x(lastIndex)} y={HEIGHT - 8} textAnchor="end" className="fill-muted-foreground text-[11px]">
            {data[lastIndex]?.label}
          </text>

          <path d={area} fill={`url(#${gradientId})`} />
          <path d={line} fill="none" className="stroke-chart-in" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {current && active !== null ? (
            <line x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} className="stroke-foreground/25" strokeWidth={1} shapeRendering="crispEdges" />
          ) : null}

          {/* End marker, or the hovered day: a dot with a surface-coloured ring. */}
          <circle
            cx={x(active ?? lastIndex)}
            cy={y(data[active ?? lastIndex]?.value ?? 0)}
            r={4.5}
            className="fill-chart-in stroke-card"
            strokeWidth={2}
          />
        </svg>
      ) : null}

      {current && active !== null ? (
        <div
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute top-0 z-10 rounded-lg bg-popover px-3 py-2 text-xs whitespace-nowrap shadow-raised ring-1 ring-foreground/10"
          style={{ left: Math.min(Math.max(8, x(active) - 70), Math.max(8, width - 156)) }}
        >
          <p className="tabular text-sm font-semibold text-foreground">{current.text}</p>
          <p className="mt-0.5 text-muted-foreground">{current.title}</p>
        </div>
      ) : null}
    </div>
  );
}
