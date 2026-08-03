import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import {
  activeAlarms as computeActiveAlarms,
  setPanelAlarms,
  type AlarmRegistry,
} from "./alarmRegistry";
import type { Alarm } from "./types";

interface AlarmContextValue {
  /** Every currently active alarm across all registered panels, critical-first. */
  activeAlarms: Alarm[];
  /** Replace one panel's alarms. Called by {@link usePanelAlarms}, not directly. */
  setPanelAlarms: (panelId: string, alarms: readonly Alarm[]) => void;
}

const AlarmContext = createContext<AlarmContextValue | null>(null);

/**
 * Owns the alarm registry for one Map Deck instance. Any panel under this
 * provider can register alarms via {@link usePanelAlarms}; the {@link AlarmBanner}
 * reads the aggregate. This is the whole reusable mechanism the spec asks for —
 * it has no knowledge of power, production, or any other domain.
 */
export function AlarmProvider({ children }: { children: ReactNode }): JSX.Element {
  const [registry, setRegistry] = useState<AlarmRegistry>(new Map());

  const setPanel = useCallback((panelId: string, alarms: readonly Alarm[]) => {
    setRegistry((prev) => setPanelAlarms(prev, panelId, alarms));
  }, []);

  const value = useMemo<AlarmContextValue>(
    () => ({ activeAlarms: computeActiveAlarms(registry), setPanelAlarms: setPanel }),
    [registry, setPanel],
  );

  return <AlarmContext.Provider value={value}>{children}</AlarmContext.Provider>;
}

export function useAlarmContext(): AlarmContextValue {
  const ctx = useContext(AlarmContext);
  if (!ctx) throw new Error("useAlarmContext must be used within an AlarmProvider");
  return ctx;
}
