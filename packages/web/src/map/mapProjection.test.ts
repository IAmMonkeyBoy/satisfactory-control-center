import { describe, expect, it } from "vitest";
import {
  MAX_HALF_EXTENT_M,
  MIN_HALF_EXTENT_M,
  clampHalfExtent,
  fitView,
  orthographicFrustum,
  panView,
  worldToScenePoint,
  worldToSceneUnits,
  zoomView,
} from "./mapProjection.ts";

describe("worldToSceneUnits / worldToScenePoint", () => {
  it("converts centimetres to metres", () => {
    expect(worldToSceneUnits(100)).toBe(1);
    expect(worldToSceneUnits(-70700)).toBeCloseTo(-707);
  });

  it("maps world x -> scene x and world y -> scene z, ignoring elevation", () => {
    expect(worldToScenePoint({ x: 100, y: 200, z: 999999 })).toEqual({ x: 1, z: 2 });
  });
});

describe("clampHalfExtent", () => {
  it("clamps below the minimum", () => {
    expect(clampHalfExtent(0)).toBe(MIN_HALF_EXTENT_M);
  });

  it("clamps above the maximum", () => {
    expect(clampHalfExtent(999_999)).toBe(MAX_HALF_EXTENT_M);
  });

  it("passes through an in-range value", () => {
    expect(clampHalfExtent(100)).toBe(100);
  });
});

describe("zoomView", () => {
  const view = { center: { x: 0, z: 0 }, halfExtent: 100 };

  it("zooms out around center when the anchor is the center itself", () => {
    const next = zoomView(view, 2, view.center);
    expect(next.halfExtent).toBe(200);
    expect(next.center).toEqual({ x: 0, z: 0 });
  });

  it("zooms in around center", () => {
    const next = zoomView(view, 0.5, view.center);
    expect(next.halfExtent).toBe(50);
    expect(next.center).toEqual({ x: 0, z: 0 });
  });

  it("keeps the anchor point fixed under the cursor when zooming off-center", () => {
    const anchor = { x: 50, z: 0 };
    const next = zoomView(view, 0.5, anchor);
    // Anchor was halfway from center to the edge; after zooming in 2x the
    // same world point should still sit halfway from the new center.
    expect(next.center.x).toBeCloseTo(25);
    expect(next.halfExtent).toBe(50);
  });

  it("clamps the resulting extent", () => {
    const next = zoomView(view, 1000, view.center);
    expect(next.halfExtent).toBe(MAX_HALF_EXTENT_M);
  });
});

describe("panView", () => {
  it("translates the center by the given delta, leaving extent unchanged", () => {
    const view = { center: { x: 10, z: -5 }, halfExtent: 100 };
    expect(panView(view, 5, 5)).toEqual({ center: { x: 15, z: 0 }, halfExtent: 100 });
  });
});

describe("orthographicFrustum", () => {
  it("produces a square frustum at aspect 1", () => {
    const view = { center: { x: 0, z: 0 }, halfExtent: 100 };
    expect(orthographicFrustum(view, 1)).toEqual({
      left: -100,
      right: 100,
      top: 100,
      bottom: -100,
    });
  });

  it("widens left/right for a landscape canvas, keeping halfExtent as the vertical half", () => {
    const view = { center: { x: 0, z: 0 }, halfExtent: 100 };
    const frustum = orthographicFrustum(view, 2);
    expect(frustum.top).toBe(100);
    expect(frustum.bottom).toBe(-100);
    expect(frustum.right).toBe(200);
    expect(frustum.left).toBe(-200);
  });

  it("widens top/bottom for a portrait canvas, keeping halfExtent as the horizontal half", () => {
    const view = { center: { x: 0, z: 0 }, halfExtent: 100 };
    const frustum = orthographicFrustum(view, 0.5);
    expect(frustum.left).toBe(-100);
    expect(frustum.right).toBe(100);
    expect(frustum.top).toBe(200);
    expect(frustum.bottom).toBe(-200);
  });

  it("offsets the frustum by a non-origin center", () => {
    const view = { center: { x: 10, z: 20 }, halfExtent: 5 };
    expect(orthographicFrustum(view, 1)).toEqual({ left: 5, right: 15, top: 25, bottom: 15 });
  });
});

describe("fitView", () => {
  it("falls back to a default view when there is nothing to frame", () => {
    expect(fitView([])).toEqual({ center: { x: 0, z: 0 }, halfExtent: 200 });
  });

  it("centers on the bounding box of the given points", () => {
    const view = fitView([
      { x: 0, z: 0 },
      { x: 100, z: 50 },
    ]);
    expect(view.center).toEqual({ x: 50, z: 25 });
  });

  it("pads the framed extent beyond the tight bounding box", () => {
    const view = fitView([
      { x: -50, z: 0 },
      { x: 50, z: 0 },
    ]);
    // Tight half-span is 50; default 20% padding takes it to 60.
    expect(view.halfExtent).toBeCloseTo(60);
  });

  it("gives a single point a sensible default extent rather than zero", () => {
    const view = fitView([{ x: 10, z: 10 }]);
    expect(view.center).toEqual({ x: 10, z: 10 });
    expect(view.halfExtent).toBeGreaterThan(0);
  });

  it("clamps the fitted extent to the configured bounds", () => {
    const view = fitView([
      { x: -1_000_000, z: 0 },
      { x: 1_000_000, z: 0 },
    ]);
    expect(view.halfExtent).toBe(MAX_HALF_EXTENT_M);
  });
});
