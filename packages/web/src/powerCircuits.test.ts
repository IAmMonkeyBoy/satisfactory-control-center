import { describe, expect, it } from "vitest";
import type { PowerCircuit } from "@scc/shared";
import { idleCircuitCount, notableCircuits } from "./powerCircuits";

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

describe("notableCircuits", () => {
  it("leads with the biggest grid rather than the lowest-numbered circuit", () => {
    // The failure this exists to prevent: circuit 0 is a pair of wall poles and
    // circuit 37 is the whole factory, and the panel used to show only circuit 0.
    const circuits = [
      circuit({ id: "0" }),
      circuit({ id: "37", capacityMW: 72250, batteryPercent: 100 }),
      circuit({ id: "42", capacityMW: 180 }),
    ];

    expect(notableCircuits(circuits).map((c) => c.id)).toEqual(["37", "42"]);
  });

  it("keeps a circuit that has batteries but no generators of its own", () => {
    const circuits = [circuit({ id: "9", batteryPercent: 40 })];

    expect(notableCircuits(circuits).map((c) => c.id)).toEqual(["9"]);
  });

  it("drops circuits carrying neither a generator nor a battery", () => {
    const circuits = [circuit({ id: "1" }), circuit({ id: "2" })];

    expect(notableCircuits(circuits)).toEqual([]);
  });

  it("orders equal capacities by id so the panel does not reshuffle", () => {
    const circuits = [circuit({ id: "8", capacityMW: 100 }), circuit({ id: "3", capacityMW: 100 })];

    expect(notableCircuits(circuits).map((c) => c.id)).toEqual(["3", "8"]);
  });
});

describe("idleCircuitCount", () => {
  it("counts what the panel chose not to list", () => {
    const circuits = [
      circuit({ id: "0" }),
      circuit({ id: "1" }),
      circuit({ id: "37", capacityMW: 72250 }),
    ];

    expect(idleCircuitCount(circuits)).toBe(2);
  });
});
