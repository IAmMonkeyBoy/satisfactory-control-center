/**
 * The live ingestor: the glue between the FRM transport and WorldState.
 *
 * `frmClient.ts` only knows how to reach FRM and deliver whatever it sends;
 * everything about what that data *means* — which session it belongs to,
 * whether accepting it changes the followed session, which domain each
 * endpoint fills — lives here, mirroring how `saveWatcher.ts` owns the
 * baseline's decisions while `saveParseClient.ts` stays a dumb transport.
 *
 * Session identity is authoritative from FRM while it's live (spec, "Followed
 * session and merge rules"): `getSessionInfo` is the only endpoint that answers
 * it, so domain pushes (`getPower` and peers) are held back until at least one
 * `getSessionInfo` push has been seen, and a session that differs from the one
 * currently followed triggers the silent full reset before anything from the
 * new session is merged in.
 */
import type { LiveDomainUpdate, WorldStateStore } from "../saves/worldStateStore.ts";
import {
  startFrmClient,
  type FrmClientEvent,
  type FrmClientOptions,
  type FrmEndpoint,
  type FrmStatus,
} from "./frmClient.ts";
import {
  mapDepot,
  mapDrones,
  mapFactoryBuildings,
  mapMachines,
  mapPlayers,
  mapPower,
  mapProduction,
  mapSessionName,
  mapSink,
  mapStorage,
  mapTrains,
  mapVehicles,
} from "./frmDomains.ts";

export type LiveEvent =
  | { type: "sessionChanged"; from: string | null; to: string }
  | { type: "statusChanged"; status: FrmStatus };

/** What the ingestor needs from its data source — real or faked in tests. */
export interface FrmSourceHandlers {
  onData: (endpoint: FrmEndpoint, data: unknown, capturedAt: number) => void;
  onStatusChange: (status: FrmStatus) => void;
}

export interface FrmSource {
  close(): void;
}

export interface LiveIngestorOptions {
  store: WorldStateStore;
  /** FRM connection settings, passed through to the default transport. Ignored
   *  when `createSource` overrides it. */
  host?: string;
  port?: number;
  pollIntervalMs?: number;
  reconnectDelayMs?: number;
  createSocket?: FrmClientOptions["createSocket"];
  fetchImpl?: FrmClientOptions["fetchImpl"];
  /** Override the data source entirely; tests inject a fake driven by hand
   *  instead of a real WebSocket/HTTP transport (FRM interactions mocked). */
  createSource?: (handlers: FrmSourceHandlers) => FrmSource;
  onEvent?: (event: LiveEvent) => void;
  /** Raw transport-level events (socket open/close, poll start/stop) for
   *  logging; ignored when `createSource` overrides the transport. */
  onTransportEvent?: (event: FrmClientEvent) => void;
}

export interface LiveIngestor {
  /** The session FRM is currently streaming, or null while it's down or hasn't
   *  confirmed one yet — consulted by the save watcher for held-save gating
   *  (spec: "with FRM down, newest save wins outright"). */
  liveSessionName(): string | null;
  close(): void;
}

export function startLiveIngestor(options: LiveIngestorOptions): LiveIngestor {
  const { store } = options;
  const emit = (event: LiveEvent): void => options.onEvent?.(event);

  // FRM's own session identity, known only once a `getSessionInfo` push has
  // been seen, and forgotten the moment FRM becomes unreachable — never stale
  // guesswork carried across an outage.
  let sessionName: string | null = null;

  function applySessionName(newSessionName: string, capturedAt: number): void {
    if (newSessionName !== sessionName) {
      const followed = store.followedSessionName();
      if (sessionChangeRequiresReset(newSessionName, followed)) {
        emit({ type: "sessionChanged", from: followed, to: newSessionName });
        store.reset();
      }
      sessionName = newSessionName;
    }

    // Record the session (and this push's timestamp) even when nothing else
    // changed: it's how the store learns the followed session before any
    // domain push has arrived, and how the followed-session tag stays fresh on
    // every `getSessionInfo` cycle even if power/production/storage haven't
    // changed enough to push again.
    store.applyLiveDomains({}, { sessionName: newSessionName, capturedAt });
  }

  const handlers: FrmSourceHandlers = {
    onData(endpoint, data, capturedAt) {
      if (endpoint === "getSessionInfo") {
        const newSessionName = mapSessionName(data);
        if (newSessionName !== null) applySessionName(newSessionName, capturedAt);
        return;
      }

      // Domain data can't be attributed to a session until one has been
      // confirmed; it arrives again on FRM's next push cycle regardless.
      if (sessionName === null) return;

      const update = domainUpdate(endpoint, data);
      if (update) store.applyLiveDomains(update, { sessionName, capturedAt });
    },

    onStatusChange(status) {
      emit({ type: "statusChanged", status });
      if (status === "down") {
        sessionName = null;
        store.clearLive();
      }
    },
  };

  const createSource = options.createSource ?? defaultSource(options);
  const source = createSource(handlers);

  return {
    liveSessionName: () => sessionName,
    close: () => source.close(),
  };
}

function defaultSource(options: LiveIngestorOptions): (handlers: FrmSourceHandlers) => FrmSource {
  return (handlers) =>
    startFrmClient({
      host: options.host,
      port: options.port,
      pollIntervalMs: options.pollIntervalMs,
      reconnectDelayMs: options.reconnectDelayMs,
      createSocket: options.createSocket,
      fetchImpl: options.fetchImpl,
      onData: handlers.onData,
      onStatusChange: handlers.onStatusChange,
      onEvent: options.onTransportEvent,
    });
}

/**
 * The session-identity rule itself, as a pure decision (mirrors
 * `followedSession.ts`'s `decideDisposition`): a newly-confirmed FRM session
 * requires the silent full reset only when it displaces a session already
 * being followed, never on the first confirmation of one nothing was
 * following yet.
 */
function sessionChangeRequiresReset(
  newSessionName: string,
  followedSessionName: string | null,
): boolean {
  return followedSessionName !== null && followedSessionName !== newSessionName;
}

function domainUpdate(endpoint: FrmEndpoint, data: unknown): LiveDomainUpdate | undefined {
  switch (endpoint) {
    case "getPower":
      return { power: mapPower(data) };
    case "getProdStats":
      return { production: mapProduction(data) };
    case "getFactory":
      return { machines: mapMachines(data), mapBuildings: mapFactoryBuildings(data) };
    case "getStorageInv":
      return { storage: mapStorage(data) };
    case "getCloudInv":
      return { depot: mapDepot(data) };
    case "getResourceSink":
      return { sink: mapSink(data) };
    case "getPlayer":
      return { mapPlayers: mapPlayers(data) };
    case "getVehicles":
      return { mapVehicles: mapVehicles(data) };
    case "getTrains":
      return { mapTrains: mapTrains(data) };
    case "getDrone":
      return { mapDrones: mapDrones(data) };
    case "getSessionInfo":
      return undefined;
  }
}
