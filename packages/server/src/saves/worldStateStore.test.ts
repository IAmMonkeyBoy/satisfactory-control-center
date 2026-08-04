import { beforeEach, describe, expect, it } from "vitest";
import { emptyBaselineDomains, type BaselineDomains } from "./extractBaseline.ts";
import type { SaveHeader } from "./saveHeader.ts";
import { createWorldStateStore, type WorldStateStore } from "./worldStateStore.ts";

function header(overrides: Partial<SaveHeader> = {}): SaveHeader {
  return {
    headerVersion: 14,
    saveVersion: 1,
    buildVersion: 1,
    saveName: "",
    mapName: "Persistent_Level",
    sessionName: "Random Defaults",
    playDurationSeconds: 0,
    saveDateTime: 1_000,
    ...overrides,
  };
}

function baseline(overrides: Partial<BaselineDomains> = {}): BaselineDomains {
  return { ...emptyBaselineDomains(), ...overrides };
}

describe("worldStateStore", () => {
  it("starts empty: no followed session, every domain a baseline-tagged empty default", () => {
    const store = createWorldStateStore();
    const ws = store.snapshot(5000);

    expect(ws.followedSession).toBeNull();
    expect(store.followedSessionName()).toBeNull();
    for (const domain of [
      ws.power,
      ws.production,
      ws.machines,
      ws.storage,
      ws.depot,
      ws.deathCrates,
      ws.sink,
      ws.milestones,
    ]) {
      expect(domain.tag).toEqual({ source: "baseline", capturedAt: 0 });
    }
  });

  it("reflects an applied baseline, tagged and aged from the save's own header time", () => {
    const store = createWorldStateStore();
    store.applyBaseline(
      baseline({
        storage: {
          items: [{ className: "Desc_IronPlate_C", displayName: "Iron Plate", count: 10 }],
        },
      }),
      header({ sessionName: "Random Defaults", saveDateTime: 2_000 }),
    );

    const ws = store.snapshot(5000);
    expect(store.followedSessionName()).toBe("Random Defaults");
    expect(ws.followedSession).toEqual({
      sessionName: "Random Defaults",
      source: "baseline",
      capturedAt: 2_000,
    });
    expect(ws.storage.tag).toEqual({ source: "baseline", capturedAt: 2_000 });
    expect(ws.storage.data.items[0]?.count).toBe(10);
  });

  describe("merge precedence", () => {
    let store: WorldStateStore;

    beforeEach(() => {
      store = createWorldStateStore();
      store.applyBaseline(
        baseline({
          production: {
            items: [
              {
                className: "Desc_IronPlate_C",
                displayName: "Iron Plate",
                currentPerMin: null,
                maxPerMin: 60,
              },
            ],
          },
          storage: {
            items: [{ className: "Desc_IronPlate_C", displayName: "Iron Plate", count: 500 }],
          },
        }),
        header({ saveDateTime: 1_000 }),
      );
    });

    it("prefers a live domain over the baseline once FRM has supplied it", () => {
      store.applyLiveDomains(
        {
          power: {
            circuits: [
              {
                id: "1",
                productionMW: 30,
                consumptionMW: 20,
                capacityMW: 50,
                batteryPercent: 80,
                fuseTripped: false,
              },
            ],
          },
        },
        { sessionName: "Random Defaults", capturedAt: 9_000 },
      );

      const ws = store.snapshot(9_500);
      expect(ws.power.tag).toEqual({ source: "live", capturedAt: 9_000 });
      expect(ws.power.data.circuits[0]?.productionMW).toBe(30);
    });

    it("leaves domains FRM hasn't pushed yet on the baseline", () => {
      store.applyLiveDomains(
        { power: { circuits: [] } },
        { sessionName: "Random Defaults", capturedAt: 9_000 },
      );

      const ws = store.snapshot(9_500);
      // Power went live; production, machines and storage stay baseline until
      // their own push.
      expect(ws.power.tag.source).toBe("live");
      expect(ws.production.tag).toEqual({ source: "baseline", capturedAt: 1_000 });
      expect(ws.production.data.items[0]?.maxPerMin).toBe(60);
      expect(ws.machines.tag).toEqual({ source: "baseline", capturedAt: 1_000 });
      expect(ws.storage.tag).toEqual({ source: "baseline", capturedAt: 1_000 });
      expect(ws.storage.data.items[0]?.count).toBe(500);
    });

    it("prefers a live machines rollup over the baseline once FRM's getFactory has supplied it", () => {
      store.applyLiveDomains(
        {
          machines: {
            machines: [
              {
                className: "Build_ConstructorMk1_C",
                displayName: "Constructor",
                totalCount: 2,
                producingCount: 1,
                idleCount: 0,
                pausedCount: 1,
                averageEfficiencyPercent: 50,
              },
            ],
          },
        },
        { sessionName: "Random Defaults", capturedAt: 9_000 },
      );

      const ws = store.snapshot(9_500);
      expect(ws.machines.tag).toEqual({ source: "live", capturedAt: 9_000 });
      expect(ws.machines.data.machines[0]?.pausedCount).toBe(1);
    });

    it("never gives milestones a live source — FRM doesn't expose it in this build", () => {
      store.applyLiveDomains(
        {
          power: { circuits: [] },
          production: { items: [] },
          storage: { items: [] },
        },
        { sessionName: "Random Defaults", capturedAt: 9_000 },
      );

      expect(store.snapshot(9_500).milestones.tag).toEqual({
        source: "baseline",
        capturedAt: 1_000,
      });
    });

    it("never gives death crates a live source — they stay baseline-only by design", () => {
      store.applyLiveDomains(
        { power: { circuits: [] } },
        { sessionName: "Random Defaults", capturedAt: 9_000 },
      );

      expect(store.snapshot(9_500).deathCrates.tag).toEqual({
        source: "baseline",
        capturedAt: 1_000,
      });
    });

    it("prefers a live depot over the baseline once FRM's getCloudInv has supplied it", () => {
      store.applyLiveDomains(
        { depot: { items: [{ className: "Desc_Cement_C", displayName: "Concrete", count: 99 }] } },
        { sessionName: "Random Defaults", capturedAt: 9_000 },
      );

      const ws = store.snapshot(9_500);
      expect(ws.depot.tag).toEqual({ source: "live", capturedAt: 9_000 });
      expect(ws.depot.data.items[0]?.count).toBe(99);
    });

    it("prefers a live sink over the baseline once FRM's getResourceSink has supplied it", () => {
      store.applyLiveDomains(
        {
          sink: {
            totalPoints: 500,
            numCoupons: 2,
            pointsToNextCoupon: 100,
            percentToNextCoupon: 50,
          },
        },
        { sessionName: "Random Defaults", capturedAt: 9_000 },
      );

      const ws = store.snapshot(9_500);
      expect(ws.sink.tag).toEqual({ source: "live", capturedAt: 9_000 });
      expect(ws.sink.data.numCoupons).toBe(2);
    });

    it("keeps each live domain's own capturedAt independent across successive pushes", () => {
      store.applyLiveDomains(
        { power: { circuits: [] } },
        { sessionName: "Random Defaults", capturedAt: 9_000 },
      );
      store.applyLiveDomains(
        { storage: { items: [] } },
        { sessionName: "Random Defaults", capturedAt: 9_200 },
      );

      const ws = store.snapshot(9_500);
      expect(ws.power.tag.capturedAt).toBe(9_000);
      expect(ws.storage.tag.capturedAt).toBe(9_200);
    });

    it("tags the followed session itself live once connected, aged from the latest push", () => {
      store.applyLiveDomains(
        { power: { circuits: [] } },
        { sessionName: "Random Defaults", capturedAt: 9_000 },
      );
      store.applyLiveDomains(
        { storage: { items: [] } },
        { sessionName: "Random Defaults", capturedAt: 9_200 },
      );

      expect(store.snapshot(9_500).followedSession).toEqual({
        sessionName: "Random Defaults",
        source: "live",
        capturedAt: 9_200,
      });
    });

    it("degrades every live domain back to baseline on clearLive, without losing the followed session", () => {
      store.applyLiveDomains(
        { power: { circuits: [] }, storage: { items: [] } },
        { sessionName: "Random Defaults", capturedAt: 9_000 },
      );
      store.clearLive();

      const ws = store.snapshot(9_500);
      expect(store.followedSessionName()).toBe("Random Defaults");
      expect(ws.followedSession?.source).toBe("baseline");
      expect(ws.power.tag).toEqual({ source: "baseline", capturedAt: 1_000 });
      expect(ws.storage.tag).toEqual({ source: "baseline", capturedAt: 1_000 });
    });
  });

  it("reset drops the baseline, the live overlay, and the followed session together", () => {
    const store = createWorldStateStore();
    store.applyBaseline(
      baseline(),
      header({ sessionName: "Random Defaults", saveDateTime: 1_000 }),
    );
    store.applyLiveDomains(
      { power: { circuits: [] } },
      { sessionName: "Random Defaults", capturedAt: 9_000 },
    );

    store.reset();

    const ws = store.snapshot(9_500);
    expect(store.followedSessionName()).toBeNull();
    expect(ws.followedSession).toBeNull();
    expect(ws.power.tag).toEqual({ source: "baseline", capturedAt: 0 });
    expect(ws.power.data.circuits).toEqual([]);
  });

  it("lets a live push establish the followed session before any save has been accepted", () => {
    const store = createWorldStateStore();
    store.applyLiveDomains(
      { power: { circuits: [] } },
      { sessionName: "Dune Desert", capturedAt: 9_000 },
    );

    expect(store.followedSessionName()).toBe("Dune Desert");
    expect(store.snapshot(9_500).followedSession).toEqual({
      sessionName: "Dune Desert",
      source: "live",
      capturedAt: 9_000,
    });
  });

  it("does not fabricate a baseline when FRM drops before any save was ever accepted for its session", () => {
    // A session confirmed only by FRM, disconnected before the first autosave
    // — there is no baseline to fall back to at all, so falling back to one
    // anyway would report a save that was never taken, aged from epoch 0.
    const store = createWorldStateStore();
    store.applyLiveDomains(
      {
        power: {
          circuits: [
            {
              id: "1",
              productionMW: 5,
              consumptionMW: 5,
              capacityMW: 10,
              batteryPercent: 50,
              fuseTripped: false,
            },
          ],
        },
      },
      { sessionName: "Dune Desert", capturedAt: 9_000 },
    );

    store.clearLive();

    const ws = store.snapshot(20_000);
    expect(store.followedSessionName()).toBe("Dune Desert");
    // The last live reading is still reported, honestly aged — not a
    // fabricated "baseline, 20 seconds old" that was never actually taken.
    expect(ws.followedSession).toEqual({
      sessionName: "Dune Desert",
      source: "live",
      capturedAt: 9_000,
    });
    expect(ws.power.tag).toEqual({ source: "live", capturedAt: 9_000 });
    expect(ws.power.data.circuits[0]?.productionMW).toBe(5);
    // A domain FRM never reported at all still has nothing to fall back to
    // either way, and stays the untouched empty default.
    expect(ws.storage.tag).toEqual({ source: "baseline", capturedAt: 0 });
    expect(ws.storage.data.items).toEqual([]);
  });

  it("prefers a real baseline over a frozen live reading once one is accepted", () => {
    const store = createWorldStateStore();
    store.applyLiveDomains(
      { power: { circuits: [] } },
      { sessionName: "Dune Desert", capturedAt: 9_000 },
    );
    store.clearLive();

    store.applyBaseline(
      baseline({
        storage: {
          items: [{ className: "Desc_IronPlate_C", displayName: "Iron Plate", count: 3 }],
        },
      }),
      header({ sessionName: "Dune Desert", saveDateTime: 15_000 }),
    );

    const ws = store.snapshot(20_000);
    expect(ws.followedSession).toEqual({
      sessionName: "Dune Desert",
      source: "baseline",
      capturedAt: 15_000,
    });
    expect(ws.power.tag).toEqual({ source: "baseline", capturedAt: 15_000 });
    expect(ws.storage.data.items[0]?.count).toBe(3);
  });
});

