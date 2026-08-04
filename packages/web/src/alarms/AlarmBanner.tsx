import type { JSX } from "react";
import { useAlarmContext } from "./AlarmContext";

/**
 * The dashboard-wide half of "unmissable from across the room": every active
 * alarm, from every panel, in one banner. Renders nothing when there's
 * nothing to show — the banner itself is the all-clear signal by its
 * absence. `hideFromBanner` alarms (see `alarms/types.ts`) are excluded from
 * the rendered line-up but still count toward the "is anything visible at
 * all" and severity checks below via the initial filter, so a fault that's
 * naturally per-instance (say, every building on a tripped circuit) doesn't
 * flood this banner with one line per instance.
 */
export function AlarmBanner(): JSX.Element | null {
  const { activeAlarms } = useAlarmContext();
  const visible = activeAlarms.filter((alarm) => !alarm.hideFromBanner);
  if (visible.length === 0) return null;

  const critical = visible[0]?.severity === "critical";

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
      {visible.map((alarm) => (
        <span key={alarm.key} className="text-neutral-100">
          {alarm.message}
        </span>
      ))}
    </div>
  );
}
