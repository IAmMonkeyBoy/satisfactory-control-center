/**
 * The FRM transport: WebSocket push with an HTTP polling fallback.
 *
 * FRM's WebSocket pushes every subscribed endpoint on its own cycle (~5 s
 * default) once subscribed; that's the fast path. If the socket drops — the mod
 * restarting, a network blip — polling each endpoint over plain HTTP keeps data
 * flowing while a reconnect is attempted in the background, and the client goes
 * back to push-driven updates the moment the socket reopens (spec, "Ingestor 1:
 * FRM client"). Only when *neither* transport can reach FRM at all does this
 * module report `"down"`: the caller (the live ingestor) reads that as "FRM
 * itself is gone", not "the socket happens to be down right now".
 *
 * The WebSocket constructor and `fetch` are both injectable so tests can stand
 * in for the network entirely (FRM interactions mocked) rather than needing a
 * running mod or a real port.
 */
import { errorMessage } from "../errorMessage.ts";

/** The FRM endpoints this build's WorldState domains can use, plus session
 *  identity. `getFactory` and `getTrains` have no domain to land in yet
 *  (see `frmDomains.ts`) and are deliberately not subscribed. */
export type FrmEndpoint = "getSessionInfo" | "getPower" | "getProdStats" | "getStorageInv";

const ALL_ENDPOINTS: readonly FrmEndpoint[] = [
  "getSessionInfo",
  "getPower",
  "getProdStats",
  "getStorageInv",
];

/** Whether FRM is reachable at all right now, by either transport. */
export type FrmStatus = "live" | "down";

/** Everything the client does that is worth a log line. */
export type FrmClientEvent =
  | { type: "wsConnected" }
  | { type: "wsDisconnected" }
  | { type: "pollStarted" }
  | { type: "pollStopped" }
  | { type: "statusChanged"; status: FrmStatus }
  | { type: "error"; error: string };

/**
 * The subset of the standard `WebSocket` API this module uses, so tests can
 * supply a fake without standing up a real socket. The global `WebSocket`
 * (Node 22+, no extra dependency) satisfies this directly.
 */
export interface FrmSocket {
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "error", listener: () => void): void;
  send(data: string): void;
  close(): void;
}

export interface FrmClientOptions {
  /** FRM's host — always localhost in practice (spec, ADR 0001: one local
   *  process), but overridable the same way the save/docs paths are. */
  host?: string;
  port?: number;
  endpoints?: readonly FrmEndpoint[];
  /** How often to poll each endpoint over HTTP while the socket is down. */
  pollIntervalMs?: number;
  /** How long to wait between WebSocket reconnect attempts. */
  reconnectDelayMs?: number;
  /** Override the socket constructor; tests inject a fake. */
  createSocket?: (url: string) => FrmSocket;
  /** Override `fetch`; tests inject a fake. */
  fetchImpl?: typeof fetch;
  /** Called with every endpoint payload FRM delivers, by whichever transport. */
  onData: (endpoint: FrmEndpoint, data: unknown, capturedAt: number) => void;
  /** Called whenever reachability flips between `"live"` and `"down"`. */
  onStatusChange: (status: FrmStatus) => void;
  onEvent?: (event: FrmClientEvent) => void;
}

export interface FrmClient {
  close(): void;
}

/** FRM's default web server / WebSocket port. Exported so callers configuring
 *  their own override (e.g. `index.ts`'s `SCC_FRM_PORT`) share one definition. */
export const DEFAULT_PORT = 8080;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_RECONNECT_DELAY_MS = 5000;

