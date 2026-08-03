import { parentPort } from "node:worker_threads";
import { emptyBaselineDomains, type BaselineDomains } from "./extractBaseline.ts";
import type { ParseRequest, ParseResponse } from "./saveParseProtocol.ts";

/**
 * A stand-in for the real parser worker that blocks its thread for a fixed stretch
 * before replying, so tests can prove parsing really is off the main thread without
 * needing an 11 MB save file CI has no way to obtain. It answers the same protocol
 * as {@link ../saveParserWorker.ts}.
 *
 * Test-only helper — excluded from the production build (see tsconfig.json).
 */

const BLOCK_MS = 200;

const port = parentPort;
if (!port) throw new Error("test worker must be run as a worker thread");

const baseline: BaselineDomains = {
  ...emptyBaselineDomains(),
  storage: { items: [{ className: "Desc_IronPlate_C", displayName: "Iron Plate", count: 42 }] },
};

port.on("message", (request: ParseRequest) => {
  const until = Date.now() + BLOCK_MS;
  while (Date.now() < until) {
    // Deliberately synchronous: a real parse holds its thread the same way.
  }

  const response: ParseResponse =
    request.bytes.byteLength === 0
      ? { type: "failed", id: request.id, error: "refused: empty save" }
      : { type: "parsed", id: request.id, baseline };
  port.postMessage(response);
});
