import { describe, expect, it, vi } from "vitest";
import { emptyBaselineDomains } from "../saves/extractBaseline.ts";
import { createWorldStateStore, type WorldStateStore } from "../saves/worldStateStore.ts";
import {
  startLiveIngestor,
  type FrmSource,
  type FrmSourceHandlers,
  type LiveEvent,
} from "./liveIngestor.ts";

const SESSION_INFO = (sessionName: string): unknown => ({ SessionName: sessionName });
const POWER_PUSH = [
  { CircuitGroupID: 0, PowerCapacity: 100, PowerProduction: 10, PowerConsumed: 5 },
];
const PROD_PUSH = [
  { ClassName: "Desc_IronPlate_C", Name: "Iron Plate", CurrentProd: 40, MaxProd: 60 },
];
const STORAGE_PUSH = [
  { Inventory: [{ ClassName: "Desc_IronPlate_C", Name: "Iron Plate", Amount: 12 }] },
];

/** A fake source the test drives by hand instead of a real transport. */
function fakeSource(): {
  createSource: (handlers: FrmSourceHandlers) => FrmSource;
  handlers: FrmSourceHandlers;
} {
  let captured!: FrmSourceHandlers;
  const createSource = (handlers: FrmSourceHandlers): FrmSource => {
    captured = handlers;
    return { close: vi.fn() };
  };
  return {
    createSource,
    get handlers() {
      return captured;
    },
  };
}

function seedBaseline(store: WorldStateStore, sessionName: string, saveDateTime = 1_000): void {
  store.applyBaseline(emptyBaselineDomains(), {
    headerVersion: 14,
    saveVersion: 1,
    buildVersion: 1,
    saveName: "",
    mapName: "Persistent_Level",
    sessionName,
    playDurationSeconds: 0,
    saveDateTime,
  });
}

