/**
 * The save-watcher ingestor: the baseline half of WorldState.
 *
 * It watches the game's SaveGames directory — read-only, always; nothing here ever
 * writes there — and on any change, re-reads every save's header to decide which
 * one the dashboard should be following. Headers are cheap (a few hundred bytes
 * off the front of each file) which is what makes rescanning affordable, and they
 * are the only trustworthy source of session identity and save time: autosave slot
 * numbers rotate and players can name a manual save anything at all.
 *
 * Writes are debounced because a save takes 1–2 s and fires several change events
 * on the way; parsing is delegated so this module stays about *which* save to
 * trust, not how to read one.
 */
import { watch, type FSWatcher } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { errorMessage } from "../errorMessage.ts";
import type { BaselineDomains } from "./extractBaseline.ts";
import { chooseBaselineSave, type SaveCandidate } from "./followedSession.ts";
import { readSaveHeader, type SaveHeader } from "./saveHeader.ts";
import { readValidatedSave, type ReadSaveOptions } from "./validatedSave.ts";
import type { WorldStateStore } from "./worldStateStore.ts";

/** Bytes read off the front of each save to decode its header. */
const HEADER_SCAN_BYTES = 64 * 1024;

const DEFAULT_DEBOUNCE_MS = 2000;

/** Everything the watcher does that is worth a log line. */
export type WatcherEvent =
  | { type: "baseline"; path: string; sessionName: string; saveDateTime: number }
  | { type: "held"; path: string; sessionName: string; followedSessionName: string | null }
  | { type: "sessionChanged"; from: string | null; to: string }
  | { type: "rejected"; path: string; error: string }
  | { type: "error"; error: string };

export interface SaveWatcherOptions {
  /** The SaveGames directory to watch. Never written to. */
  directory: string;
  store: WorldStateStore;
  /** Parse validated save bytes into WorldState domains. */
  parseSave: (bytes: ArrayBuffer) => Promise<BaselineDomains>;
  debounceMs?: number;
  /** How hard to retry a save that is still being written. */
  readRetry?: ReadSaveOptions;
  /**
   * The session the live feed is streaming, consulted at decision time. Build 2
   * has no live feed, so this defaults to "down" and newest save wins outright;
   * Build 3 plugs FRM in here and the held-save rule starts to bite.
   */
  liveSessionName?: () => string | null;
  onEvent?: (event: WatcherEvent) => void;
}

export interface SaveWatcher {
  /**
   * The most recently held save: parsed, kept aside, never merged. Null until a
   * save from an unfollowed session turns up (CONTEXT.md, "Held save").
   */
  heldSave(): HeldSave | null;
  /**
   * Resolves once any debounce and refresh in flight have finished. Filesystem
   * watching is asynchronous by nature; this is how a caller waits for it to
   * catch up with writes that have already landed.
   */
  settled(): Promise<void>;
  close(): Promise<void>;
}

/** A save parsed in full but deliberately kept out of WorldState. */
export interface HeldSave {
  path: string;
  header: SaveHeader;
  baseline: BaselineDomains;
}

/**
 * Start watching, after doing one full scan so the dashboard shows the newest save
 * immediately rather than only from the next autosave onwards.
 */
