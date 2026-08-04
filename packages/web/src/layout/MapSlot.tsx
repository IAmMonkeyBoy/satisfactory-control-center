import { useMemo, type JSX } from "react";
import { useAlarmContext } from "../alarms/AlarmContext";
import { usePanelAlarms } from "../alarms/usePanelAlarms";
import { mapAlarms } from "../map/mapAlarms";
import { MapScene, type MapLayerVisibility } from "../map/MapScene";
import { useMapSnapshot } from "../map/useMapSnapshot";

/**
 * The full-bleed map slot (spec, "Map Deck layout") — the Tier 1 map itself
 * (ADR 0004: orthographic Three.js scene). Owns the map's own data feed (its
 * REST poll, per ADR 0003 — distinct from the SSE-pushed WorldState the rest
 * of the dashboard reads, and the source for every one of its four layers,
 * death crates included — see `mapSnapshot.ts`'s `MapDeathCrate`); layer-
 * toggle *state* lives in `MapDeck.tsx` instead, since the toggle control
 * itself renders in the overlay's normal flex flow (so a wide alarm banner
 * pushes it down rather than sitting under it) — this component just needs
 * the current visibility to pass to the scene.
 */
export function MapSlot({ layers }: { layers: MapLayerVisibility }): JSX.Element {
  const mapSnapshot = useMapSnapshot();
  const { activeAlarms } = useAlarmContext();

  // The map is itself a source of alarms (no-power buildings), not just a
  // renderer of alarms other panels raise — see mapAlarms.ts. Registering
  // through the same framework feeds the alarm banner too, not just the
  // map's own badge layer.
  const noPowerAlarms = useMemo(() => mapAlarms(mapSnapshot?.buildings.data ?? []), [mapSnapshot]);
  usePanelAlarms("map", noPowerAlarms);

  return (
    <div className="absolute inset-0 bg-metal-950">
      <MapScene mapSnapshot={mapSnapshot} alarms={activeAlarms} layers={layers} />
    </div>
  );
}
