/**
 * The alarm registry: which panel currently reports which alarms. Kept as plain
 * data + pure functions (rather than baked into the React context directly) so
 * the aggregation and ordering rules are unit-testable without a component
 * harness, matching this package's existing convention of testing logic outside
 * React (see `powerCircuits.ts`).
 */
import type { Alarm, AlarmSeverity } from "./types";

export type AlarmRegistry = ReadonlyMap<string, readonly Alarm[]>;

const severityRank: Record<AlarmSeverity, number> = { critical: 0, warning: 1 };

/**
 * Replace one panel's alarms, returning a new registry. A panel reporting no
 * alarms is removed entirely rather than kept as an empty entry, so a resolved
 * fault leaves no trace once it clears.
 */
export function setPanelAlarms(
  registry: AlarmRegistry,
  panelId: string,
  alarms: readonly Alarm[],
): AlarmRegistry {
  const next = new Map(registry);
  if (alarms.length === 0) next.delete(panelId);
  else next.set(panelId, alarms);
  return next;
}

/** Every currently active alarm across all panels, critical-first. */
export function activeAlarms(registry: AlarmRegistry): Alarm[] {
  return [...registry.values()]
    .flat()
    .sort(
      (a, b) =>
        severityRank[a.severity] - severityRank[b.severity] || a.message.localeCompare(b.message),
    );
}

/** The most urgent severity in a list of alarms, or null if there are none. */
export function highestSeverity(alarms: readonly Alarm[]): AlarmSeverity | null {
  if (alarms.some((a) => a.severity === "critical")) return "critical";
  if (alarms.some((a) => a.severity === "warning")) return "warning";
  return null;
}