export async function startSaveWatcher(options: SaveWatcherOptions): Promise<SaveWatcher> {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const liveSessionName = options.liveSessionName ?? (() => null);
  const emit = (event: WatcherEvent): void => options.onEvent?.(event);

  // The save last acted on, merged or held alike. Autosaves rotate through the
  // same three filenames, so identity is the pair of path and header time.
  let examinedPath: string | undefined;
  let examinedSaveDateTime: number | undefined;
  let held: HeldSave | null = null;
  let debounceTimer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let rerunRequested = false;
  let closed = false;

  async function refresh(): Promise<void> {
    const candidates = await scanHeaders(options.directory, emit);
    const choice = chooseBaselineSave({
      candidates,
      liveSessionName: liveSessionName(),
      followedSessionName: options.store.followedSessionName(),
    });
    if (!choice) return;

    const { save, disposition, sessionChanged } = choice;
    if (save.path === examinedPath && save.header.saveDateTime === examinedSaveDateTime) return;

    let validated;
    try {
      validated = await readValidatedSave(save.path, options.readRetry);
    } catch (cause) {
      emit({ type: "rejected", path: save.path, error: errorMessage(cause) });
      return;
    }

    let baseline: BaselineDomains;
    try {
      baseline = await options.parseSave(validated.bytes);
    } catch (cause) {
      emit({ type: "rejected", path: save.path, error: errorMessage(cause) });
      return;
    }

    // Whatever happens next, this save has now been dealt with; re-reading and
    // re-parsing it on every subsequent directory event would be pure waste.
    examinedPath = save.path;
    examinedSaveDateTime = validated.header.saveDateTime;

    if (disposition === "held") {
      // Parsed in full and kept aside, never merged: folding in a save from
      // another session would turn WorldState into a chimera of two worlds.
      held = { path: save.path, header: validated.header, baseline };
      emit({
        type: "held",
        path: save.path,
        sessionName: validated.header.sessionName,
        followedSessionName: options.store.followedSessionName(),
      });
      return;
    }

    if (sessionChanged) {
      // A silent full reset: no cross-session history, nothing merged across.
      emit({
        type: "sessionChanged",
        from: options.store.followedSessionName(),
        to: validated.header.sessionName,
      });
      options.store.reset();
    }

    options.store.applyBaseline(baseline, validated.header);
    held = null;
    emit({
      type: "baseline",
      path: save.path,
      sessionName: validated.header.sessionName,
      saveDateTime: validated.header.saveDateTime,
    });
  }

  /** Run a refresh, coalescing any request that arrives while one is in flight. */
  function runRefresh(): void {
    if (running) {
      rerunRequested = true;
      return;
    }
    running = refresh()
      .catch((cause: unknown) => emit({ type: "error", error: errorMessage(cause) }))
      .finally(() => {
        running = undefined;
        if (rerunRequested && !closed) {
          rerunRequested = false;
          runRefresh();
        }
      });
  }

  function schedule(): void {
    if (closed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      runRefresh();
    }, debounceMs);
    debounceTimer.unref();
  }

  await refresh();

  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(options.directory, (_event, filename) => {
      if (filename === null || filename.toLowerCase().endsWith(".sav")) schedule();
    });
    watcher.on("error", (error) => emit({ type: "error", error: errorMessage(error) }));
  } catch (cause) {
    emit({ type: "error", error: errorMessage(cause) });
  }

  return {
    heldSave(): HeldSave | null {
      return held;
    },
    async settled(): Promise<void> {
      // Give a just-written file time to trip the debounce, then drain whatever
      // refresh it started (including any coalesced re-run).
      await new Promise((resolve) => setTimeout(resolve, debounceMs + 20));
      while (running) await running;
    },
    async close(): Promise<void> {
      closed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher?.close();
      await running;
    },
  };
}

/**
 * Read the header of every `.sav` in the directory. Anything unreadable — a file
 * mid-write, a stray non-save, a save from a game version too old to decode — is
 * skipped rather than failing the scan.
 */
async function scanHeaders(
  directory: string,
  emit: (event: WatcherEvent) => void,
): Promise<SaveCandidate[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (cause) {
    emit({ type: "error", error: errorMessage(cause) });
    return [];
  }

  const candidates: SaveCandidate[] = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".sav")) continue;
    const filePath = path.join(directory, name);
    try {
      candidates.push({
        path: filePath,
        header: readSaveHeader(await readHeaderBytes(filePath)),
        mtimeMs: (await stat(filePath)).mtimeMs,
      });
    } catch {
      // Expected while a save is being written; the next change event retries.
    }
  }
  return candidates;
}

async function readHeaderBytes(filePath: string): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(HEADER_SCAN_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_SCAN_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
