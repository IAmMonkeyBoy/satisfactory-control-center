/**
 * The power panel's contribution to the alarm framework (`alarms/`). A fuse
 * trip is the one alarm this build's acceptance criteria names explicitly —
 * unmissable at a glance, and clearing automatically once the fault clears,
 * since this is a pure derivation from the current circuits, not sticky state.
 */
import type { PowerCircuit } from "@scc/shared";
import type { Alarm } from "../alarms/types";

export function powerAlarms(circuits: readonly PowerCircuit[]): Alarm[] {
  return circuits
    .filter((circuit) => circuit.fuseTripped === true)
    .map((circuit) => ({
      key: `power-fuse-${circuit.id}`,
      severity: "critical",
      message: `Fuse tripped — Circuit ${circuit.id}`,
    }));
}
