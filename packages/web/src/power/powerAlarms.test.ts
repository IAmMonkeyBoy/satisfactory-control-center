import { describe, expect, it } from "vitest";
import type { PowerCircuit } from "@scc/shared";
import { powerAlarms } from "./powerAlarms";

function circuit(overrides: Partial<PowerCircuit> & { id: string }): PowerCircuit {
  return {
    productionMW: null,
    consumptionMW: null,
    capacityMW: 0,
    batteryPercent: null,
    fuseTripped: null,
    ...overrides,
  };
}

describe("powerAlarms", () => {
  it("raises a critical alarm naming the circuit whose fuse is tripped", () => {
    const alarms = powerAlarms([circuit({ id: "37", fuseTripped: true })]);

    expect(alarms).toEqual([
      { key: "power-fuse-37", severity: "critical", message: "Fuse tripped — Circuit 37" },
    ]);
  });

  it("stays quiet for a circuit whose fuse is intact", () => {
    expect(powerAlarms([circuit({ id: "1", fuseTripped: false })])).toEqual([]);
  });

  it("stays quiet when fuse state is unknown (baseline, no live feed yet)", () => {
    expect(powerAlarms([circuit({ id: "1", fuseTripped: null })])).toEqual([]);
  });

  it("raises one alarm per tripped circuit", () => {
    const alarms = powerAlarms([
      circuit({ id: "1", fuseTripped: true }),
      circuit({ id: "2", fuseTripped: false }),
      circuit({ id: "3", fuseTripped: true }),
    ]);

    expect(alarms.map((a) => a.key)).toEqual(["power-fuse-1", "power-fuse-3"]);
  });
});
