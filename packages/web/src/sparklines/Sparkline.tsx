import { useEffect, useRef, type JSX } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { SparklineSeries } from "./sparklineWindow";

export interface SparklineSeriesSpec {
  series: SparklineSeries;
  color: string;
}

/**
 * A minimal, chrome-free uPlot line chart for inline "at a glance" trends — the
 * dashboard's sparklines, fed by the in-memory sparkline window
 * (`useSparklineWindow`). Multiple series share one time axis (e.g. production
 * vs. consumption for a circuit) so their traces are directly comparable.
 */
export function Sparkline({
  series,
  width = 96,
  height = 28,
}: {
  series: SparklineSeriesSpec[];
  width?: number;
  height?: number;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const timestamps = mergedTimestamps(series);
    const data: uPlot.AlignedData = [
      timestamps.map((t) => t / 1000),
      ...series.map((s) => alignValues(timestamps, s.series)),
    ];

    const plot = new uPlot(
      {
        width,
        height,
        cursor: { show: false },
        legend: { show: false },
        axes: [{ show: false }, { show: false }],
        series: [
          {},
          ...series.map((s) => ({ stroke: s.color, width: 1.5, points: { show: false } })),
        ],
      },
      data,
      containerRef.current,
    );

    // Re-created rather than updated in place on every data change: these charts
    // are tiny (a handful of points, a few dozen CSS pixels) and this build's
    // push cadence is a few seconds, so the churn isn't worth tracking uPlot
    // instance identity across renders separately from the container ref.
    return () => plot.destroy();
  }, [series, width, height]);

  return <div ref={containerRef} />;
}

function mergedTimestamps(series: SparklineSeriesSpec[]): number[] {
  const timestamps = new Set<number>();
  for (const spec of series) for (const point of spec.series) timestamps.add(point.t);
  return [...timestamps].sort((a, b) => a - b);
}

function alignValues(timestamps: number[], points: SparklineSeries): (number | null)[] {
  const byTimestamp = new Map(points.map((point) => [point.t, point.v]));
  return timestamps.map((t) => byTimestamp.get(t) ?? null);
}
