/**
 * The alarm framework's vocabulary. Deliberately panel-agnostic: an `Alarm` says
 * nothing about power, production, or any other domain, so any current or future
 * panel can register alarms through the same mechanism (spec, "Alarm framework").
 */

/** How urgently an alarm needs eyes on it. Critical implies warning. */
export type AlarmSeverity = "warning" | "critical";

export interface Alarm {
  /** Stable within the owning panel — keys the alarm in lists across renders. */
  key: string;
  severity: AlarmSeverity;
  /** Human-readable, shown verbatim in the alarm banner. */
  message: string;
}
