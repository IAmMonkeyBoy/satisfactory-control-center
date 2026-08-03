import { formatDuration } from "../format";
import type { BatteryTrend } from "./batteryTimeToEmpty";

/** The power panel's battery % is paired with this — CONTEXT.md, "battery % with time-to-empty". */
export function batteryTrendLabel(trend: BatteryTrend): string {
  switch (trend.kind) {
    case "insufficient-data":
      return "—";
    case "charging":
      return "charging";
    case "steady":
      return "steady";
    case "draining":
      return `draining · ${formatDuration(trend.timeToEmptyMs)} left`;
  }
}
