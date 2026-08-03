/**
 * The main thread's handle on the save-parsing worker.
 *
 * One long-lived worker serves every parse: it pays the cost of loading the game's
 * static data once instead of on every autosave, and it keeps the parse off the
 * thread serving the SSE stream (ADR 0001).
 *
 * A worker that dies is replaced rather than mourned. Parsing is the one place
 * here that runs unbounded third-party code over multi-megabyte input, so a crash
 * — a save the parser chokes on, a thread out of memory — is a real possibility;
 * an always-on dashboard that stopped updating until someone restarted it would be
 * a poor answer. In-flight parses reject, and the next one gets a fresh worker.
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

  const pending = new Map<number, Pending>();
  let worker: Worker | undefined;
  let nextId = 1;
  let closed = false;

  const failAll = (error: Error): void => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  /** The running worker, started if there isn't one — at construction, or anew
   *  after one died. */
  function ensureWorker(): Worker {
    if (worker) return worker;

    const started = new Worker(workerUrl, { workerData });
    started.unref(); // a pending parse must never hold the process open

    started.on("message", (response: ParseResponse) => {
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

    // A dead worker takes its in-flight parses with it. Rejecting them stops the
    // watcher waiting forever on an answer that is never coming, and dropping the
    // reference means the next parse starts a replacement instead of posting into
    // the void.
    const discard = (error: Error): void => {
      if (worker === started) worker = undefined;
      failAll(error);
    };
    started.on("error", (error: Error) => discard(error));
    started.on("exit", (code) => discard(new Error(`save parser worker exited with code ${code}`)));

    worker = started;
    return started;
  }

  // Start eagerly so the worker has loaded the game's static data before the
  // first save turns up, rather than paying for it on the critical path.
  ensureWorker();

  return {
    parse(bytes: ArrayBuffer): Promise<BaselineDomains> {
      if (closed) return Promise.reject(new Error("save parser is closed"));
      const id = nextId++;
      const request: ParseRequest = { id, bytes };
      return new Promise<BaselineDomains>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ensureWorker().postMessage(request, [bytes]);
      });
    },
    async close(): Promise<void> {
      closed = true;
      const running = worker;
      worker = undefined;
      await running?.terminate();
      failAll(new Error("save parser is closed"));
    },
  };
}
