import { describe, expect, it } from "vitest";
import type { MapBuilding } from "@scc/shared";
import { mapAlarms } from "./mapAlarms";

function building(overrides: Partial<MapBuilding> = {}): MapBuilding {
  return {
    id: "b1",
    className: "Build_ConstructorMk1_C",
    displayName: "Constructor",
    transform: { x: 100, y: 200, z: 5, rotationDegrees: 0 },
    footprint: { widthCm: 800, depthCm: 800 },
    status: "running",
    ...overrides,
  };
}

describe("mapAlarms", () => {
  it("raises a critical alarm, located at the building, for a no-power building", () => {
    const alarms = mapAlarms([building({ id: "b1", displayName: "Smelter", status: "no-power" })]);

    expect(alarms).toEqual([
      {
        key: "map-no-power-b1",
        severity: "critical",
        message: "No power — Smelter",
        location: { x: 100, y: 200, z: 5, rotationDegrees: 0 },
      },
    ]);
  });

  it("raises nothing for a running or idle building", () => {
    expect(mapAlarms([building({ status: "running" }), building({ status: "idle" })])).toEqual([]);
  });

  it("raises nothing for a baseline building — status is always null there", () => {
    expect(mapAlarms([building({ status: null })])).toEqual([]);
  });

  it("raises one alarm per no-power building", () => {
    const alarms = mapAlarms([
      building({ id: "b1", status: "no-power" }),
      building({ id: "b2", status: "no-power" }),
    ]);
    expect(alarms.map((a) => a.key)).toEqual(["map-no-power-b1", "map-no-power-b2"]);
  });
});
