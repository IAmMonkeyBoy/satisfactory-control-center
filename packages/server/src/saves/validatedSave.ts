/**
 * Reading a save file the game may still be writing, and vouching for it.
 *
 * The game does not write saves atomically and change notifications arrive before
 * the write finishes, so a save observed the instant it changes is often short by a
 * chunk or two. The research for #5 recommends copying the file to scratch and
 * parsing the copy; reading it into memory in one pass gives the same guarantee
 * more cheaply — the game can never collide with a long parse, because the file is
 * closed again before parsing starts — and leaves no scratch files to clean up.
 *
 * Two failures are retried with backoff: a sharing violation (Windows can refuse
 * the open outright during the ~1–2 s write window) and bytes that fail
 * validation, which is what a half-written file looks like.
 */
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { InvalidSaveError, validateSaveFile, type SaveHeader } from "./saveHeader.ts";

/** Errors Windows raises while the game still holds the file open for writing. */
const SHARING_VIOLATION_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);

export interface ValidatedSave {
  header: SaveHeader;
  /** The whole file, ready to be transferred to the parser worker. */
  bytes: ArrayBuffer;
}

export interface ReadSaveOptions {
  /** Total attempts before giving up. */
  attempts?: number;
  /** Delay before the first retry; doubles on each further attempt. */
  retryDelayMs?: number;
}

const DEFAULT_ATTEMPTS = 5;
const DEFAULT_RETRY_DELAY_MS = 250;

/**
 * Read and validate a save, retrying while it looks like the game is still writing
 * it. Throws the last failure once the attempts are used up — the caller keeps the
 * WorldState it already had rather than trusting a partial file.
 */
export async function readValidatedSave(
  filePath: string,
  options: ReadSaveOptions = {},
): Promise<ValidatedSave> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  let retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await delay(retryDelayMs);
      retryDelayMs *= 2;
    }

    try {
      const buffer = await readFile(filePath);
      const header = validateSaveFile(buffer);
      return {
        header,
        // Hand over a buffer of exactly this file's bytes: Node may back a small
        // read with a larger pooled ArrayBuffer, which must not be transferred.
        bytes: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      };
    } catch (cause) {
      if (!isRetryable(cause)) throw cause;
      lastError = cause;
    }
  }

  throw lastError;
}

function isRetryable(cause: unknown): boolean {
  if (cause instanceof InvalidSaveError) return true;
  const code = (cause as NodeJS.ErrnoException | null)?.code;
  return code !== undefined && SHARING_VIOLATION_CODES.has(code);
}
