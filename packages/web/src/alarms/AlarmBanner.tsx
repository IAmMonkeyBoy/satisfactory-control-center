import type { JSX } from "react";
import { useAlarmContext } from "./AlarmContext";

/**
 * The dashboard-wide half of "unmissable from across the room": every active
 * alarm, from every panel, in one banner. Renders nothing when the registry is
 * empty — the banner itself is the all-clear signal by its absence.
 */
export function AlarmBanner(): JSX.Element | null {
  const { activeAlarms } = useAlarmContext();
  if (activeAlarms.length === 0) return null;

  const critical = activeAlarms[0]?.severity === "critical";

  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-4 py-2 text-sm ${
        critical
          ? "animate-alarm-pulse border-alarm-critical bg-alarm-critical/10"
          : "border-alarm-warning bg-alarm-warning/10"
      }`}
    >
      <span
        className={`font-bold uppercase tracking-wider ${critical ? "text-alarm-critical" : "text-alarm-warning"}`}
      >
        {critical ? "Alarm" : "Warning"}
      </span>
      {activeAlarms.map((alarm) => (
        <span key={alarm.key} className="text-neutral-100">
          {alarm.message}
        </span>
      ))}
    </div>
  );
}
