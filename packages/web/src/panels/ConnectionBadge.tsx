import type { JSX } from "react";
import type { ConnectionStatus } from "../useWorldState";

const label: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
};

const dot: Record<ConnectionStatus, string> = {
  connecting: "bg-amber-400",
  live: "bg-emerald-400",
  reconnecting: "bg-alarm-critical animate-pulse",
};

export function ConnectionBadge({ status }: { status: ConnectionStatus }): JSX.Element {
  return (
    <span className="flex items-center gap-2 text-sm text-neutral-300">
      <span className={`h-2.5 w-2.5 rounded-full ${dot[status]}`} />
      {label[status]}
    </span>
  );
}
