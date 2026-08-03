import type { WorldState } from "@scc/shared";
import type { SparklinePoint } from "../sparklines/sparklineWindow";

/** Series key for one circuit's metric in the sparkline window. */
export function powerSeriesKey(
  circuitId: string,
  metric: "production" | "consumption" | "battery",
): string {
  return `power:${circuitId}:${metric}`;
}

/**
 * Extracts this build's power series from a WorldState snapshot: production,
 * consumption, and battery percent per circuit, each timestamped by the power
 * domain's own `capturedAt` rather than wall-clock receipt time — so the
 * sparkline window's dedup-by-timestamp logic lines up with when the value
 * actually changed, not when the SSE push happened to arrive.
 *
 * A baseline-only WorldState (game closed) contributes nothing: production and
 * consumption are always null there, and a flat battery-percent line from a
 * save that never changes would be a misleading sparkline.
 */
export function powerSparklineSamples(worldState: WorldState): ReadonlyMap<string, SparklinePoint> {
  const samples = new Map<string, SparklinePoint>();
  const t = worldState.power.tag.capturedAt;

  for (const circuit of worldState.power.data.circuits) {
    if (circuit.productionMW !== null) {
      samples.set(powerSeriesKey(circuit.id, "production"), { t, v: circuit.productionMW });
    }
    if (circuit.consumptionMW !== null) {
      samples.set(powerSeriesKey(circuit.id, "consumption"), { t, v: circuit.consumptionMW });
    }
    if (circuit.batteryPercent !== null) {
      samples.set(powerSeriesKey(circuit.id, "battery"), { t, v: circuit.batteryPercent });
    }
  }

  return samples;
}
