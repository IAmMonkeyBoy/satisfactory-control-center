import type { JSX } from "react";
import type { SourceAgeTag } from "@scc/shared";
import { ageLabel, sourceLabel } from "../format";

/** The shared "source · age" freshness label — every panel and the following
 * indicator render their provenance through this one component. */
export function FreshnessTag({ tag, now }: { tag: SourceAgeTag; now: number }): JSX.Element {
  return (
    <>
      {sourceLabel(tag.source)} · {ageLabel(tag, now)}
    </>
  );
}
