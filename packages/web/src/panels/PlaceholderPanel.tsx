import type { JSX } from "react";
import { PanelFrame } from "../alarms/PanelFrame";

/**
 * A Map Deck slot reserved for a panel this build doesn't implement — the
 * layout carries the space so a later build ticket drops the real panel in
 * without reshuffling the shell (spec, "Map Deck layout"). `note` takes a list
 * when one slot reserves space for more than one future panel — the spec
 * groups milestone and storage into a single "Milestone + storage panel"
 * rather than two independent slots.
 */
export function PlaceholderPanel({
  title,
  note,
  className,
}: {
  title: string;
  note: string | { label: string; note: string }[];
  className?: string;
}): JSX.Element {
  return (
    <PanelFrame title={title} className={className}>
      {typeof note === "string" ? (
        <p className="text-sm text-neutral-600">{note}</p>
      ) : (
        <ul className="space-y-2 text-sm text-neutral-600">
          {note.map((section) => (
            <li key={section.label}>
              <span className="text-neutral-500">{section.label}: </span>
              {section.note}
            </li>
          ))}
        </ul>
      )}
    </PanelFrame>
  );
}
