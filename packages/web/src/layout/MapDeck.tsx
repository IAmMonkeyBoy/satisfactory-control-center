import type { JSX, ReactNode } from "react";
import type { WorldState } from "@scc/shared";
import { AlarmBanner } from "../alarms/AlarmBanner";
import { CodexNavSlot } from "../panels/CodexNavSlot";
import { ConnectionBadge } from "../panels/ConnectionBadge";
import { FollowingIndicator } from "../panels/FollowingIndicator";
import { PlaceholderPanel } from "../panels/PlaceholderPanel";
import { PowerPanel } from "../panels/PowerPanel";
import type { ConnectionStatus } from "../useWorldState";
import { MapSlot } from "./MapSlot";

/**
 * The command-center shell (spec, "UI concept: Map Deck"): the Tier 1 map is
 * the full-bleed backdrop (`MapSlot`, empty until Build 8), with panels
 * floating over it. The panel row uses ordinary flex flow rather than
 * hand-placed offsets, so the alarm banner appearing or disappearing reflows
 * the panels beneath it instead of overlapping them.
 */
export function MapDeck({
  worldState,
  status,
}: {
  worldState: WorldState | null;
  status: ConnectionStatus;
}): JSX.Element {
  const now = Date.now();

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-metal-950 text-neutral-100">
      <MapSlot />

      <div className="relative z-10 flex h-full flex-col gap-2 p-3">
        <TopBar worldState={worldState} status={status} now={now} />
        <AlarmBanner />

        <div className="flex min-h-0 flex-1 items-stretch justify-between gap-3">
          <div className="flex w-80 flex-none flex-col gap-3 overflow-y-auto">
            {worldState && <PowerPanel worldState={worldState} now={now} />}
          </div>

          <div className="flex-1" />

          <div className="flex w-72 flex-none flex-col gap-3 overflow-y-auto">
            <PlaceholderPanel
              title="Milestone + Storage"
              note={[
                { label: "Milestone", note: "Milestones summary arrives in Build 7." },
                { label: "Storage", note: "Storage & inventory search arrives in Build 6." },
              ]}
            />
          </div>
        </div>

        <PlaceholderPanel
          title="Production"
          note="Production efficiency ticker arrives in Build 5."
          className="flex-none"
        />
      </div>
    </div>
  );
}

function TopBar({
  worldState,
  status,
  now,
}: {
  worldState: WorldState | null;
  status: ConnectionStatus;
  now: number;
}): JSX.Element {
  return (
    <Bar>
      <h1 className="text-base font-semibold tracking-wide">
        Satisfactory <span className="text-ficsit-orange">Control Center</span>
      </h1>
      {worldState ? (
        <FollowingIndicator worldState={worldState} now={now} />
      ) : (
        <span className="text-sm text-neutral-400">Waiting for the first WorldState snapshot…</span>
      )}
      <span className="flex-1" />
      <CodexNavSlot />
      <ConnectionBadge status={status} />
    </Bar>
  );
}

function Bar({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-none flex-wrap items-center gap-4 rounded-lg border border-neutral-800 bg-metal-900/90 px-4 py-2 backdrop-blur-sm">
      {children}
    </div>
  );
}
