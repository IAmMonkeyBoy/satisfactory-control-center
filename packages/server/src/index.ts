import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDocsFile, findSaveDirectory } from "./gameFiles.ts";
import { createServer } from "./httpServer.ts";
import { DEFAULT_PORT as FRM_DEFAULT_PORT, type FrmClientEvent } from "./live/frmClient.ts";
import { startLiveIngestor, type LiveEvent, type LiveIngestor } from "./live/liveIngestor.ts";
import { createWorkerSaveParser } from "./saves/saveParseClient.ts";
import { startSaveWatcher, type WatcherEvent } from "./saves/saveWatcher.ts";
import { createWorldStateStore } from "./saves/worldStateStore.ts";

const PORT = Number(process.env.PORT ?? 4317);

/** FRM is LAN-only and — per ADR 0001 — always the same machine as this server
 *  in v1, so `localhost` is the right default; overridable like the save/docs
 *  paths for setups that differ. */
const FRM_HOST = process.env.SCC_FRM_HOST ?? "localhost";
const FRM_PORT = Number(process.env.SCC_FRM_PORT ?? FRM_DEFAULT_PORT);

// Serve the built dashboard from the server so it and the API share one origin
// (ADR 0001). In dev the dashboard is run separately via Vite; if no build
// exists here yet, non-API GETs simply 404.
const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(here, "../../web/dist");

const store = createWorldStateStore();
const server = createServer({ staticDir, buildWorldState: (now) => store.snapshot(now) });

server.listen(PORT, () => {
  console.log(`Control center server listening on http://localhost:${PORT}`);
  console.log(`  Dashboard:     http://localhost:${PORT}/`);
  console.log(`  SSE stream:    http://localhost:${PORT}/api/stream`);
  console.log(`  REST snapshot: http://localhost:${PORT}/api/worldstate`);
});

// The live feed starts unconditionally — unlike the save directory and static
// data, FRM has nothing to probe for on disk; whether it's actually reachable
// is exactly what `startFrmClient`'s reconnect/poll loop is for. Started before
// the baseline so `liveSessionName` exists for the save watcher's held-save
// gating from its very first scan.
const live = startLiveIngestor({
  store,
  host: FRM_HOST,
  port: FRM_PORT,
  onEvent: logLiveEvent,
  onTransportEvent: logFrmTransportEvent,
});

await startBaselineIngestor(live);

console.log(`Watching for FRM at ws://${FRM_HOST}:${FRM_PORT}/`);

/**
 * Start the save watcher — the baseline ingestor. Without a game install on
 * this machine there is nothing to watch, and the server still runs: the dashboard
 * shows an empty WorldState with no followed session rather than failing to start.
 */
async function startBaselineIngestor(liveIngestor: LiveIngestor): Promise<void> {
  const [saveDirectory, docsPath] = await Promise.all([findSaveDirectory(), findDocsFile()]);

  if (!saveDirectory) {
    console.warn("No SaveGames directory found — set SCC_SAVE_DIR to watch one.");
    return;
  }
  if (!docsPath) {
    console.warn("No game static data found — set SCC_DOCS_FILE for display names and rates.");
  }

  const parser = createWorkerSaveParser({
    docsPath,
    onWarning: (message) => console.warn(`Save parser: ${message}`),
  });

  await startSaveWatcher({
    directory: saveDirectory,
    store,
    parseSave: (bytes) => parser.parse(bytes),
    liveSessionName: () => liveIngestor.liveSessionName(),
    onEvent: logWatcherEvent,
  });

  console.log(`Watching saves in ${saveDirectory}`);
}

function logLiveEvent(event: LiveEvent): void {
  switch (event.type) {
    case "sessionChanged":
      console.log(`FRM session changed from ${event.from ?? "none"} to ${event.to}`);
      return;
    case "statusChanged":
      console.log(`FRM is now ${event.status}`);
  }
}

/** Raw transport-level detail behind a `statusChanged` in `logLiveEvent` — logged
 *  at a finer grain so a WS drop and its poll fallback are each visible on their
 *  own line, not just the live/down status they add up to. */
function logFrmTransportEvent(event: FrmClientEvent): void {
  switch (event.type) {
    case "wsConnected":
      console.log("FRM WebSocket connected");
      return;
    case "wsDisconnected":
      console.log("FRM WebSocket disconnected");
      return;
    case "pollStarted":
      console.log("FRM HTTP polling started");
      return;
    case "pollStopped":
      console.log("FRM HTTP polling stopped");
      return;
    case "statusChanged":
      return; // surfaced already via logLiveEvent's own statusChanged
    case "error":
      console.warn(`FRM client: ${event.error}`);
  }
}

function logWatcherEvent(event: WatcherEvent): void {
  switch (event.type) {
    case "baseline":
      console.log(
        `Baseline from ${path.basename(event.path)} — ${event.sessionName}, saved ${new Date(
          event.saveDateTime,
        ).toISOString()}`,
      );
      return;
    case "held":
      console.log(
        `Held ${path.basename(event.path)} — session "${event.sessionName}" is not the followed "${event.followedSessionName}"`,
      );
      return;
    case "sessionChanged":
      console.log(`Followed session changed from ${event.from ?? "none"} to ${event.to}`);
      return;
    case "rejected":
      console.warn(`Rejected ${path.basename(event.path)}: ${event.error}`);
      return;
    case "error":
      console.warn(`Save watcher: ${event.error}`);
  }
}
