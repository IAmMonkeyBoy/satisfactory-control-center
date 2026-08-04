import { useState, type JSX, type ReactNode } from "react";
import type { WorldState } from "@scc/shared";
import { AlarmBanner } from "../alarms/AlarmBanner";
import { MapLayerToggles } from "../map/MapLayerToggles";
import type { MapLayerVisibility } from "../map/MapScene";
import { CodexNavSlot } from "../panels/CodexNavSlot";
import { ConnectionBadge } from "../panels/ConnectionBadge";
import { FollowingIndicator } from "../panels/FollowingIndicator";
import { MilestonesPanel } from "../panels/MilestonesPanel";
import { PowerPanel } from "../panels/PowerPanel";
import { ProductionPanel } from "../panels/ProductionPanel";
import { StoragePanel } from "../panels/StoragePanel";
import type { ConnectionStatus } from "../useWorldState";
import { MapSlot } from "./MapSlot";

const DEFAULT_MAP_LAYERS: MapLayerVisibility = {
  buildings: true,
  movers: true,
  deathCrates: true,
  alarms: true,
};

/**
 * The command-center shell (spec, "UI concept: Map Deck"): the Tier 1 map is
 * the full-bleed backdrop (`MapSlot`), with panels floating over it. The
 * panel row uses ordinary flex flow rather than hand-placed offsets, so the
 * alarm banner appearing or disappearing reflows the panels beneath it
 * instead of overlapping them — the map layer toggles live in this same
 * flow (not absolutely positioned) for exactly that reason: a wide/wrapped
 * alarm banner must push them down, never sit under them.
 */
export function MapDeck({
  worldState,
  status,
}: {
  worldState: WorldState | null;
  status: ConnectionStatus;
}): JSX.Element {
  const now = Date.now();
  const [mapLayers, setMapLayers] = useState<MapLayerVisibility>(DEFAULT_MAP_LAYERS);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-metal-950 text-neutral-100">
      <MapSlot worldState={worldState} layers={mapLayers} />

      {/* pointer-events-none so the empty space in this overlay (the middle
          spacer between the panel columns, the gaps around the top bar) lets
          clicks/drags/wheel through to the map underneath instead of
          silently swallowing them; every actual panel opts back in with
          pointer-events-auto. */}
      <div className="relative z-10 flex h-full flex-col gap-2 p-3 pointer-events-none">
        <TopBar worldState={worldState} status={status} now={now} />
        <AlarmBanner />

        <div className="pointer-events-auto flex justify-center">
          <MapLayerToggles layers={mapLayers} onChange={setMapLayers} />
        </div>

        <div className="flex min-h-0 flex-1 items-stretch justify-between gap-3">
          <div className="flex w-80 flex-none flex-col gap-3 overflow-y-auto pointer-events-auto">
            {worldState && <PowerPanel worldState={worldState} now={now} />}
          </div>

          <div className="flex-1" />

          <div className="flex w-72 flex-none flex-col gap-3 overflow-y-auto pointer-events-auto">
            {worldState && <MilestonesPanel worldState={worldState} now={now} />}
            {worldState && <StoragePanel worldState={worldState} now={now} />}
          </div>
        </div>

        {worldState && (
          <ProductionPanel
            worldState={worldState}
            now={now}
            className="flex-none pointer-events-auto"
          />
        )}
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
    <div className="pointer-events-auto flex flex-none flex-wrap items-center gap-4 rounded-lg border border-neutral-800 bg-metal-900/90 px-4 py-2 backdrop-blur-sm">
      {children}
    </div>
  );
}
