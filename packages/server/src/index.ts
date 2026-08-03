import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDocsFile, findSaveDirectory } from "./gameFiles.ts";
import { createServer } from "./httpServer.ts";
import { createWorkerSaveParser } from "./saves/saveParseClient.ts";
import { startSaveWatcher, type WatcherEvent } from "./saves/saveWatcher.ts";
import { createWorldStateStore } from "./saves/worldStateStore.ts";

const PORT = Number(process.env.PORT ?? 4317);

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

await startBaselineIngestor();

/**
 * Start the save watcher — the only ingestor in Build 2. Without a game install on
 * this machine there is nothing to watch, and the server still runs: the dashboard
 * shows an empty WorldState with no followed session rather than failing to start.
 */
async function startBaselineIngestor(): Promise<void> {
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
    onEvent: logWatcherEvent,
  });

  console.log(`Watching saves in ${saveDirectory}`);
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
