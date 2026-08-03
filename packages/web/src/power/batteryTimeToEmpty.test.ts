import { describe, expect, it } from "vitest";
import type { SparklinePoint } from "../sparklines/sparklineWindow";
import { batteryTrend } from "./batteryTimeToEmpty";

function points(pairs: [t: number, v: number][]): SparklinePoint[] {
  return pairs.map(([t, v]) => ({ t, v }));
}

describe("batteryTrend", () => {
  it("reports insufficient data for an empty series", () => {
    expect(batteryTrend([])).toEqual({ kind: "insufficient-data" });
  });

  it("reports insufficient data for a single sample", () => {
    expect(batteryTrend(points([[0, 80]]))).toEqual({ kind: "insufficient-data" });
  });

  it("reports insufficient data when the samples span too little time to trust a rate", () => {
    // Two samples 2 s apart: FRM's own push cadence (~5 s) makes a rate computed
    // from this noise, not signal.
    expect(
      batteryTrend(
        points([
          [0, 80],
          [2_000, 79],
        ]),
      ),
    ).toEqual({ kind: "insufficient-data" });
  });

  it("reports draining with a time-to-empty extrapolated from the recent rate", () => {
    // Loses 10 percentage points over 5 minutes -> 2 pp/min -> 70 % left takes 35 min to empty.
    const series = points([
      [0, 80],
      [5 * 60_000, 70],
    ]);

    const trend = batteryTrend(series);
    expect(trend.kind).toBe("draining");
    if (trend.kind === "draining") {
      expect(trend.timeToEmptyMs).toBeCloseTo(35 * 60_000, -3);
    }
  });

  it("reports charging when the percentage is climbing", () => {
    const series = points([
      [0, 40],
      [5 * 60_000, 60],
    ]);

    expect(batteryTrend(series)).toEqual({ kind: "charging" });
  });

  it("reports steady when the percentage barely moves", () => {
    const series = points([
      [0, 100],
      [5 * 60_000, 100],
    ]);

    expect(batteryTrend(series)).toEqual({ kind: "steady" });
  });

  it("weighs only the recent window, so a stale drain trend doesn't linger after it levels off", () => {
    const series = points([
      [0, 100],
      [5 * 60_000, 50], // drained hard a long time ago
      [40 * 60_000, 30], // then leveled off recently
      [45 * 60_000, 30],
    ]);

    expect(batteryTrend(series)).toEqual({ kind: "steady" });
  });

  it("never reports a negative time-to-empty when already at zero", () => {
    const series = points([
      [0, 5],
      [5 * 60_000, 0],
    ]);

    const trend = batteryTrend(series);
    expect(trend.kind).toBe("draining");
    if (trend.kind === "draining") {
      expect(trend.timeToEmptyMs).toBe(0);
    }
  });
});
