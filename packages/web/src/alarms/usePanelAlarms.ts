import { useEffect } from "react";
import { useAlarmContext } from "./AlarmContext";
import { highestSeverity } from "./alarmRegistry";
import type { Alarm, AlarmSeverity } from "./types";

/**
 * The framework's panel-facing half. A panel derives its own `Alarm[]` from
 * whatever domain it renders (see `power/powerAlarms.ts` for the one example
 * this build ships) and hands it to this hook, which:
 *
 * - registers those alarms with the shared {@link AlarmContext}, feeding the
 *   dashboard-wide `AlarmBanner`;
 * - returns the panel's own highest severity, for local border/state styling
 *   (`PanelFrame` consumes this).
 *
 * `alarms` should be a value the caller only re-creates when its content
 * actually changes (e.g. via `useMemo` keyed on the source data) — the effect
 * re-registers whenever the reference changes, and a fresh array every render
 * would just mean extra, harmless re-registrations.
 */
export function usePanelAlarms(panelId: string, alarms: readonly Alarm[]): AlarmSeverity | null {
  const { setPanelAlarms } = useAlarmContext();

  useEffect(() => {
    setPanelAlarms(panelId, alarms);
    return () => setPanelAlarms(panelId, []);
  }, [panelId, setPanelAlarms, alarms]);

  return highestSeverity(alarms);
}
