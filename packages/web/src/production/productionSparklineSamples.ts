import type { WorldState } from "@scc/shared";
import type { SparklinePoint } from "../sparklines/sparklineWindow";

/** Series key for one item's current rate in the sparkline window. */
export function productionSeriesKey(className: string): string {
  return `production:${className}`;
}

/**
 * Extracts this build's production series from a WorldState snapshot: current
 * rate per item, timestamped by the production domain's own `capturedAt`
 * (see `power/powerSparklineSamples.ts` for why: it keeps the window's
 * dedup-by-timestamp logic lined up with when the value actually changed).
 *
 * A baseline-only WorldState contributes nothing: `currentPerMin` is always
 * null there, and a flat line from a rate no baseline ever measured would be
 * a misleading sparkline.
 */
export function productionSparklineSamples(
  worldState: WorldState,
): ReadonlyMap<string, SparklinePoint> {
  const samples = new Map<string, SparklinePoint>();
  const t = worldState.production.tag.capturedAt;

  for (const item of worldState.production.data.items) {
    if (item.currentPerMin !== null) {
      samples.set(productionSeriesKey(item.className), { t, v: item.currentPerMin });
    }
  }

  return samples;
}
