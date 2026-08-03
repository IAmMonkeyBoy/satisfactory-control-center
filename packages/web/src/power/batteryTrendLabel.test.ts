import { describe, expect, it } from "vitest";
import { batteryTrendLabel } from "./batteryTrendLabel";

describe("batteryTrendLabel", () => {
  it("shows a dash when there isn't enough history yet", () => {
    expect(batteryTrendLabel({ kind: "insufficient-data" })).toBe("—");
  });

  it("names charging and steady trends plainly", () => {
    expect(batteryTrendLabel({ kind: "charging" })).toBe("charging");
    expect(batteryTrendLabel({ kind: "steady" })).toBe("steady");
  });

  it("pairs draining with a formatted time-to-empty", () => {
    expect(batteryTrendLabel({ kind: "draining", timeToEmptyMs: 18 * 60_000 })).toBe(
      "draining · 18 min left",
    );
  });
});
