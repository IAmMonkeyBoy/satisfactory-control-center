import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { emptyBaselineDomains, type BaselineDomains } from "./extractBaseline.ts";
import { readSaveHeader } from "./saveHeader.ts";
import { startSaveWatcher, type SaveWatcher, type WatcherEvent } from "./saveWatcher.ts";
import { buildSaveFile, buildSaveHeader } from "./saveTestSupport.ts";
import { createWorldStateStore, type WorldStateStore } from "./worldStateStore.ts";

let directory: string;
let watcher: SaveWatcher | undefined;
let store: WorldStateStore;
let events: WatcherEvent[];
let liveSessionName: string | null;
/** Set to hold every parse open, so a test can act mid-parse. */
let parseGate: { held: Promise<void>; parseStarted: () => void } | undefined;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "scc-saves-"));
  store = createWorldStateStore();
  events = [];
  liveSessionName = null;
  parseGate = undefined;
});

afterEach(async () => {
  await watcher?.close();
  watcher = undefined;
  await rm(directory, { recursive: true, force: true });
});

/**
 * A stand-in parse that reports the item count each fixture save was built with.
 * The real body is zlib-compressed, so the count travels in the header's save name
 * where the stub can read it without a parser.
 */
async function parseSave(bytes: ArrayBuffer): Promise<BaselineDomains> {
  const count = Number(readSaveHeader(Buffer.from(bytes)).saveName.replace("count=", ""));
  // A real parse takes seconds; the gate lets a test occupy that window.
  if (parseGate) {
    parseGate.parseStarted();
    await parseGate.held;
  }
  return {
    ...emptyBaselineDomains(),
    storage: { items: [{ className: "Desc_IronPlate_C", displayName: "Iron Plate", count }] },
  };
}

/**
 * Hold every parse open. `started` resolves once a parse has actually begun —
 * which is the only way to land a change strictly between the watcher deciding
 * what to do with a save and it committing that decision.
 */
function holdParses(): { started: Promise<void>; release: () => void } {
  let release = (): void => {};
  let parseStarted = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    parseStarted = resolve;
  });
  parseGate = { held, parseStarted };
  return {
    started,
    release: () => {
      parseGate = undefined;
      release();
    },
  };
}

async function writeSave(
  name: string,
  fields: { sessionName: string; saveDateTimeMs: number; count?: number },
  options: { truncated?: boolean } = {},
): Promise<void> {
  const bytes = buildSaveFile(
    { ...fields, saveName: `count=${fields.count ?? 0}` },
    { truncateBody: options.truncated },
  );
  await writeFile(path.join(directory, name), bytes);
}

async function start(): Promise<void> {
  watcher = await startSaveWatcher({
    directory,
    store,
    parseSave,
    debounceMs: 10,
    // The real backoff waits seconds for the game to finish writing; tests only
    // need to prove a rejected save is retried and then given up on.
    readRetry: { attempts: 2, retryDelayMs: 1 },
    liveSessionName: () => liveSessionName,
    onEvent: (event) => events.push(event),
  });
}

function storedCount(): number | undefined {
  return store.snapshot(Date.now()).storage.data.items[0]?.count;
}

