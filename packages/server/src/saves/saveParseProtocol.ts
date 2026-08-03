/**
 * The messages exchanged with the save-parsing worker.
 *
 * Kept in its own module so the worker and its client agree on one definition,
 * and so tests can stand a fixture worker up against the same contract.
 */
import type { BaselineDomains } from "./extractBaseline.ts";

export interface SaveParserWorkerData {
  /** Path to the game's `en-US.json`, or null when no install was found. */
  docsPath: string | null;
}

/**
 * A save to parse. The bytes are transferred rather than copied, so a 10 MB save
 * crosses the thread boundary without being cloned — the sending side loses access
 * to the buffer, which is exactly right since it has no further use for it.
 */
export interface ParseRequest {
  id: number;
  bytes: ArrayBuffer;
}

export type ParseResponse =
  | { type: "parsed"; id: number; baseline: BaselineDomains }
  | { type: "failed"; id: number; error: string }
  /** Out-of-band notice not tied to a request, e.g. static data failing to load. */
  | { type: "warning"; message: string };
