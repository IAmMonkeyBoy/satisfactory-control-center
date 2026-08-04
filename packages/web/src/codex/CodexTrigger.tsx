import type { JSX, ReactNode } from "react";
import type { CodexKind } from "@scc/shared";
import { useCodexContext } from "./CodexContext";

/**
 * Makes its children clickable to open the codex popover (spec, "v1
 * features: Codex popover": "Click any item or machine anywhere in the
 * dashboard"). Renders a `<button>` in place of whatever static element a
 * panel used to show a name in; `className` carries that element's own
 * layout classes forward (e.g. `truncate`, or `block w-full` where the
 * original wasn't a flex item) so swapping it in changes nothing about the
 * surrounding layout. Tailwind's preflight already resets a `<button>`'s
 * color/background/font to inherit, so a hover/focus color is the only
 * extra styling needed here.
 *
 * `gameClassName` (the game's own class name, e.g. `Desc_IronPlate_C`) is
 * deliberately not called `className` — every other component in this
 * codebase uses that name for a CSS class list, and this component takes
 * both.
 */
export function CodexTrigger({
  kind,
  gameClassName,
  className,
  title,
  children,
}: {
  kind: CodexKind;
  gameClassName: string;
  className?: string;
  title?: string;
  children: ReactNode;
}): JSX.Element {
  const { open } = useCodexContext();

  return (
    <button
      type="button"
      title={title}
      onClick={() => open(kind, gameClassName)}
      className={`cursor-pointer hover:text-ficsit-orange focus-visible:text-ficsit-orange focus:outline-none ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
