import type { Server } from "node:http";
import type { WorldState } from "@scc/shared";

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
    milestones: {
      tag: { source: "baseline", capturedAt: now - 4 * 60 * 1000 },
      data: { currentMilestone: "Coal Power", spaceElevatorPhase: "Phase 2" },
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
