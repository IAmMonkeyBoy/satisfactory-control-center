import { useState, type JSX } from "react";
import type { WorldState } from "@scc/shared";
import { useAlarmContext } from "../alarms/AlarmContext";
import { MapLayerToggles } from "../map/MapLayerToggles";
import { MapScene, type MapLayerVisibility } from "../map/MapScene";
import { useMapSnapshot } from "../map/useMapSnapshot";

const DEFAULT_LAYERS: MapLayerVisibility = {
  buildings: true,
  movers: true,
  deathCrates: true,
  alarms: true,
};

/**
 * The full-bleed map slot (spec, "Map Deck layout") — the Tier 1 map itself
 * (ADR 0004: orthographic Three.js scene). Owns the map's own data feed (its
 * REST poll, per ADR 0003 — distinct from the SSE-pushed WorldState the rest
 * of the dashboard reads) and layer-toggle state; the overlay panels around
 * it know nothing about the map.
 */
export function MapSlot({ worldState }: { worldState: WorldState | null }): JSX.Element {
  const mapSnapshot = useMapSnapshot();
  const { activeAlarms } = useAlarmContext();
  const [layers, setLayers] = useState<MapLayerVisibility>(DEFAULT_LAYERS);

  return (
    <div className="absolute inset-0 bg-metal-950">
      <MapScene
        mapSnapshot={mapSnapshot}
        deathCrates={worldState?.deathCrates.data.crates ?? []}
        alarms={activeAlarms}
        layers={layers}
      />
      {/* The Map Deck's panel columns dock left/right and its ticker docks the
          full-width bottom row (see MapDeck.tsx), so this is the one spot
          guaranteed clear of every overlay panel regardless of their content
          length — top-center, below the top bar. */}
      <div className="absolute top-16 left-1/2 -translate-x-1/2">
        <MapLayerToggles layers={layers} onChange={setLayers} />
      </div>
    </div>
  );
}
