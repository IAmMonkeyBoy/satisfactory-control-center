/**
 * The Tier 1 map's coordinate math — world (Unreal centimetres, the same
 * space `MapTransform`/`MapFootprint` carry) to scene space (metres, the
 * ground plane a top-down orthographic Three.js camera looks down onto),
 * plus the pan/zoom view state a pointer-driven camera controller needs.
 *
 * Kept free of Three.js itself (plain numbers in, plain numbers out) so the
 * projection and view-state math is unit-testable without a WebGL context;
 * `MapScene.tsx` is the only place that turns these numbers into an actual
 * camera and meshes.
 */

/** Unreal world units are centimetres; scene space is metres — small enough
 *  numbers for a sane camera frustum and mesh scale. */
const METERS_PER_CM = 0.01;

export function worldToSceneUnits(cm: number): number {
  return cm * METERS_PER_CM;
}

/** A point on the map's ground plane, in scene metres. Three.js's XZ plane
 *  (Y up) is the ground for a top-down camera; world `y` (north/south) maps
 *  to scene `z` so "up" on screen is a consistent compass direction, world
 *  `x` maps straight through to scene `x`. World `z` (elevation) plays no
 *  part here — Tier 1 stacks layers at fixed scene-Y offsets instead of
 *  real elevation (see `MapScene.tsx`'s layer-offset constants). */
export interface ScenePoint {
  x: number;
  z: number;
}

export function worldToScenePoint(world: { x: number; y: number; z: number }): ScenePoint {
  return { x: worldToSceneUnits(world.x), z: worldToSceneUnits(world.y) };
}

/** The pan/zoom camera state: an orthographic view centered on `center`,
 *  showing `halfExtent` scene metres in each direction from it (before
 *  aspect-ratio correction — see {@link orthographicFrustum}). */
export interface MapView {
  center: ScenePoint;
  halfExtent: number;
}

/** Zooming past these bounds stops being useful: closer than ~2m and every
 *  building overlaps the next; farther than ~8km and the whole map (spec's
 *  research: "~7-8km per side") is a handful of pixels. */
export const MIN_HALF_EXTENT_M = 2;
export const MAX_HALF_EXTENT_M = 4000;

export function clampHalfExtent(halfExtent: number): number {
  return Math.min(MAX_HALF_EXTENT_M, Math.max(MIN_HALF_EXTENT_M, halfExtent));
}

/** Zoom by `factor` (>1 zooms out, <1 zooms in) around `aroundPoint` — a
 *  scene-space point the zoom holds fixed (`MapScene.tsx`'s wheel handler
 *  passes the cursor's scene position; passing `view.center` instead gives a
 *  center-anchored zoom for any future non-cursor-driven caller). */
export function zoomView(view: MapView, factor: number, aroundPoint: ScenePoint): MapView {
  const nextHalfExtent = clampHalfExtent(view.halfExtent * factor);
  // How far `aroundPoint` sits from center, as a fraction of the view — that
  // fraction is preserved at the new extent so the same world point stays
  // under the cursor rather than the view re-centering on it.
  const actualFactor = nextHalfExtent / view.halfExtent;
  return {
    center: {
      x: aroundPoint.x + (view.center.x - aroundPoint.x) * actualFactor,
      z: aroundPoint.z + (view.center.z - aroundPoint.z) * actualFactor,
    },
    halfExtent: nextHalfExtent,
  };
}

/** Pan by a scene-space delta (e.g. a pointer-drag translated into scene
 *  units by the caller, using the current frustum's scale). */
export function panView(view: MapView, deltaX: number, deltaZ: number): MapView {
  return {
    center: { x: view.center.x + deltaX, z: view.center.z + deltaZ },
    halfExtent: view.halfExtent,
  };
}

/** The orthographic camera frustum for a view, corrected for the canvas's
 *  aspect ratio (`width / height`) so `halfExtent` always describes the
 *  *shorter* axis — a wide canvas shows more left-right than a square one
 *  would, never less top-to-bottom. */
export interface Frustum {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function orthographicFrustum(view: MapView, aspect: number): Frustum {
  const halfWidth = aspect >= 1 ? view.halfExtent * aspect : view.halfExtent;
  const halfHeight = aspect >= 1 ? view.halfExtent : view.halfExtent / aspect;
  return {
    left: view.center.x - halfWidth,
    right: view.center.x + halfWidth,
    top: view.center.z + halfHeight,
    bottom: view.center.z - halfHeight,
  };
}

/**
 * A view framing every given point with padding, or a default fallback view
 * when there is nothing to frame yet (an empty map before the first
 * snapshot loads). Used once, on the first snapshot with any entities, to
 * auto-fit the initial camera — after that the user is in control via pan/
 * zoom, so this is never called again for the same map session.
 */
export function fitView(points: readonly ScenePoint[], paddingRatio = 0.2): MapView {
  if (points.length === 0) return { center: { x: 0, z: 0 }, halfExtent: 200 };

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.z < minZ) minZ = point.z;
    if (point.z > maxZ) maxZ = point.z;
  }

  const center = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  const halfSpan = Math.max(maxX - minX, maxZ - minZ) / 2;
  const halfExtent = clampHalfExtent(halfSpan * (1 + paddingRatio) || MIN_HALF_EXTENT_M * 10);
  return { center, halfExtent };
}
