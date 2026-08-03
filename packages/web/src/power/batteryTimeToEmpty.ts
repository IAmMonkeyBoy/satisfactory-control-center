/**
 * Battery % with time-to-empty (spec, "Power panel + alarms"). No FRM endpoint
 * reports battery energy capacity or drain rate directly, so time-to-empty is
 * derived from the sparkline window's own recent history of `batteryPercent`
 * samples: a simple recent rate of change, extrapolated to zero.
 */
import type { SparklinePoint } from "../sparklines/sparklineWindow";

export type BatteryTrend =
  | { kind: "insufficient-data" }
  | { kind: "charging" }
  | { kind: "steady" }
  | { kind: "draining"; timeToEmptyMs: number };

/** Only the trailing slice of the window counts, so a trend that has since
 * leveled off isn't dragged out by what happened many minutes ago. */
const RECENT_WINDOW_MS = 5 * 60_000;

/** Below this span, two samples are FRM push-cadence noise, not a trustworthy rate. */
const MIN_SAMPLE_SPAN_MS = 10_000;

/** Below this rate of change, call it "steady" rather than reporting a
 * many-hour extrapolation from essentially flat noise. */
const STEADY_RATE_PERCENT_PER_MS = 0.5 / 60_000; // 0.5 percentage points/min

export function batteryTrend(series: readonly SparklinePoint[]): BatteryTrend {
  const latest = series[series.length - 1];
  if (series.length < 2 || !latest) return { kind: "insufficient-data" };

  const cutoff = latest.t - RECENT_WINDOW_MS;
  const earliest = series.find((point) => point.t >= cutoff);
  if (!earliest) return { kind: "insufficient-data" };

  const spanMs = latest.t - earliest.t;
  if (spanMs < MIN_SAMPLE_SPAN_MS) return { kind: "insufficient-data" };

  const ratePercentPerMs = (latest.v - earliest.v) / spanMs;

  if (ratePercentPerMs > STEADY_RATE_PERCENT_PER_MS) return { kind: "charging" };
  if (ratePercentPerMs >= -STEADY_RATE_PERCENT_PER_MS) return { kind: "steady" };

  const timeToEmptyMs = Math.max(0, latest.v / -ratePercentPerMs);
  return { kind: "draining", timeToEmptyMs };
}
