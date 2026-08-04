import { useEffect, useState } from "react";
import { mapSnapshotSchema, type MapSnapshot } from "@scc/shared";

/** Matches the server's default SSE push interval (`httpServer.ts`'s
 *  `DEFAULT_PUSH_INTERVAL_MS`) — movers "update at live-feed cadence" (spec,
 *  "Tier 1 map") without polling faster than WorldState itself refreshes. */
const DEFAULT_POLL_INTERVAL_MS = 2000;

/**
 * Poll the Tier 1 map's REST snapshot (ADR 0003: request/response, not SSE —
 * see `mapSnapshot.ts`'s doc comment for why movers aren't folded into the
 * WorldState push). A malformed or failed response is dropped silently and
 * the last good snapshot stays on screen, the same "keep showing what we
 * had" choice `useWorldState` makes for a dropped SSE connection — the next
 * poll tick tries again on its own.
 */
export function useMapSnapshot(mapUrl = "/api/map"): MapSnapshot | null {
  const [snapshot, setSnapshot] = useState<MapSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = (): void => {
      fetch(mapUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`map snapshot failed: ${res.status}`);
          return res.json() as Promise<unknown>;
        })
        .then((data) => {
          if (cancelled) return;
          const parsed = mapSnapshotSchema.safeParse(data);
          if (parsed.success) setSnapshot(parsed.data);
        })
        .catch(() => {
          // Network failure or a non-2xx response: nothing to do but wait
          // for the next tick.
        });
    };

    poll();
    const timer = setInterval(poll, DEFAULT_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [mapUrl]);

  return snapshot;
}