export function startFrmClient(options: FrmClientOptions): FrmClient {
  const host = options.host ?? "localhost";
  const port = options.port ?? DEFAULT_PORT;
  const endpoints = options.endpoints ?? ALL_ENDPOINTS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url));
  const fetchImpl = options.fetchImpl ?? fetch;
  const emit = (event: FrmClientEvent): void => options.onEvent?.(event);

  let closed = false;
  /** Whichever socket exists right now, open or still connecting — what `close()`
   *  tears down. */
  let currentSocket: FrmSocket | undefined;
  /** True only once `currentSocket` has actually opened; a poll tick in flight
   *  checks this, not `currentSocket`, so it doesn't treat "connecting" as live. */
  let wsOpen = false;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let pollTimer: NodeJS.Timeout | undefined;
  let status: FrmStatus | undefined;

  function setStatus(next: FrmStatus): void {
    if (status === next) return;
    status = next;
    emit({ type: "statusChanged", status: next });
    options.onStatusChange(next);
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connectSocket();
    }, reconnectDelayMs);
    reconnectTimer.unref();
  }

  function startPolling(): void {
    if (pollTimer || closed) return;
    emit({ type: "pollStarted" });
    void pollTick();
    pollTimer = setInterval(() => void pollTick(), pollIntervalMs);
    pollTimer.unref();
  }

  function stopPolling(): void {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = undefined;
    emit({ type: "pollStopped" });
  }

  async function pollTick(): Promise<void> {
    const results = await Promise.allSettled(
      endpoints.map(async (endpoint) => {
        const response = await fetchImpl(`http://${host}:${port}/${endpoint}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: unknown = await response.json();
        return { endpoint, data };
      }),
    );

    // The socket may have come back up mid-poll; a push-driven client is
    // already the source of truth, so a poll tick in flight when that happens
    // must not downgrade status behind its back.
    if (wsOpen) return;

    const capturedAt = Date.now();
    let reachable = false;
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      reachable = true;
      options.onData(result.value.endpoint, result.value.data, capturedAt);
    }
    setStatus(reachable ? "live" : "down");
  }

  function connectSocket(): void {
    if (closed) return;

    let ws: FrmSocket;
    try {
      ws = createSocket(`ws://${host}:${port}/`);
    } catch (cause) {
      emit({ type: "error", error: errorMessage(cause) });
      scheduleReconnect();
      return;
    }
    currentSocket = ws;

    ws.addEventListener("open", () => {
      if (closed) {
        ws.close();
        return;
      }
      wsOpen = true;
      stopPolling();
      setStatus("live");
      emit({ type: "wsConnected" });
      ws.send(JSON.stringify({ action: "subscribe", endpoints: [...endpoints] }));
    });

    ws.addEventListener("message", (event) => {
      const push = parseEnvelope(event.data);
      if (push) options.onData(push.endpoint, push.data, Date.now());
    });

    const onDown = (): void => {
      if (currentSocket !== ws) return; // already superseded by a later attempt
      currentSocket = undefined;
      wsOpen = false;
      emit({ type: "wsDisconnected" });
      startPolling();
      scheduleReconnect();
    };
    ws.addEventListener("close", onDown);
    ws.addEventListener("error", onDown);
  }

  connectSocket();
  // Poll from the start too: a socket that never opens (FRM's HTTP server up,
  // WebSocket disabled or still starting) must not leave the dashboard silent
  // until the first reconnect delay elapses.
  startPolling();

  return {
    close(): void {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopPolling();
      currentSocket?.close();
      currentSocket = undefined;
      wsOpen = false;
    },
  };
}

/**
 * Decode one WebSocket frame into the endpoint it names and the payload FRM
 * sent for it, or undefined for anything that doesn't parse as the documented
 * `{ endpoint, data }` envelope — including pushes for endpoints this client
 * never subscribed to, which a shared FRM connection could in principle still
 * deliver.
 */
function parseEnvelope(raw: unknown): { endpoint: FrmEndpoint; data: unknown } | undefined {
  if (typeof raw !== "string") return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const record =
    typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  const endpoint = record?.endpoint;
  if (typeof endpoint !== "string" || !isFrmEndpoint(endpoint)) return undefined;

  return { endpoint, data: record?.data };
}

function isFrmEndpoint(value: string): value is FrmEndpoint {
  return (ALL_ENDPOINTS as readonly string[]).includes(value);
}
