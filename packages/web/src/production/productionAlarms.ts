/**
 * The production panel's contribution to the alarm framework (`alarms/`),
 * derived from the machine efficiency rollups a `getFactory` push builds
 * (spec: "Efficiency alarm states use the shared alarm framework"). Pure
 * derivation from the current rollups, not sticky state, so an alarm clears
 * the moment the line recovers — same shape as `power/powerAlarms.ts`.
 */
import type { MachineRollup } from "@scc/shared";
import type { Alarm } from "../alarms/types";

/** Below this average efficiency, a machine class is flagged as underperforming
 *  rather than merely imperfect — Satisfactory factories legitimately run a
 *  little under 100% when balanced tightly, but not this far under. */
const LOW_EFFICIENCY_WARNING_PERCENT = 80;

export function productionAlarms(machines: readonly MachineRollup[]): Alarm[] {
  const alarms: Alarm[] = [];

  for (const machine of machines) {
    if (machine.totalCount === 0) continue;

    if (machine.producingCount === 0) {
      alarms.push({
        key: `production-stalled-${machine.className}`,
        severity: "critical",
        message: `${machine.displayName} stalled — 0 of ${machine.totalCount} producing`,
      });
    } else if (
      machine.averageEfficiencyPercent !== null &&
      machine.averageEfficiencyPercent < LOW_EFFICIENCY_WARNING_PERCENT
    ) {
      alarms.push({
        key: `production-low-${machine.className}`,
        severity: "warning",
        message: `${machine.displayName} at ${Math.round(machine.averageEfficiencyPercent)}% efficiency`,
      });
    }
  }

  return alarms;
}
