/**
 * The map's contribution to the alarm framework (`alarms/`). A building's
 * live `no-power` status (FRM `getFactory`'s own per-building `PowerInfo` —
 * see `frmDomains.ts`'s `isUnpowered`) is real, precise, per-instance data,
 * unlike the power panel's circuit-wide fuse alarm which has no single point
 * to badge — so this is what gives the Tier 1 map's alarm-badge layer (spec,
 * "Tier 1 map": "alarm badges at fault locations") something real to show,
 * without fabricating a location for an alarm that has none.
 *
 * A fuse trip (or a whole circuit losing power) is circuit-wide, so every
 * building on it reports `no-power` independently — one located, critical
 * alarm per building, `hideFromBanner`-marked so the dashboard-wide banner
 * doesn't get one line per building (a large circuit can carry dozens), plus
 * a single aggregate alarm (no location — it has no one point to badge)
 * that *does* show in the banner, so the fault is still unmissable there
 * too.
 */
import type { MapBuilding } from "@scc/shared";
import type { Alarm } from "../alarms/types";

export function mapAlarms(buildings: readonly MapBuilding[]): Alarm[] {
  const unpowered = buildings.filter((building) => building.status === "no-power");
  if (unpowered.length === 0) return [];

  const badges: Alarm[] = unpowered.map((building) => ({
    key: `map-no-power-${building.id}`,
    severity: "critical",
    message: `No power — ${building.displayName}`,
    location: building.transform,
    hideFromBanner: true,
  }));

  const summary: Alarm = {
    key: "map-no-power-summary",
    severity: "critical",
    message:
      unpowered.length === 1
        ? "1 building without power"
        : `${unpowered.length} buildings without power`,
  };

  return [...badges, summary];
}
