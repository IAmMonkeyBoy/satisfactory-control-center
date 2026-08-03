import type { JSX, ReactNode } from "react";
import type { AlarmSeverity } from "./types";

const stateClass: Record<"none" | AlarmSeverity, string> = {
  none: "border-neutral-800",
  warning: "border-alarm-warning",
  critical: "border-alarm-critical animate-alarm-pulse",
};

/**
 * The panel-local half of "unmissable": every panel on the Map Deck renders
 * through this frame, so a panel with an active alarm changes its own border
 * (and, for critical, pulses) independent of the dashboard-wide `AlarmBanner`.
 * `alarmSeverity` is normally what `usePanelAlarms` returned for this panel —
 * the frame itself has no idea what triggered it.
 */
export function PanelFrame({
  title,
  alarmSeverity,
  right,
  className,
  children,
}: {
  title: string;
  alarmSeverity?: AlarmSeverity | null;
  /** Rendered opposite the title — typically a freshness tag. */
  right?: ReactNode;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section
      className={`rounded-lg border bg-metal-900/90 p-4 backdrop-blur-sm ${stateClass[alarmSeverity ?? "none"]} ${className ?? ""}`}
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}
