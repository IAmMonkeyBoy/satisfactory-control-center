import type { JSX } from "react";
import { PanelFrame } from "../alarms/PanelFrame";

/**
 * A Map Deck slot reserved for a panel this build doesn't implement — the
 * layout carries the space so a later build ticket drops the real panel in
 * without reshuffling the shell (spec, "Map Deck layout").
 */
export function PlaceholderPanel({
  title,
  note,
  className,
}: {
  title: string;
  note: string;
  className?: string;
}): JSX.Element {
  return (
    <PanelFrame title={title} className={className}>
      <p className="text-sm text-neutral-600">{note}</p>
    </PanelFrame>
  );
}
