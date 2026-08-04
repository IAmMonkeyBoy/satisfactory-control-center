import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyViewToCamera } from "./MapScene";
import { worldToScenePoint, type MapView } from "./mapProjection";

/**
 * Regression test for a real bug caught in manual browser testing (PR #44
 * review): `orthographicFrustum` returns world-space-absolute bounds, but
 * `applyViewToCamera` used to *also* translate `camera.position` to
 * `view.center`, double-applying the pan. A world point at the view's own
 * center must always project to screen center (NDC `(0, 0)`), regardless of
 * how far that center sits from the world origin or how zoomed in the view
 * is — the earlier bug drifted further off-center the farther/closer either
 * of those got.
 */
function ndcOfSceneXZ(view: MapView, sceneX: number, sceneZ: number): { x: number; y: number } {
  const camera = new THREE.OrthographicCamera();
  applyViewToCamera(camera, view, 1);
  camera.updateMatrixWorld(true);

  const projected = new THREE.Vector3(sceneX, 0, sceneZ).project(camera);
  return { x: projected.x, y: projected.y };
}

/** A view centered on the scene-space projection of a world point far from
 *  the origin — mirrors how `fitView` derives a real view's center from
 *  `worldToScenePoint`, so `view.center` and the point-under-test are
 *  guaranteed to agree on units (scene metres) by construction. */
function centeredOn(worldCm: { x: number; y: number; z: number }, halfExtent: number): MapView {
  return { center: worldToScenePoint(worldCm), halfExtent };
}

describe("applyViewToCamera", () => {
  it("projects the view's own center to screen center when the view is at the world origin", () => {
    const view = centeredOn({ x: 0, y: 0, z: 0 }, 100);
    const ndc = ndcOfSceneXZ(view, view.center.x, view.center.z);
    expect(ndc.x).toBeCloseTo(0);
    expect(ndc.y).toBeCloseTo(0);
  });

  it("still projects the view's own center to screen center far from the world origin", () => {
    // FRM's real coordinates are routinely tens of thousands of centimetres
    // from the origin (e.g. x: -70700) — this is the case the bug broke.
    const view = centeredOn({ x: -70700, y: 25000, z: 0 }, 500);
    const ndc = ndcOfSceneXZ(view, view.center.x, view.center.z);
    expect(ndc.x).toBeCloseTo(0);
    expect(ndc.y).toBeCloseTo(0);
  });

  it("keeps the view centered when zoomed in far from the world origin", () => {
    // The old bug's error scaled with 1/halfExtent — zooming in on an
    // off-origin view made it worse, not better.
    const view = centeredOn({ x: -70700, y: 25000, z: 0 }, 5);
    const ndc = ndcOfSceneXZ(view, view.center.x, view.center.z);
    expect(ndc.x).toBeCloseTo(0);
    expect(ndc.y).toBeCloseTo(0);
  });

  it("places a point half-way to the view's edge at half the NDC range on X", () => {
    const view = centeredOn({ x: 100000, y: 100000, z: 0 }, 100);
    const ndc = ndcOfSceneXZ(view, view.center.x + 50, view.center.z);
    expect(ndc.x).toBeCloseTo(0.5);
  });

  it("places a point half-way to the view's edge at half the NDC range on Z too", () => {
    // Regression: left/right and top/bottom feed the camera through
    // different sign conventions (see applyViewToCamera's doc comment) —
    // this exercises the Z/top-bottom half independently of X/left-right.
    const view = centeredOn({ x: 100000, y: 100000, z: 0 }, 100);
    const ndc = ndcOfSceneXZ(view, view.center.x, view.center.z + 50);
    expect(Math.abs(ndc.y)).toBeCloseTo(0.5);
  });
});
