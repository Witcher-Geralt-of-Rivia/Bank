"use client";

import { useId, useState } from "react";
import { niceScale } from "@/lib/scale";
import { cn } from "@/lib/utils";
import { useElementWidth } from "./chart-utils";

export type CashFlowDatum = {
  /** Short axis label, e.g. "Oct". */
  label: string;
  /** Full label for tooltips and the table view, e.g. "October 2026". */
  title: string;
  /** Major-unit values used only for bar geometry. */
  inValue: number;
  outValue: number;
  /** Exact amounts, formatted on the server from integer minor units. */
  inText: string;
  outText: string;
  netText: string;
  partial?: boolean;
};

const HEIGHT = 248;
const MARGIN = { top: 12, right: 8, bottom: 30, left: 44 };
const BAR_MAX = 22;
const BAR_GAP = 2;

/**
 * Money in against money out per month.
 *
 * Two series on one shared axis. Identity never rests on colour alone: the
 * legend names both series, every group has a hover and keyboard-focus
 * readout, and the same figures are available as a table.
 */
export function CashFlowChart({
  data,
  currencyNote,
  formatTick,
}: {
  data: CashFlowDatum[];
  currencyNote?: string;
  /** Compact axis labels keyed by tick value, prepared on the server. */
  formatTick: Record<string, string>;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [active, setActive] = useState<number | null>(null);
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const tooltipId = useId();

  const max = Math.max(1, ...data.map((d) => Math.max(d.inValue, d.outValue)));
  const { ticks, top } = niceScale(max, 4);
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const band = data.length > 0 ? plotWidth / data.length : 0;
  const barWidth = Math.max(4, Math.min(BAR_MAX, (band - 16 - BAR_GAP) / 2));
  const y = (value: number) => MARGIN.top + plotHeight - (value / top) * plotHeight;
  const baseline = MARGIN.top + plotHeight;
  const current = active === null ? null : data[active];

  const bar = (x: number, value: number, className: string) => {
    const height = Math.max(0, baseline - y(value));
    if (height < 0.5) return null;
    const r = Math.min(4, barWidth / 2, height);
    // Rounded at the data end, square on the baseline.
    const d = `M${x},${baseline} V${baseline - height + r} Q${x},${baseline - height} ${x + r},${baseline - height} H${x + barWidth - r} Q${x + barWidth},${baseline - height} ${x + barWidth},${baseline - height + r} V${baseline} Z`;
    return <path d={d} className={className} />;
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ul className="flex items-center gap-4 text-xs text-muted-foreground" aria-label="Leyenda">
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-chart-in" aria-hidden="true" />
            Ingresos
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-chart-out" aria-hidden="true" />
            Egresos
          </li>
        </ul>
        <div role="group" aria-label="Vista" className="flex rounded-lg bg-muted p-0.5 text-xs font-medium">
          {(["chart", "table"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={cn(
                "rounded-md px-2.5 py-1 capitalize transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                view === option ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option === "chart" ? "Gráfico" : "Tabla"}
            </button>
          ))}
        </div>
      </div>

      {view === "table" ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Ingresos y egresos por mes</caption>
            <thead>
              <tr className="border-b border-border/70 text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-4 text-left font-medium">Mes</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Ingresos</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Egresos</th>
                <th scope="col" className="py-2 pl-4 text-right font-medium">Neto</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.title} className="border-b border-border/50 last:border-0">
                  <th scope="row" className="py-2.5 pr-4 text-left font-normal">
                    {d.title}
                    {d.partial ? <span className="text-muted-foreground"> (parcial)</span> : null}
                  </th>
                  <td className="tabular px-4 py-2.5 text-right">{d.inText}</td>
                  <td className="tabular px-4 py-2.5 text-right">{d.outText}</td>
                  <td className="tabular py-2.5 pl-4 text-right font-medium">{d.netText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative" style={{ height: HEIGHT }} onPointerLeave={() => setActive(null)}>
          {width > 0 ? (
            <svg width={width} height={HEIGHT} role="img" aria-label="Gráfico de barras de ingresos y egresos por mes. Usa la vista de tabla para ver las cifras exactas.">
              {ticks.map((tick) => (
                <g key={tick}>
                  <line
                    x1={MARGIN.left}
                    x2={width - MARGIN.right}
                    y1={y(tick)}
                    y2={y(tick)}
                    className={tick === 0 ? "stroke-chart-axis" : "stroke-chart-grid"}
                    strokeWidth={1}
                    shapeRendering="crispEdges"
                  />
                  <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="tabular fill-muted-foreground text-[11px]">
                    {formatTick[String(tick)] ?? tick}
                  </text>
                </g>
              ))}

              {data.map((d, index) => {
                const center = MARGIN.left + band * index + band / 2;
                const isActive = active === index;
                return (
                  <g key={d.title}>
                    {isActive ? (
                      <rect x={center - band / 2 + 3} y={MARGIN.top} width={Math.max(0, band - 6)} height={plotHeight} rx={6} className="fill-foreground/[0.04]" />
                    ) : null}
                    <g className={cn("transition-opacity", active !== null && !isActive && "opacity-45")}>
                      {bar(center - barWidth - BAR_GAP / 2, d.inValue, "fill-chart-in")}
                      {bar(center + BAR_GAP / 2, d.outValue, "fill-chart-out")}
                    </g>
                    <text
                      x={center}
                      y={HEIGHT - 9}
                      textAnchor="middle"
                      className={cn("text-[11px]", isActive ? "fill-foreground font-medium" : "fill-muted-foreground")}
                    >
                      {d.label}
                    </text>
                    {/* The whole band is the target, not just the painted bars. */}
                    <rect
                      x={center - band / 2}
                      y={0}
                      width={band}
                      height={HEIGHT}
                      fill="transparent"
                      tabIndex={0}
                      role="button"
                      aria-label={`${d.title}: ingresos ${d.inText}, egresos ${d.outText}, neto ${d.netText}`}
                      aria-describedby={isActive ? tooltipId : undefined}
                      onPointerEnter={() => setActive(index)}
                      onPointerMove={() => setActive(index)}
                      onFocus={() => setActive(index)}
                      onBlur={() => setActive(null)}
                      className="cursor-default outline-none focus-visible:stroke-ring focus-visible:stroke-2"
                    />
                  </g>
                );
              })}
            </svg>
          ) : null}

          {current && active !== null ? (
            <div
              id={tooltipId}
              role="tooltip"
              className="pointer-events-none absolute top-1 z-10 w-48 rounded-lg bg-popover p-3 text-xs shadow-raised ring-1 ring-foreground/10"
              style={{
                left: Math.min(Math.max(8, MARGIN.left + band * active + band / 2 - 96), Math.max(8, width - 200)),
              }}
            >
              <p className="mb-2 font-medium text-foreground">
                {current.title}
                {current.partial ? <span className="font-normal text-muted-foreground"> · parcial</span> : null}
              </p>
              <dl className="grid gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-0.5 w-3 rounded-full bg-chart-in" aria-hidden="true" /> Ingresos
                  </dt>
                  <dd className="tabular font-semibold text-foreground">{current.inText}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-0.5 w-3 rounded-full bg-chart-out" aria-hidden="true" /> Egresos
                  </dt>
                  <dd className="tabular font-semibold text-foreground">{current.outText}</dd>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-3 border-t border-border/70 pt-1.5">
                  <dt className="text-muted-foreground">Neto</dt>
                  <dd className="tabular font-semibold text-foreground">{current.netText}</dd>
                </div>
              </dl>
            </div>
          ) : null}
        </div>
      )}

      {currencyNote ? <p className="mt-3 text-xs text-muted-foreground">{currencyNote}</p> : null}
    </div>
  );
}
