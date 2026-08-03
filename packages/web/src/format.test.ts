import { describe, expect, it } from "vitest";
import { formatDuration } from "./format";

describe("formatDuration", () => {
  it("floors sub-minute durations to a single reassuring label", () => {
    expect(formatDuration(30_000)).toBe("under 1 min");
  });

  it("shows whole minutes under an hour", () => {
    expect(formatDuration(18 * 60_000)).toBe("18 min");
  });

  it("switches to hours and minutes at 60 minutes", () => {
    expect(formatDuration(65 * 60_000)).toBe("1h 5m");
  });

  it("rounds to the nearest minute", () => {
    expect(formatDuration(90_000)).toBe("2 min");
  });
});
