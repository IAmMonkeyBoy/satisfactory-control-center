import { describe, expect, it } from "vitest";
import type { MachineRollup } from "@scc/shared";
import { productionAlarms } from "./productionAlarms";

function rollup(overrides: Partial<MachineRollup> & { className: string }): MachineRollup {
  return {
    displayName: overrides.className,
    totalCount: 1,
    producingCount: null,
    idleCount: null,
    pausedCount: null,
    averageEfficiencyPercent: null,
    ...overrides,
  };
}

describe("productionAlarms", () => {
  it("raises a critical alarm when a machine class has stopped producing entirely", () => {
    const alarms = productionAlarms([
      rollup({
        className: "Build_ConstructorMk1_C",
        displayName: "Constructor",
        totalCount: 3,
        producingCount: 0,
        idleCount: 2,
        pausedCount: 1,
      }),
    ]);

    expect(alarms).toEqual([
      {
        key: "production-stalled-Build_ConstructorMk1_C",
        severity: "critical",
        message: "Constructor stalled — 0 of 3 producing",
      },
    ]);
  });

  it("raises a warning when average efficiency drops below the threshold but some machines still run", () => {
    const alarms = productionAlarms([
      rollup({
        className: "Build_SmelterMk1_C",
        displayName: "Smelter",
        totalCount: 4,
        producingCount: 3,
        averageEfficiencyPercent: 62.5,
      }),
    ]);

    expect(alarms).toEqual([
      {
        key: "production-low-Build_SmelterMk1_C",
        severity: "warning",
        message: "Smelter at 63% efficiency",
      },
    ]);
  });

  it("stays quiet for a healthy machine class running at or above the threshold", () => {
    const alarms = productionAlarms([
      rollup({
        className: "Build_ConstructorMk1_C",
        totalCount: 2,
        producingCount: 2,
        averageEfficiencyPercent: 100,
      }),
    ]);

    expect(alarms).toEqual([]);
  });

  it("stays quiet when running state is unknown (baseline, no live feed yet)", () => {
    const alarms = productionAlarms([
      rollup({ className: "Build_ConstructorMk1_C", totalCount: 5 }),
    ]);

    expect(alarms).toEqual([]);
  });

  it("skips a class with no installed machines", () => {
    expect(productionAlarms([rollup({ className: "Build_SmelterMk1_C", totalCount: 0 })])).toEqual(
      [],
    );
  });

  it("raises one alarm per affected machine class", () => {
    const alarms = productionAlarms([
      rollup({ className: "A", totalCount: 1, producingCount: 0 }),
      rollup({ className: "B", totalCount: 1, producingCount: 1, averageEfficiencyPercent: 100 }),
      rollup({ className: "C", totalCount: 1, producingCount: 0 }),
    ]);

    expect(alarms.map((a) => a.key)).toEqual(["production-stalled-A", "production-stalled-C"]);
  });
});
