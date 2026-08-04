import { describe, expect, it } from "vitest";
import type { WorldState } from "@scc/shared";
import { productionSeriesKey, productionSparklineSamples } from "./productionSparklineSamples";

function worldState(items: WorldState["production"]["data"]["items"]): WorldState {
  const tag = { source: "live" as const, capturedAt: 5000 };
  return {
    generatedAt: 5000,
    followedSession: null,
    power: { tag, data: { circuits: [] } },
    production: { tag, data: { items } },
    machines: { tag, data: { machines: [] } },
    storage: { tag, data: { items: [] } },
    depot: { tag, data: { items: [] } },
    deathCrates: { tag, data: { crates: [] } },
    sink: {
      tag,
      data: { totalPoints: 0, numCoupons: 0, pointsToNextCoupon: null, percentToNextCoupon: null },
    },
    milestones: { tag, data: { currentMilestone: null, spaceElevatorPhase: null } },
  };
}

describe("productionSparklineSamples", () => {
  it("samples an item's current rate keyed by className, timestamped by the domain's capturedAt", () => {
    const samples = productionSparklineSamples(
      worldState([
        {
          className: "Desc_IronPlate_C",
          displayName: "Iron Plate",
          currentPerMin: 90,
          maxPerMin: 120,
        },
      ]),
    );

    expect(samples.get(productionSeriesKey("Desc_IronPlate_C"))).toEqual({ t: 5000, v: 90 });
  });

  it("contributes nothing for an item whose current rate is unknown (baseline)", () => {
    const samples = productionSparklineSamples(
      worldState([
        {
          className: "Desc_IronPlate_C",
          displayName: "Iron Plate",
          currentPerMin: null,
          maxPerMin: 120,
        },
      ]),
    );

    expect(samples.size).toBe(0);
  });
});
