/**
 * The save-parsing worker thread (ADR 0001).
 *
 * Parsing a late-game save is seconds of solid CPU over ~180,000 objects; doing it
 * on the main thread would stall the SSE stream and, once the live feed lands, the
 * FRM connection with it. So the bytes are handed to this thread, and only the
 * small extracted baseline travels back — never the parsed save, which is orders
 * of magnitude larger than the domains derived from it.
 *
 * The worker loads the game's static data once at startup so that every parse can
 * resolve class names to display names and rates without re-reading a 10 MB file.
 */
import { parentPort, workerData, type MessagePort } from "node:worker_threads";
import { Parser } from "@etothepii/satisfactory-file-parser";
import { loadStaticData, parseDocs, type StaticData } from "../staticData/staticData.ts";
import { extractBaseline, type SaveObjectView } from "./extractBaseline.ts";
import type { ParseRequest, ParseResponse, SaveParserWorkerData } from "./saveParseProtocol.ts";

const port = parentPort;
if (!port) throw new Error("saveParserWorker must be run as a worker thread");

const { docsPath } = workerData as SaveParserWorkerData;

/**
 * Static data is optional: with no game install to read (a machine that only runs
 * the server, or CI), the dashboard still works and simply shows class names.
 */
const staticDataReady: Promise<StaticData> = docsPath
  ? loadStaticData(docsPath).catch((cause: unknown) => {
      port.postMessage({
        type: "warning",
        message: `static data unavailable at ${docsPath}: ${String(cause)}`,
      } satisfies ParseResponse);
      return parseDocs([]);
    })
  : Promise.resolve(parseDocs([]));

port.on("message", (request: ParseRequest) => {
  void handle(port, request);
});

async function handle(port: MessagePort, request: ParseRequest): Promise<void> {
  try {
    // `throwErrors: false` keeps mod-authored objects the parser cannot fully
    // decode from failing the whole save; the file's integrity was already
    // established by validation before these bytes were sent.
    const save = Parser.ParseSave("watched-save", request.bytes, { throwErrors: false });
    const baseline = extractBaseline(saveObjects(save), await staticDataReady);
    port.postMessage({ type: "parsed", id: request.id, baseline } satisfies ParseResponse);
  } catch (cause) {
    port.postMessage({
      type: "failed",
      id: request.id,
      error: cause instanceof Error ? cause.message : String(cause),
    } satisfies ParseResponse);
  }
}

/** Flatten the save's levels into the object stream the extractor walks. */
function* saveObjects(save: {
  levels: Record<string, { objects: unknown[] }>;
}): Iterable<SaveObjectView> {
  for (const level of Object.values(save.levels)) {
    for (const object of level.objects) {
      yield object as SaveObjectView;
    }
  }
}
