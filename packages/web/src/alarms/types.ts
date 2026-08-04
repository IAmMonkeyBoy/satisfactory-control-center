/**
 * The alarm framework's vocabulary. Deliberately panel-agnostic: an `Alarm` says
 * nothing about power, production, or any other domain, so any current or future
 * panel can register alarms through the same mechanism (spec, "Alarm framework").
 */
import type { WorldLocation } from "@scc/shared";

/** How urgently an alarm needs eyes on it. Critical implies warning. */
export type AlarmSeverity = "warning" | "critical";

export interface Alarm {
  /** Stable within the owning panel — keys the alarm in lists across renders. */
  key: string;
  severity: AlarmSeverity;
  /** Human-readable, shown verbatim in the alarm banner. */
  message: string;
  /** Where the fault is, if it has a single physical location — the Tier 1
   *  map's alarm-badge layer (spec, "Tier 1 map": "alarm badges at fault
   *  locations") renders a badge for any active alarm that sets this.
   *  Optional because most of this build's alarms are aggregate (a
   *  circuit-wide fuse trip, an item-level production shortfall) with no
   *  single point to badge; omitting it just means that alarm shows in the
   *  banner only, not on the map. */
  location?: WorldLocation;
  /** Omit this alarm from the dashboard-wide `AlarmBanner` while still
   *  counting it toward severity and (if it has a `location`) rendering it
   *  as a map badge. For a fault that is naturally per-instance — one alarm
   *  per building on a tripped circuit, say — registering one banner line
   *  per instance would flood and displace the banner; the panel instead
   *  registers the per-instance alarms with this set (so every affected
   *  building still gets its own map badge) alongside one aggregate alarm
   *  without it (so the banner shows a single "N affected" line). */
  hideFromBanner?: boolean;
}
