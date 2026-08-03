import { useEffect, useState } from "react";
import type { WorldState } from "@scc/shared";
import {
  appendSamples,
  emptySparklineWindow,
  type SparklinePoint,
  type SparklineWindowState,
} from "./sparklineWindow";

/**
 * Feeds the sparkline window from each incoming WorldState snapshot. `sample`
 * extracts whatever series a caller cares about (see `power/powerSparklineSamples.ts`)
 * — this hook only owns the buffer's lifecycle, matching `sparklineWindow.ts`'s
 * generic, panel-agnostic design. `sample` should be a stable function reference
 * (a module-level function, not an inline closure) so it doesn't retrigger the
 * effect every render.
 */
export function useSparklineWindow(
  worldState: WorldState | null,
  sample: (worldState: WorldState) => ReadonlyMap<string, SparklinePoint>,
): SparklineWindowState {
  const [state, setState] = useState<SparklineWindowState>(emptySparklineWindow);

  useEffect(() => {
    if (!worldState) return;
    const sessionName = worldState.followedSession?.sessionName ?? null;
    setState((prev) => appendSamples(prev, sessionName, sample(worldState)));
  }, [worldState, sample]);

  return state;
}
