import type { JSX } from "react";

/** The v2 codex navigation slot (spec, "Map Deck layout") — reserved, inert
 * placement in the top bar; the codex itself arrives in Build 9. */
export function CodexNavSlot(): JSX.Element {
  return (
    <span
      className="rounded border border-neutral-800 px-2 py-1 text-xs text-neutral-600"
      title="Codex — reserved for v2"
    >
      Codex <span className="text-neutral-700">· v2</span>
    </span>
  );
}
