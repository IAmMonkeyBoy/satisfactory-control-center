import { describe, expect, it } from "vitest";
import { appendSamples, emptySparklineWindow, SPARKLINE_WINDOW_MS } from "./sparklineWindow";

describe("appendSamples", () => {
  it("accumulates points across calls within the same session", () => {
    const afterFirst = appendSamples(
      emptySparklineWindow,
      "Session A",
      new Map([["a", { t: 1000, v: 10 }]]),
    );
    const afterSecond = appendSamples(
      afterFirst,
      "Session A",
      new Map([["a", { t: 2000, v: 20 }]]),
    );

    expect(afterSecond.series.get("a")).toEqual([
      { t: 1000, v: 10 },
      { t: 2000, v: 20 },
    ]);
  });

  it("drops a sample whose timestamp does not advance the series, deduping repeated pushes", () => {
    const afterFirst = appendSamples(
      emptySparklineWindow,
      "Session A",
      new Map([["a", { t: 1000, v: 10 }]]),
    );
    const afterRepeat = appendSamples(
      afterFirst,
      "Session A",
      new Map([["a", { t: 1000, v: 10 }]]),
    );

    expect(afterRepeat.series.get("a")).toEqual([{ t: 1000, v: 10 }]);
  });

  it("trims points older than the window relative to the newest sample", () => {
    const old = appendSamples(emptySparklineWindow, "Session A", new Map([["a", { t: 0, v: 1 }]]));
    const later = appendSamples(
      old,
      "Session A",
      new Map([["a", { t: SPARKLINE_WINDOW_MS + 1, v: 2 }]]),
    );

    expect(later.series.get("a")).toEqual([{ t: SPARKLINE_WINDOW_MS + 1, v: 2 }]);
  });

  it("keeps points still inside the window", () => {
    const old = appendSamples(
      emptySparklineWindow,
      "Session A",
      new Map([["a", { t: 1000, v: 1 }]]),
    );
    const later = appendSamples(
      old,
      "Session A",
      new Map([["a", { t: SPARKLINE_WINDOW_MS, v: 2 }]]),
    );

    expect(later.series.get("a")).toEqual([
      { t: 1000, v: 1 },
      { t: SPARKLINE_WINDOW_MS, v: 2 },
    ]);
  });

  it("drops every prior series when the followed session changes", () => {
    const beforeSwitch = appendSamples(
      emptySparklineWindow,
      "Session A",
      new Map([
        ["a", { t: 1000, v: 1 }],
        ["b", { t: 1000, v: 5 }],
      ]),
    );

    const afterSwitch = appendSamples(
      beforeSwitch,
      "Session B",
      new Map([["a", { t: 2000, v: 99 }]]),
    );

    expect(afterSwitch.series.get("a")).toEqual([{ t: 2000, v: 99 }]);
    expect(afterSwitch.series.get("b")).toBeUndefined();
    expect(afterSwitch.sessionName).toBe("Session B");
  });

  it("leaves series untouched for a call carrying no samples for them", () => {
    const withA = appendSamples(
      emptySparklineWindow,
      "Session A",
      new Map([["a", { t: 1000, v: 1 }]]),
    );
    const withB = appendSamples(withA, "Session A", new Map([["b", { t: 1000, v: 2 }]]));

    expect(withB.series.get("a")).toEqual([{ t: 1000, v: 1 }]);
    expect(withB.series.get("b")).toEqual([{ t: 1000, v: 2 }]);
  });
});
