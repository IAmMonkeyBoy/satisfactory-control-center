import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  codexKindSchema,
  encodeSseFrame,
  type CodexEntry,
  type CodexKind,
  type MapSnapshot,
  type StorageSearchResponse,
  type WorldState,
} from "@scc/shared";
import { serveStatic } from "./staticFiles.ts";

export interface ServerOptions {
  /** Milliseconds between SSE snapshot pushes. */
  pushIntervalMs?: number;
  /** WorldState source — the store the ingestors write into. */
  buildWorldState: (now: number) => WorldState;
  /** Item-location search — the request/response half of the storage domain
   *  (ADR 0003), backed by the same store as `buildWorldState`. */
  searchStorage: (query: string) => StorageSearchResponse;
  /** The Tier 1 map's payload — buildings and movers, backed by the same
   *  store as `buildWorldState`, served on demand via REST rather than
   *  pushed with every WorldState snapshot (ADR 0003, spec "Transport and
   *  API surface": "map payload snapshots"). */
  buildMapSnapshot: (now: number) => MapSnapshot;
  /** The codex popover's lookup (ADR 0003; spec "v1 features: Codex
   *  popover") — backed by the static-data module, not the WorldState
   *  store. Null when the class is unknown to the dump, or before static
   *  data has finished loading at startup. */
  lookupCodex: (kind: CodexKind, className: string) => CodexEntry | null;
  /** Resolve a className to an icon file on disk, or null when no icons
   *  directory is configured (spec, "Licensing constraints": icons are
   *  never bundled, so the file may also simply not exist — the route
   *  handler 404s on that separately). */
  resolveIconPath: (className: string) => string | null;
  /** Built web app directory to serve non-API GETs from; omit in tests. */
  staticDir?: string;
}

const DEFAULT_PUSH_INTERVAL_MS = 2000;

/**
 * Create the control-center HTTP server. Six routes carry the transport contract:
 *   GET /api/worldstate      — REST snapshot of the current WorldState (request/response)
 *   GET /api/stream          — SSE stream that pushes WorldState snapshots (push)
 *   GET /api/storage/search  — item-location search, `?item=` a name/class substring
 *                              (request/response, per ADR 0003 — never pushed over SSE)
 *   GET /api/map             — Tier 1 map snapshot: buildings + movers
 *                              (request/response, per ADR 0003 — never pushed over SSE)
 *   GET /api/codex/:kind/:className — codex popover lookup, `:kind` is "item" or
 *                              "building" (request/response, per ADR 0003)
 *   GET /api/codex/icon/:className  — codex popover icon image, from Aaron's own
 *                              install (never bundled — spec "Licensing constraints")
 *
 * The returned server is not yet listening; the caller binds a port. Tests bind
 * port 0 for an ephemeral port.
 */
export function createServer(options: ServerOptions): http.Server {
  const pushIntervalMs = options.pushIntervalMs ?? DEFAULT_PUSH_INTERVAL_MS;
  const {
    buildWorldState,
    searchStorage,
    buildMapSnapshot,
    lookupCodex,
    resolveIconPath,
    staticDir,
  } = options;

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

    if (req.method === "GET" && url.pathname === "/api/storage/search") {
      const body = JSON.stringify(searchStorage(url.searchParams.get("item") ?? ""));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/map") {
      const body = JSON.stringify(buildMapSnapshot(Date.now()));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/codex/icon/")) {
      const className = decodeURIComponent(url.pathname.slice("/api/codex/icon/".length));
      handleCodexIcon(res, resolveIconPath(className));
      return;
    }

    const codexMatch = /^\/api\/codex\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && codexMatch) {
      const kindResult = codexKindSchema.safeParse(codexMatch[1]);
      const entry = kindResult.success
        ? lookupCodex(kindResult.data, decodeURIComponent(codexMatch[2]!))
        : null;
      if (!entry) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(entry));
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

/**
 * Stream an icon file from disk, or 404 when there's no icons directory
 * configured, the className has no matching file, or the resolved path
 * turns out not to exist by the time it's read (extraction is a manual,
 * ad-hoc step on Aaron's own machine — the file genuinely may not be there).
 * Icons are never bundled into the repo or any build (spec, "Licensing
 * constraints"), so 404 here is an expected, silent-in-the-UI outcome, not
 * a server fault.
 */
function handleCodexIcon(res: http.ServerResponse, filePath: string | null): void {
  if (!filePath) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  stat(filePath)
    .then((info) => {
      if (!info.isFile()) throw new Error("not a file");
      res.writeHead(200, { "Content-Type": "image/png" });
      return new Promise<void>((resolve, reject) => {
        const stream = createReadStream(filePath);
        stream.on("error", reject);
        stream.on("end", resolve);
        stream.pipe(res);
      });
    })
    .catch(() => {
      if (!res.headersSent) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      } else {
        res.end();
      }
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
