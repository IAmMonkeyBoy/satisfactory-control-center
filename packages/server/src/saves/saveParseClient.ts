/**
 * The main thread's handle on the save-parsing worker.
 *
 * One long-lived worker serves every parse: it pays the cost of loading the game's
 * static data once instead of on every autosave, and it keeps the parse off the
 * thread serving the SSE stream (ADR 0001).
 */
import { Worker } from "node:worker_threads";
import type { BaselineDomains } from "./extractBaseline.ts";
import { moduleSibling } from "../moduleSibling.ts";
import type { ParseRequest, ParseResponse, SaveParserWorkerData } from "./saveParseProtocol.ts";

export interface SaveParser {
  /**
   * Parse validated save bytes into WorldState domains. Ownership of `bytes` moves
   * to the worker, so the caller must not touch the buffer afterwards.
   */
  parse(bytes: ArrayBuffer): Promise<BaselineDomains>;
  close(): Promise<void>;
}

export interface WorkerSaveParserOptions {
  /** Path to the game's `en-US.json`, or null to run without static data. */
  docsPath: string | null;
  /** Override the worker module; tests point this at a stand-in worker. */
  workerUrl?: URL;
  /** Called with notices the worker raises outside any one parse. */
  onWarning?: (message: string) => void;
}

interface Pending {
  resolve: (baseline: BaselineDomains) => void;
  reject: (error: Error) => void;
}

export function createWorkerSaveParser(options: WorkerSaveParserOptions): SaveParser {
  const workerUrl = options.workerUrl ?? moduleSibling(import.meta.url, "saveParserWorker");
  const workerData: SaveParserWorkerData = { docsPath: options.docsPath };
  const worker = new Worker(workerUrl, { workerData });
  worker.unref(); // a pending parse must never hold the process open

  const pending = new Map<number, Pending>();
  let nextId = 1;
  let closed = false;

  const failAll = (error: Error): void => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  worker.on("message", (response: ParseResponse) => {
    if (response.type === "warning") {
      options.onWarning?.(response.message);
      return;
    }
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.type === "parsed") request.resolve(response.baseline);
    else request.reject(new Error(response.error));
  });

  // A worker that dies takes its in-flight parses with it; surfacing that as a
  // rejection keeps the watcher from waiting forever on an answer never coming.
  worker.on("error", (error: Error) => failAll(error));
  worker.on("exit", () => failAll(new Error("save parser worker exited")));

  return {
    parse(bytes: ArrayBuffer): Promise<BaselineDomains> {
      if (closed) return Promise.reject(new Error("save parser is closed"));
      const id = nextId++;
      const request: ParseRequest = { id, bytes };
      return new Promise<BaselineDomains>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage(request, [bytes]);
      });
    },
    async close(): Promise<void> {
      closed = true;
      await worker.terminate();
      failAll(new Error("save parser is closed"));
    },
  };
}
