import { useEffect, useState } from "react";
import { deserializeEvent, type WorldState } from "@scc/shared";

export type ConnectionStatus = "connecting" | "live" | "reconnecting";

export interface WorldStateFeed {
  worldState: WorldState | null;
  status: ConnectionStatus;
}

/**
 * Subscribe to the server's SSE stream and expose the latest WorldState.
 *
 * EventSource reconnects on its own when the server restarts or the connection
 * drops (ADR 0003) — we don't hand-roll retry logic. We only translate its
 * open/error transitions into a coarse status the following indicator can show:
 * `error` while a connection is down (browser is retrying) becomes "reconnecting",
 * and the next `open` returns it to "live".
 */
export function useWorldState(streamUrl = "/api/stream"): WorldStateFeed {
  const [worldState, setWorldState] = useState<WorldState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    const source = new EventSource(streamUrl);

    source.onopen = () => setStatus("live");

    source.onmessage = (event) => {
      const parsed = deserializeEvent(event.data);
      if (parsed.type === "snapshot") {
        setWorldState(parsed.worldState);
        setStatus("live");
      }
    };

    source.onerror = () => {
      // EventSource is now retrying internally; reflect that and keep the last
      // known WorldState on screen rather than blanking the dashboard.
      setStatus("reconnecting");
    };

    return () => source.close();
  }, [streamUrl]);

  return { worldState, status };
}
