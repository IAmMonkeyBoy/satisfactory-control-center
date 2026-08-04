import type { JSX, ReactNode } from "react";

/** A titled sub-section within a panel — the vertical stack of "Depot" /
 *  "Death crates" / "AWESOME Sink" style groupings Storage and Milestones
 *  both use. `right` is typically a freshness tag for a sub-section whose
 *  data ages independently of the panel's own (e.g. Storage's search
 *  result); omit it where the whole panel already shares one tag. */
export function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="mt-3 border-t border-neutral-800 pt-2 first:mt-0 first:border-t-0 first:pt-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-xs uppercase tracking-wider text-neutral-500">{title}</span>
        {right && <span className="text-xs text-neutral-600">{right}</span>}
      </div>
      {children}
    </div>
  );
}
