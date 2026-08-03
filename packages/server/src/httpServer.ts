import http from "node:http";
import { encodeSseFrame, type WorldState } from "@scc/shared";
import { serveStatic } from "./staticFiles.ts";

export interface ServerOptions {
  /** Milliseconds between SSE snapshot pushes. */
  pushIntervalMs?: number;
  /** WorldState source — the store the ingestors write into. */
  buildWorldState: (now: number) => WorldState;
  /** Built web app directory to serve non-API GETs from; omit in tests. */
  staticDir?: string;
}

const DEFAULT_PUSH_INTERVAL_MS = 2000;

/**
 * Create the control-center HTTP server. Two routes carry the transport contract:
 *   GET /api/worldstate — REST snapshot of the current WorldState (request/response)
 *   GET /api/stream     — SSE stream that pushes WorldState snapshots (push)
 *
 * The returned server is not yet listening; the caller binds a port. Tests bind
 * port 0 for an ephemeral port.
 */
export function createServer(options: ServerOptions): http.Server {
  const pushIntervalMs = options.pushIntervalMs ?? DEFAULT_PUSH_INTERVAL_MS;
  const { buildWorldState, staticDir } = options;

  return http.createServer((req, res) => {
    // Single-user LAN tool: allow the Vite dev origin to read the API directly.
    res.setHeader("Access-Control-Allow-Origin", "*");

    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/api/worldstate") {
      const body = JSON.stringify(buildWorldState(Date.now()));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/stream") {
      handleStream(res, buildWorldState, pushIntervalMs);
      return;
    }

    // Non-API GETs are served from the built web app when one is configured.
    // Unmatched /api/* paths must 404, never fall back to the dashboard HTML.
    if (req.method === "GET" && staticDir && !url.pathname.startsWith("/api/")) {
      serveStatic(req, res, staticDir, url.pathname)
        .then((handled) => {
          if (!handled) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not found");
          }
        })
        .catch(() => {
          if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Internal error");
        });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });
}

function handleStream(
  res: http.ServerResponse,
  buildWorldState: (now: number) => WorldState,
  pushIntervalMs: number,
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const push = (): void => {
    res.write(encodeSseFrame({ type: "snapshot", worldState: buildWorldState(Date.now()) }));
  };

  // Send the current snapshot immediately so a fresh (or reconnecting) client
  // renders without waiting a full interval.
  push();
  const timer = setInterval(push, pushIntervalMs);

  // Tie cleanup to the *response* lifecycle. `req`'s "close" can fire as soon as
  // the (bodyless) request finishes reading, which would tear down the stream
  // after a single frame; `res`'s "close" fires when the connection to the client
  // actually goes away — which is what we want to stop pushing on.
  res.on("close", () => {
    clearInterval(timer);
  });
}
