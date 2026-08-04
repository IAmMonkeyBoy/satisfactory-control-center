import type { JSX } from "react";
import type { MapLayerVisibility } from "./MapScene";

const LABELS: Record<keyof MapLayerVisibility, string> = {
  buildings: "Buildings",
  movers: "Movers",
  deathCrates: "Death crates",
  alarms: "Alarms",
};

/**
 * The Tier 1 map's four layer toggles (spec, "Tier 1 map": "individually
 * toggleable"), floating over the map's bottom-left corner. Deliberately
 * plain checkboxes rather than a custom control — this is a low-traffic
 * settings surface, not something that needs its own visual language.
 */
export function MapLayerToggles({
  layers,
  onChange,
}: {
  layers: MapLayerVisibility;
  onChange: (next: MapLayerVisibility) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-neutral-800 bg-metal-900/90 px-3 py-2 backdrop-blur-sm">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">Map layers</span>
      {(Object.keys(LABELS) as (keyof MapLayerVisibility)[]).map((key) => (
        <label key={key} className="flex items-center gap-2 text-xs text-neutral-300">
          <input
            type="checkbox"
            checked={layers[key]}
            onChange={(event) => onChange({ ...layers, [key]: event.target.checked })}
            className="accent-ficsit-orange"
          />
          {LABELS[key]}
        </label>
      ))}
    </div>
  );
}