describe("searchStorage", () => {
  it("returns an empty result, baseline-tagged at epoch 0, before any save has been accepted", () => {
    const store = createWorldStateStore();
    expect(store.searchStorage("Iron")).toEqual({
      query: "Iron",
      tag: { source: "baseline", capturedAt: 0 },
      matches: [],
    });
  });

  it("finds every container holding a matching item, with counts and location", () => {
    const store = createWorldStateStore();
    store.applyBaseline(
      baseline({
        containers: [
          {
            id: "container-1",
            displayName: "Storage Container",
            location: { x: 1, y: 2, z: 3 },
            items: [{ className: "Desc_IronPlate_C", displayName: "Iron Plate", count: 500 }],
          },
          {
            id: "container-2",
            displayName: "Storage Container",
            location: { x: 4, y: 5, z: 6 },
            items: [
              { className: "Desc_IronPlate_C", displayName: "Iron Plate", count: 120 },
              { className: "Desc_CopperSheet_C", displayName: "Copper Sheet", count: 30 },
            ],
          },
        ],
      }),
      header({ saveDateTime: 12_000 }),
    );

    const result = store.searchStorage("Iron Plate");
    expect(result.tag).toEqual({ source: "baseline", capturedAt: 12_000 });
    expect(result.matches).toEqual([
      {
        containerId: "container-1",
        containerDisplayName: "Storage Container",
        location: { x: 1, y: 2, z: 3 },
        itemClassName: "Desc_IronPlate_C",
        itemDisplayName: "Iron Plate",
        count: 500,
      },
      {
        containerId: "container-2",
        containerDisplayName: "Storage Container",
        location: { x: 4, y: 5, z: 6 },
        itemClassName: "Desc_IronPlate_C",
        itemDisplayName: "Iron Plate",
        count: 120,
      },
    ]);
  });

  it("matches case-insensitively against the item's display name", () => {
    const store = createWorldStateStore();
    store.applyBaseline(
      baseline({
        containers: [
          {
            id: "container-1",
            displayName: "Storage Container",
            location: { x: 0, y: 0, z: 0 },
            items: [{ className: "Desc_CopperSheet_C", displayName: "Copper Sheet", count: 30 }],
          },
        ],
      }),
      header({ saveDateTime: 1_000 }),
    );

    expect(store.searchStorage("copper").matches).toHaveLength(1);
  });

  it("returns nothing for a blank query rather than dumping every container", () => {
    const store = createWorldStateStore();
    store.applyBaseline(
      baseline({
        containers: [
          {
            id: "container-1",
            displayName: "Storage Container",
            location: { x: 0, y: 0, z: 0 },
            items: [{ className: "Desc_IronPlate_C", displayName: "Iron Plate", count: 500 }],
          },
        ],
      }),
      header({ saveDateTime: 1_000 }),
    );

    expect(store.searchStorage("  ").matches).toEqual([]);
  });
});