describe("startLiveIngestor", () => {
  it("reports no live session until FRM has confirmed one", () => {
    const store = createWorldStateStore();
    const fake = fakeSource();
    const ingestor = startLiveIngestor({ store, createSource: fake.createSource });

    expect(ingestor.liveSessionName()).toBeNull();
  });

  it("holds domain pushes until getSessionInfo has confirmed a session", () => {
    const store = createWorldStateStore();
    const fake = fakeSource();
    startLiveIngestor({ store, createSource: fake.createSource });

    fake.handlers.onData("getPower", POWER_PUSH, 5_000);

    expect(store.snapshot(5_000).power.tag.source).toBe("baseline");
  });

  it("merges domain pushes into the matching WorldState domain once a session is confirmed", () => {
    const store = createWorldStateStore();
    const fake = fakeSource();
    const ingestor = startLiveIngestor({ store, createSource: fake.createSource });

    fake.handlers.onData("getSessionInfo", SESSION_INFO("Random Defaults"), 4_000);
    fake.handlers.onData("getPower", POWER_PUSH, 5_000);
    fake.handlers.onData("getProdStats", PROD_PUSH, 5_100);
    fake.handlers.onData("getStorageInv", STORAGE_PUSH, 5_200);

    const ws = store.snapshot(5_500);
    expect(ingestor.liveSessionName()).toBe("Random Defaults");
    expect(ws.power.tag).toEqual({ source: "live", capturedAt: 5_000 });
    expect(ws.power.data.circuits[0]?.productionMW).toBe(10);
    expect(ws.production.data.items[0]?.currentPerMin).toBe(40);
    expect(ws.storage.data.items[0]?.count).toBe(12);
  });

  it("does not reset when FRM confirms a session nothing was following yet", () => {
    const store = createWorldStateStore();
    const fake = fakeSource();
    const events: LiveEvent[] = [];
    startLiveIngestor({ store, createSource: fake.createSource, onEvent: (e) => events.push(e) });

    fake.handlers.onData("getSessionInfo", SESSION_INFO("Random Defaults"), 4_000);

    expect(events).not.toContainEqual(expect.objectContaining({ type: "sessionChanged" }));
    expect(store.followedSessionName()).toBe("Random Defaults");
  });

  it("does not reset when FRM confirms the session the baseline is already following", () => {
    const store = createWorldStateStore();
    seedBaseline(store, "Random Defaults");
    const resetSpy = vi.spyOn(store, "reset");
    const fake = fakeSource();
    startLiveIngestor({ store, createSource: fake.createSource });

    fake.handlers.onData("getSessionInfo", SESSION_INFO("Random Defaults"), 4_000);

    expect(resetSpy).not.toHaveBeenCalled();
  });

  it("silently resets WorldState when FRM's session differs from the one currently followed", () => {
    const store = createWorldStateStore();
    seedBaseline(store, "Random Defaults");
    const fake = fakeSource();
    const events: LiveEvent[] = [];
    const ingestor = startLiveIngestor({
      store,
      createSource: fake.createSource,
      onEvent: (e) => events.push(e),
    });

    fake.handlers.onData("getSessionInfo", SESSION_INFO("Dune Desert"), 4_000);

    expect(events).toContainEqual({
      type: "sessionChanged",
      from: "Random Defaults",
      to: "Dune Desert",
    });
    expect(store.followedSessionName()).toBe("Dune Desert");
    expect(ingestor.liveSessionName()).toBe("Dune Desert");
    // The reset drops the old session's baseline too — nothing carries across.
    expect(store.snapshot(5_000).storage.data.items).toEqual([]);
  });

  it("ignores a getSessionInfo push with no readable SessionName, rather than resetting", () => {
    const store = createWorldStateStore();
    seedBaseline(store, "Random Defaults");
    const resetSpy = vi.spyOn(store, "reset");
    const fake = fakeSource();
    startLiveIngestor({ store, createSource: fake.createSource });

    fake.handlers.onData("getSessionInfo", { IsPaused: true }, 4_000);

    expect(resetSpy).not.toHaveBeenCalled();
    expect(store.followedSessionName()).toBe("Random Defaults");
  });

  it("clears every live domain and forgets the session once FRM goes down", () => {
    // A real baseline exists for this session, so there's something honest to
    // fall back to — the ordinary case a live ingestor sees in practice, since
    // the save watcher keeps the baseline in sync with FRM's session while live.
    const store = createWorldStateStore();
    seedBaseline(store, "Random Defaults");
    const fake = fakeSource();
    const ingestor = startLiveIngestor({ store, createSource: fake.createSource });
    fake.handlers.onData("getSessionInfo", SESSION_INFO("Random Defaults"), 4_000);
    fake.handlers.onData("getPower", POWER_PUSH, 5_000);

    fake.handlers.onStatusChange("down");

    expect(ingestor.liveSessionName()).toBeNull();
    expect(store.snapshot(5_500).power.tag.source).toBe("baseline");
    // The followed session itself is untouched — only its source degraded.
    expect(store.followedSessionName()).toBe("Random Defaults");
  });

  it("keeps the last live reading, honestly aging, when FRM goes down before any save was ever accepted", () => {
    // No baseline exists for this session at all — a save-only fallback would
    // report one that was never taken. Falling back to the frozen live
    // reading is the honest choice (worldStateStore.test.ts covers this at
    // the store level; this proves the ingestor doesn't defeat it).
    const store = createWorldStateStore();
    const fake = fakeSource();
    const ingestor = startLiveIngestor({ store, createSource: fake.createSource });
    fake.handlers.onData("getSessionInfo", SESSION_INFO("Random Defaults"), 4_000);
    fake.handlers.onData("getPower", POWER_PUSH, 5_000);

    fake.handlers.onStatusChange("down");

    expect(ingestor.liveSessionName()).toBeNull();
    expect(store.snapshot(20_000).power.tag).toEqual({ source: "live", capturedAt: 5_000 });
    expect(store.followedSessionName()).toBe("Random Defaults");
  });

  it("resumes merging once FRM reconnects and reconfirms its session", () => {
    const store = createWorldStateStore();
    const fake = fakeSource();
    const ingestor = startLiveIngestor({ store, createSource: fake.createSource });
    fake.handlers.onData("getSessionInfo", SESSION_INFO("Random Defaults"), 4_000);
    fake.handlers.onData("getPower", POWER_PUSH, 5_000);
    fake.handlers.onStatusChange("down");

    fake.handlers.onStatusChange("live");
    fake.handlers.onData("getSessionInfo", SESSION_INFO("Random Defaults"), 9_000);
    fake.handlers.onData("getPower", POWER_PUSH, 9_100);

    expect(ingestor.liveSessionName()).toBe("Random Defaults");
    expect(store.snapshot(9_500).power.tag).toEqual({ source: "live", capturedAt: 9_100 });
  });

  it("closes the underlying source", () => {
    const store = createWorldStateStore();
    const close = vi.fn();
    const ingestor = startLiveIngestor({
      store,
      createSource: () => ({ close }),
    });

    ingestor.close();

    expect(close).toHaveBeenCalled();
  });
});
