import type { JSX } from "react";

/**
 * The full-bleed map slot — empty in this build (spec, "Map Deck layout"). The
 * Tier 1 map replaces this in Build 8; keeping it as the backdrop now proves
 * the overlay panels lay out correctly against a full-bleed element before
 * there's anything real to render behind them.
 */
export function MapSlot(): JSX.Element {
  return (
    <div className="absolute inset-0 bg-metal-950">
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <p className="text-sm uppercase tracking-[0.3em] text-neutral-700">
          Map — Tier 1 arriving in Build 8
        </p>
      </div>
    </div>
  );
}
