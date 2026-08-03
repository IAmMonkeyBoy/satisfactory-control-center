import { describe, expect, it } from "vitest";
import type { Alarm } from "./types";
import { activeAlarms, highestSeverity, setPanelAlarms } from "./alarmRegistry";

function alarm(overrides: Partial<Alarm> & { key: string }): Alarm {
  return { severity: "warning", message: overrides.key, ...overrides };
}

describe("setPanelAlarms", () => {
  it("stores a panel's alarms under its id, leaving other panels untouched", () => {
    const registry = setPanelAlarms(
      setPanelAlarms(new Map(), "power", [alarm({ key: "fuse-1" })]),
      "production",
      [alarm({ key: "low-eff" })],
    );

    expect(
      activeAlarms(registry)
        .map((a) => a.key)
        .sort(),
    ).toEqual(["fuse-1", "low-eff"]);
  });

  it("clears a panel's alarms once it reports none, so a resolved fault disappears", () => {
    const withAlarm = setPanelAlarms(new Map(), "power", [alarm({ key: "fuse-1" })]);
    const cleared = setPanelAlarms(withAlarm, "power", []);

    expect(activeAlarms(cleared)).toEqual([]);
  });

  it("does not mutate the registry passed in, so React state updates see a new reference", () => {
    const original = new Map();
    setPanelAlarms(original, "power", [alarm({ key: "fuse-1" })]);

    expect(original.size).toBe(0);
  });
});

describe("activeAlarms", () => {
  it("sorts critical alarms before warnings regardless of registration order", () => {
    const registry = setPanelAlarms(new Map(), "power", [
      alarm({ key: "low-batt", severity: "warning" }),
      alarm({ key: "fuse-1", severity: "critical" }),
    ]);

    expect(activeAlarms(registry).map((a) => a.key)).toEqual(["fuse-1", "low-batt"]);
  });

  it("breaks ties within a severity by message so the banner order stays stable", () => {
    const registry = setPanelAlarms(new Map(), "power", [
      alarm({ key: "b", severity: "critical", message: "Zebra" }),
      alarm({ key: "a", severity: "critical", message: "Apple" }),
    ]);

    expect(activeAlarms(registry).map((a) => a.key)).toEqual(["a", "b"]);
  });
});

describe("highestSeverity", () => {
  it("returns critical when any alarm in the list is critical", () => {
    expect(
      highestSeverity([
        alarm({ key: "a", severity: "warning" }),
        alarm({ key: "b", severity: "critical" }),
      ]),
    ).toBe("critical");
  });

  it("returns warning when alarms exist but none are critical", () => {
    expect(highestSeverity([alarm({ key: "a", severity: "warning" })])).toBe("warning");
  });

  it("returns null for an empty list, so a fault-free panel renders as normal", () => {
    expect(highestSeverity([])).toBeNull();
  });
});
