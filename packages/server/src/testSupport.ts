import type { Server } from "node:http";
import type { MapSnapshot, StorageSearchResponse, WorldState } from "@scc/shared";

/**
 * A populated WorldState for the transport tests. They are about the SSE and REST
 * contract, not about any ingestor, so they supply their own state rather than
 * depending on whatever the save watcher happens to have found.
 *
 * The values wobble with `now` so a test can tell successive pushes apart, and the
 * domains mix live and baseline tags to exercise the freshness contract both ways.
 */
export function sampleWorldState(now: number): WorldState {
  const wobble = Math.sin((now / 60000) * Math.PI * 2);
  const productionMW = 1200 + Math.round(wobble * 150);

  return {
    generatedAt: now,
    followedSession: { sessionName: "Random Defaults", source: "live", capturedAt: now },
    power: {
      tag: { source: "live", capturedAt: now },
      data: {
        circuits: [
          {
            id: "1",
            productionMW,
            consumptionMW: 1100,
            capacityMW: 1400,
            batteryPercent: 60,
            fuseTripped: false,
          },
        ],
      },
    },
    production: {
      tag: { source: "live", capturedAt: now },
      data: {
        items: [
          {
            className: "Desc_IronPlate_C",
            displayName: "Iron Plate",
            currentPerMin: 90,
            maxPerMin: 120,
          },
        ],
      },
    },
    machines: {
      tag: { source: "live", capturedAt: now },
      data: {
        machines: [
          {
            className: "Build_ConstructorMk1_C",
            displayName: "Constructor",
            totalCount: 3,
            producingCount: 2,
            idleCount: 0,
            pausedCount: 1,
            averageEfficiencyPercent: 75,
          },
        ],
      },
    },
    storage: {
      // A baseline domain: sourced from the last save, so a few minutes old.
      tag: { source: "baseline", capturedAt: now - 4 * 60 * 1000 },
      data: {
        items: [{ className: "Desc_IronPlate_C", displayName: "Iron Plate", count: 4820 }],
      },
    },
    depot: {
      tag: { source: "live", capturedAt: now },
      data: {
        items: [{ className: "Desc_CopperSheet_C", displayName: "Copper Sheet", count: 200 }],
      },
    },
    deathCrates: {
      tag: { source: "baseline", capturedAt: now - 4 * 60 * 1000 },
      data: {
        crates: [
          {
            id: "BP_Crate_C_1",
            location: { x: 100, y: 200, z: 5 },
            items: [{ className: "Desc_IronPlate_C", displayName: "Iron Plate", count: 3 }],
          },
        ],
      },
    },
    sink: {
      tag: { source: "live", capturedAt: now },
      data: {
        totalPoints: 3_334_555_366,
        numCoupons: 13,
        pointsToNextCoupon: 14_902_634,
        percentToNextCoupon: 15.7,
      },
    },
    milestones: {
      tag: { source: "baseline", capturedAt: now - 4 * 60 * 1000 },
      data: {
        currentMilestone: {
          className: "Schematic_3-2_C",
          displayName: "Coal Power",
          ingredients: [
            { className: "Desc_Cable_C", displayName: "Cable", amount: 40, targetAmount: 100 },
            {
              className: "Desc_IronPlate_C",
              displayName: "Iron Plate",
              amount: 100,
              targetAmount: 100,
            },
          ],
        },
        spaceElevatorPhase: "Phase 2",
        activeResearch: [
          {
            className: "Research_Caterium_1_C",
            displayName: "Caterium Research",
            secondsRemaining: 90,
          },
        ],
        collectibles: { hardDriveResultsAwaitingClaim: 2, alternateRecipesUnlocked: 7 },
        playDurationSeconds: 5 * 60 * 60,
      },
    },
  };
}

/** A canned item-location search result for the `/api/storage/search` REST
 *  contract test — the route itself is exercised, not any real search logic. */
export function sampleStorageSearchResponse(query: string): StorageSearchResponse {
  return {
    query,
    available: true,
    tag: { source: "baseline", capturedAt: 1000 },
    matches: [
      {
        containerId: "Build_StorageContainerMk1_C_1",
        containerDisplayName: "Storage Container",
        location: { x: 100, y: 200, z: 5 },
        itemClassName: "Desc_IronPlate_C",
        itemDisplayName: "Iron Plate",
        count: 500,
      },
    ],
  };
}

/** A canned Tier 1 map snapshot for the `/api/map` REST contract test — the
 *  route itself is exercised, not any real store logic. */
export function sampleMapSnapshot(now: number): MapSnapshot {
  return {
    generatedAt: now,
    buildings: {
      tag: { source: "live", capturedAt: now },
      data: [
        {
          id: "Build_ConstructorMk1_C_1",
          className: "Build_ConstructorMk1_C",
          displayName: "Constructor",
          transform: { x: -70700, y: 254500, z: -3600, rotationDegrees: 90 },
          footprint: { widthCm: 800, depthCm: 800 },
          status: "running",
        },
      ],
    },
    movers: {
      tag: { source: "live", capturedAt: now },
      data: [
        {
          id: "Char_Player_C_1",
          kind: "player",
          className: "Char_Player_C",
          displayName: "derpierre65",
          transform: { x: -57604.68, y: 260436.19, z: -3018.36, rotationDegrees: 115.55 },
          footprint: { widthCm: 100, depthCm: 100 },
        },
      ],
    },
  };
}

/**
 * The TCP port a test server bound to. `Server.address()` is typed as
 * `string | AddressInfo | null`; this narrows it to the numeric port for a
 * server listening on port 0, throwing if it isn't an IP socket.
 *
 * Test-only helper — excluded from the production build (see tsconfig.json).
 */
export function boundPort(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("server is not listening on a TCP port");
  }
  return address.port;
}
