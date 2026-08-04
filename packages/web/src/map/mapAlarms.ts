/**
 * The map's contribution to the alarm framework (`alarms/`). A building's
 * live `no-power` status (FRM `getFactory`'s own per-building `FuseTriggered`
 * — see `frmDomains.ts`) is real, precise, per-instance data, unlike the
 * power panel's circuit-wide fuse alarm which has no single point to badge —
 * so this is what gives the Tier 1 map's alarm-badge layer (spec, "Tier 1
 * map": "alarm badges at fault locations") something real to show, without
 * fabricating a location for an alarm that has none.
 */
import type { MapBuilding } from "@scc/shared";
import type { Alarm } from "../alarms/types";

export function mapAlarms(buildings: readonly MapBuilding[]): Alarm[] {
  return buildings
    .filter((building) => building.status === "no-power")
    .map((building) => ({
      key: `map-no-power-${building.id}`,
      severity: "critical",
      message: `No power — ${building.displayName}`,
      location: building.transform,
    }));
}