describe("save watcher", () => {
  it("shows the newest save's contents, tagged as a baseline of its own age", async () => {
    await writeSave("Random Defaults_autosave_0.sav", {
      sessionName: "Random Defaults",
      saveDateTimeMs: 1_700_000_000_000,
      count: 1234,
    });

    await start();

    const worldState = store.snapshot(Date.now());
    expect(worldState.followedSession?.sessionName).toBe("Random Defaults");
    expect(worldState.storage.data.items).toEqual([
      { className: "Desc_IronPlate_C", displayName: "Iron Plate", count: 1234 },
    ]);
    // Age is the save's own time, not the moment the server got around to it.
    expect(worldState.storage.tag).toEqual({
      source: "baseline",
      capturedAt: 1_700_000_000_000,
    });
  });

  it("refreshes when a newer save appears in the watched directory", async () => {
    await writeSave("older.sav", {
      sessionName: "Random Defaults",
      saveDateTimeMs: 1_700_000_000_000,
      count: 1,
    });
    await start();
    expect(storedCount()).toBe(1);

    await writeSave("newer.sav", {
      sessionName: "Random Defaults",
      saveDateTimeMs: 1_700_000_060_000,
      count: 2,
    });
    await watcher!.settled();

    expect(storedCount()).toBe(2);
  });

  it("ignores a save older than the one already shown", async () => {
    await writeSave("newer.sav", {
      sessionName: "Random Defaults",
      saveDateTimeMs: 1_700_000_060_000,
      count: 2,
    });
    await start();

    await writeSave("older.sav", {
      sessionName: "Random Defaults",
      saveDateTimeMs: 1_700_000_000_000,
      count: 1,
    });
    await watcher!.settled();

    expect(storedCount()).toBe(2);
  });

  it("keeps the previous WorldState when the newest save is only half-written", async () => {
    await writeSave("good.sav", {
      sessionName: "Random Defaults",
      saveDateTimeMs: 1_700_000_000_000,
      count: 7,
    });
    await start();

    await writeSave(
      "partial.sav",
      { sessionName: "Random Defaults", saveDateTimeMs: 1_700_000_060_000, count: 999 },
      { truncated: true },
    );
    await watcher!.settled();

    expect(storedCount()).toBe(7);
    expect(events.some((event) => event.type === "rejected")).toBe(true);
  });

  it("drops and rebuilds WorldState when the followed session changes", async () => {
    await writeSave("first-world.sav", {
      sessionName: "Random Defaults",
      saveDateTimeMs: 1_700_000_000_000,
      count: 500,
    });
    await start();

    await writeSave("second-world.sav", {
      sessionName: "Dune Desert",
      saveDateTimeMs: 1_700_000_060_000,
      count: 3,
    });
    await watcher!.settled();

    const worldState = store.snapshot(Date.now());
    expect(worldState.followedSession?.sessionName).toBe("Dune Desert");
    // Rebuilt, not merged: nothing of the previous world survives.
    expect(worldState.storage.data.items).toEqual([
      { className: "Desc_IronPlate_C", displayName: "Iron Plate", count: 3 },
    ]);
  });

  it("holds a save from a session the live feed is not streaming", async () => {
    await writeSave("followed.sav", {
      sessionName: "Random Defaults",
      saveDateTimeMs: 1_700_000_000_000,
      count: 500,
    });
    liveSessionName = "Random Defaults";
    await start();

    await writeSave("other-world.sav", {
      sessionName: "Dune Desert",
      saveDateTimeMs: 1_700_000_060_000,
      count: 3,
    });
    await watcher!.settled();

    const worldState = store.snapshot(Date.now());
    expect(worldState.followedSession?.sessionName).toBe("Random Defaults");
    expect(storedCount()).toBe(500);
    expect(events.some((event) => event.type === "held")).toBe(true);
  });

  it("parses a held save and keeps it aside, ready for a session switch", async () => {
    liveSessionName = "Random Defaults";
    await writeSave("followed.sav", {
      sessionName: "Random Defaults",
      saveDateTimeMs: 1_700_000_000_000,
      count: 500,
    });
    await start();
    expect(watcher!.heldSave()).toBeNull();

    await writeSave("other-world.sav", {
      sessionName: "Dune Desert",
      saveDateTimeMs: 1_700_000_060_000,
      count: 3,
    });
    await watcher!.settled();

    // "Parsed but held" (CONTEXT.md): the work is done and the result retained,
    // it just never reaches WorldState.
    const held = watcher!.heldSave();
    expect(held?.header.sessionName).toBe("Dune Desert");
    expect(held?.baseline.storage.items[0]?.count).toBe(3);
  });

  it("does not re-read a held save on every later directory event", async () => {
    liveSessionName = "Random Defaults";
    await writeSave("other-world.sav", {
      sessionName: "Dune Desert",
      saveDateTimeMs: 1_700_000_060_000,
      count: 3,
    });
    await start();
    const afterFirst = events.filter((event) => event.type === "held").length;

    // An unrelated write stirs the directory; the held save is unchanged, so
    // re-reading and re-parsing all of it would be pure waste.
    await writeFile(path.join(directory, "notes.txt"), "touched");
    await watcher!.settled();

    expect(events.filter((event) => event.type === "held")).toHaveLength(afterFirst);
  });

  it("promotes a held save to the baseline once the live session holding it back disappears", async () => {
    liveSessionName = "Random Defaults";
    await writeSave("other-world.sav", {
      sessionName: "Dune Desert",
      saveDateTimeMs: 1_700_000_060_000,
      count: 3,
    });
    await start();
    expect(watcher!.heldSave()?.header.sessionName).toBe("Dune Desert");
    expect(store.snapshot(Date.now()).followedSession).toBeNull();

    // FRM goes down: "with FRM down, newest save wins outright" (spec). No new
    // file ever touches disk — only the live session context changed — so this
    // has to be driven by `reevaluate`, not a filesystem event.
    liveSessionName = null;
    watcher!.reevaluate();
    await watcher!.settled();

    expect(watcher!.heldSave()).toBeNull();
    const worldState = store.snapshot(Date.now());
    expect(worldState.followedSession?.sessionName).toBe("Dune Desert");
    expect(worldState.storage.data.items[0]?.count).toBe(3);
  });

  it("leaves a held save held when reevaluate finds nothing has actually changed", async () => {
    liveSessionName = "Random Defaults";
    await writeSave("other-world.sav", {
      sessionName: "Dune Desert",
      saveDateTimeMs: 1_700_000_060_000,
      count: 3,
    });
    await start();
    events.length = 0;

    watcher!.reevaluate();
    await watcher!.settled();

    expect(watcher!.heldSave()?.header.sessionName).toBe("Dune Desert");
    expect(events.some((event) => event.type === "baseline")).toBe(false);
  });

  it("ignores files that are not saves", async () => {
    await writeFile(path.join(directory, "steam_autocloud.vdf"), "not a save");
    await writeFile(path.join(directory, "notes.txt"), "also not a save");

    await start();

    expect(store.snapshot(Date.now()).followedSession).toBeNull();
  });

  it("starts with an empty WorldState when the directory holds no save", async () => {
    await start();

    const worldState = store.snapshot(Date.now());
    expect(worldState.followedSession).toBeNull();
    expect(worldState.storage.data.items).toEqual([]);
    expect(worldState.power.data.circuits).toEqual([]);
  });

  it("survives a save whose header cannot be read at all", async () => {
    await writeFile(path.join(directory, "garbage.sav"), Buffer.from([1, 2, 3]));
    await writeSave("good.sav", {
      sessionName: "Random Defaults",
      saveDateTimeMs: 1_700_000_000_000,
      count: 9,
    });

    await start();

    expect(storedCount()).toBe(9);
  });

  it("parses once for a burst of writes to the same save", async () => {
    await start();

    for (let i = 0; i < 5; i++) {
      await writeSave("Random Defaults_autosave_0.sav", {
        sessionName: "Random Defaults",
        saveDateTimeMs: 1_700_000_000_000,
        count: 42,
      });
    }
    await watcher!.settled();

    expect(events.filter((event) => event.type === "baseline")).toHaveLength(1);
    expect(storedCount()).toBe(42);
  });

  it("picks up a save written while the very first parse is still running", async () => {
    // Startup reads and parses a save, which on a large one takes seconds. A save
    // landing in that window must not be missed, or the dashboard sits stale until
    // the next autosave five minutes later.
    await writeSave("first.sav", {
      sessionName: "Random Defaults",
      saveDateTimeMs: 1_700_000_000_000,
      count: 1,
    });
    const gate = holdParses();

    const starting = start();
    await gate.started;
    await writeSave("second.sav", {
      sessionName: "Random Defaults",
      saveDateTimeMs: 1_700_000_060_000,
      count: 2,
    });
    gate.release();
    await starting;
    await watcher!.settled();

    expect(storedCount()).toBe(2);
  });

  it("holds a save if the live feed switched sessions while it was parsing", async () => {
    // The decision taken when the save was picked can be stale by the time the
    // parse finishes: here the live feed comes up mid-parse, streaming a different
    // world than the save describes.
    await writeSave("other-world.sav", {
      sessionName: "Dune Desert",
      saveDateTimeMs: 1_700_000_000_000,
      count: 3,
    });
    const gate = holdParses();

    const starting = start();
    await gate.started;
    liveSessionName = "Random Defaults";
    gate.release();
    await starting;

    expect(store.snapshot(Date.now()).followedSession).toBeNull();
    expect(watcher!.heldSave()?.header.sessionName).toBe("Dune Desert");
  });

  it("merges a save if the live feed dropped while it was parsing", async () => {
    // And the mirror image: the save was held-bound when picked, but with the live
    // feed gone there is no longer a competing session identity to defer to.
    liveSessionName = "Random Defaults";
    await writeSave("other-world.sav", {
      sessionName: "Dune Desert",
      saveDateTimeMs: 1_700_000_000_000,
      count: 3,
    });
    const gate = holdParses();

    const starting = start();
    await gate.started;
    liveSessionName = null;
    gate.release();
    await starting;

    expect(store.snapshot(Date.now()).followedSession?.sessionName).toBe("Dune Desert");
    expect(watcher!.heldSave()).toBeNull();
  });

  it("rejects a header-only file with no body", async () => {
    await writeFile(
      path.join(directory, "headeronly.sav"),
      buildSaveHeader({
        sessionName: "Random Defaults",
        saveName: "count=0",
        saveDateTimeMs: 1_700_000_000_000,
      }),
    );

    await start();

    expect(store.snapshot(Date.now()).followedSession).toBeNull();
    expect(events.some((event) => event.type === "rejected")).toBe(true);
  });
});
