import type { PowerCircuit } from "@scc/shared";

/**
 * Which power circuits are worth a line on the dashboard.
 *
 * A real save holds far more circuits than a player would recognise: every wall
 * pole wired to a neighbour and nothing else is its own circuit. Aaron's world has
 * 24, of which 21 have no generator and no battery on them at all. Showing them
 * would bury the main grid; showing only the first — which is what the Build 1
 * placeholder did — showed an empty stub and made a 72 GW factory look dead.
 *
 * So a circuit earns its place by having something to report: installed generator
 * capacity, or stored charge. The rest are counted, not listed, so the panel stays
 * honest about them existing without spending rows on them.
 */
export function notableCircuits(circuits: PowerCircuit[]): PowerCircuit[] {
  return circuits
    .filter((circuit) => circuit.capacityMW > 0 || circuit.batteryPercent !== null)
    .sort((a, b) => b.capacityMW - a.capacityMW || a.id.localeCompare(b.id));
}

/** How many circuits carry neither a generator nor a battery. */
export function idleCircuitCount(circuits: PowerCircuit[]): number {
  return circuits.length - notableCircuits(circuits).length;
}

/** Megawatts with thousands separators — grids reach five figures quickly. */
export function formatMW(megawatts: number): string {
  return `${megawatts.toLocaleString()} MW`;
}
