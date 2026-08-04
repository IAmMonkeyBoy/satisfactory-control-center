import { useEffect, useRef, type JSX } from "react";
import * as THREE from "three";
import type {
  MapBuilding,
  MapDeathCrate,
  MapFootprint,
  MapMover,
  MapSnapshot,
  MapTransform,
} from "@scc/shared";
import type { Alarm } from "../alarms/types";
import { ALARM_BADGE_COLOR, DEATH_CRATE_COLOR, buildingColor, moverColor } from "./mapStyle";
import {
  fitView,
  orthographicFrustum,
  panView,
  worldToScenePoint,
  zoomView,
  type MapView,
  type ScenePoint,
} from "./mapProjection";

/** Which of the four layers (spec, "Tier 1 map") are currently shown. */
export interface MapLayerVisibility {
  buildings: boolean;
  movers: boolean;
  deathCrates: boolean;
  alarms: boolean;
}

export interface MapSceneProps {
  mapSnapshot: MapSnapshot | null;
  /** Every active alarm; only those carrying a `location` contribute a badge
   *  (see `alarms/types.ts`'s doc comment on `Alarm.location`). */
  alarms: readonly Alarm[];
  layers: MapLayerVisibility;
}

/** Small fixed vertical offsets (scene metres) that stack the four layers
 *  above the ground grid without z-fighting. Not real elevation — Tier 1 is
 *  a top-down icon map, not an extrusion (that's Tier 2's job per ADR 0004);
 *  every entity in a layer sits at the same offset regardless of its actual
 *  world height. */
const LAYER_Y = { buildings: 0.05, deathCrates: 0.1, movers: 0.15, alarms: 0.2 };

/** The playable map spans roughly 7-8km per side (spec's Tier 1 map
 *  research) — sized generously so the grid still covers the view at the
 *  map's maximum zoom-out. */
const GRID_SIZE_M = 8000;
const GRID_DIVISIONS = 80;

const CAMERA_HEIGHT_M = 500;

const WHEEL_ZOOM_FACTOR = 1.1;

/** Laying every flat marker shape from its default XY orientation onto the
 *  ground (XZ) plane. */
const LAY_FLAT_TILT = -Math.PI / 2;

const buildingGeometry = new THREE.PlaneGeometry(1, 1);
const moverGeometry = triangleGeometry();
const deathCrateGeometry = diamondGeometry();
const alarmBadgeGeometry = new THREE.RingGeometry(0.35, 0.5, 24);

function triangleGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.5);
  shape.lineTo(-0.4, -0.5);
  shape.lineTo(0.4, -0.5);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function diamondGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.5);
  shape.lineTo(0.5, 0);
  shape.lineTo(0, -0.5);
  shape.lineTo(-0.5, 0);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/** One marker: an outer `Group` carrying position + yaw (rotation about the
 *  world-vertical axis, applied before any tilt so it behaves as expected),
 *  wrapping an inner `Mesh` tilted flat onto the ground plane. Splitting the
 *  two avoids composing a single Euler rotation from a tilt and a yaw around
 *  different axes, which does not commute the way a naive `rotation.set`
 *  would suggest. */
function createMarker(geometry: THREE.BufferGeometry, color: string): THREE.Group {
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = LAY_FLAT_TILT;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

function markerMaterial(group: THREE.Group): THREE.MeshBasicMaterial {
  return (group.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
}

function disposeMarker(group: THREE.Group): void {
  markerMaterial(group).dispose();
}

/** Sync one layer's group of markers against the latest entities: update
 *  existing markers in place, create new ones, and remove/dispose any whose
 *  id is no longer present — never a full teardown-and-rebuild per snapshot
 *  tick, so a marker that's still there doesn't flicker. */
function syncLayer<T>(
  group: THREE.Group,
  meshes: Map<string, THREE.Group>,
  geometry: THREE.BufferGeometry,
  items: readonly T[],
  idOf: (item: T) => string,
  colorOf: (item: T) => string,
  place: (marker: THREE.Group, item: T) => void,
): void {
  const seen = new Set<string>();
  for (const item of items) {
    const id = idOf(item);
    seen.add(id);
    let marker = meshes.get(id);
    if (!marker) {
      marker = createMarker(geometry, colorOf(item));
      meshes.set(id, marker);
      group.add(marker);
    } else {
      markerMaterial(marker).color.set(colorOf(item));
    }
    place(marker, item);
  }
  for (const [id, marker] of meshes) {
    if (seen.has(id)) continue;
    group.remove(marker);
    disposeMarker(marker);
    meshes.delete(id);
  }
}

/**
 * A marker's `scale` lands on the *group*, whose local axes are not the flat
 * shape's own X/Y anymore: the child mesh's `-90°` X tilt (see
 * {@link createMarker}) already rotated the shape's local Y into the group's
 * local **Z** before the group's own scale/rotation apply. So "width" scales
 * the group's X (untouched by that tilt) and "depth" must scale the group's
 * **Z**, not its Y — leaving Y at 1 (that axis collapses to 0 by the tilt
 * regardless of its scale). Getting this backwards doesn't error, it just
 * quietly squashes every marker into a thin sliver once rotated, which is
 * far easier to catch by eye in a running scene than by reading the code.
 */
function setFootprintScale(marker: THREE.Group, widthM: number, depthM: number): void {
  marker.scale.set(widthM, 1, depthM);
}

/** Shared placement for the two layers that carry a real `MapTransform` +
 *  `MapFootprint` — buildings and movers. Death crates and alarm badges have
 *  neither (a crate/alarm is just a point, with no rotation or size FRM
 *  reports), so they position themselves directly rather than going through
 *  this. `minScaleM` keeps a marker from shrinking to invisibility when its
 *  footprint is small relative to the map's scale. */
function placeOriented(
  marker: THREE.Group,
  transform: MapTransform,
  footprint: MapFootprint,
  layerY: number,
  minScaleM: number,
): void {
  const scene = worldToScenePoint(transform);
  marker.position.set(scene.x, layerY, scene.z);
  marker.rotation.y = -THREE.MathUtils.degToRad(transform.rotationDegrees);
  setFootprintScale(
    marker,
    Math.max(minScaleM, footprint.widthCm / 100),
    Math.max(minScaleM, footprint.depthCm / 100),
  );
}

function placeBuilding(marker: THREE.Group, building: MapBuilding): void {
  placeOriented(marker, building.transform, building.footprint, LAYER_Y.buildings, 0.5);
}

function placeMover(marker: THREE.Group, mover: MapMover): void {
  placeOriented(marker, mover.transform, mover.footprint, LAYER_Y.movers, 1);
}

function placeDeathCrate(marker: THREE.Group, crate: MapDeathCrate): void {
  placeOriented(marker, crate.transform, crate.footprint, LAYER_Y.deathCrates, 1);
}

function placeAlarmBadge(
  marker: THREE.Group,
  alarm: Alarm & { location: NonNullable<Alarm["location"]> },
): void {
  const scene = worldToScenePoint(alarm.location);
  marker.position.set(scene.x, LAYER_Y.alarms, scene.z);
  setFootprintScale(marker, 4, 4);
}

interface ThreeContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  groups: {
    buildings: THREE.Group;
    movers: THREE.Group;
    deathCrates: THREE.Group;
    alarms: THREE.Group;
  };
  meshes: {
    buildings: Map<string, THREE.Group>;
    movers: Map<string, THREE.Group>;
    deathCrates: Map<string, THREE.Group>;
    alarms: Map<string, THREE.Group>;
  };
  view: MapView;
  hasFit: boolean;
  render: () => void;
  applyView: () => void;
}

/**
 * `orthographicFrustum` already returns world-space-absolute bounds (offset
 * by `view.center` itself — see its own doc comment and `panView`/`zoomView`,
 * which both operate in that same absolute space). Three.js's
 * `OrthographicCamera.left/right/top/bottom` are camera-local, so panning by
 * *also* moving `camera.position` to `view.center` would double-apply the
 * translation: a world point at the view's own center would project to NDC
 * `-view.center / halfExtent` instead of `0`, drifting further off-screen
 * the farther the view pans from world the origin and the more you zoom in
 * (smaller `halfExtent` makes the same absolute error a larger fraction of
 * the view). The camera therefore stays fixed at a constant point straight
 * above the world origin forever; the frustum bounds alone carry the pan.
 */
const CAMERA_FIXED_POSITION = new THREE.Vector3(0, CAMERA_HEIGHT_M, 0);
const CAMERA_LOOK_TARGET = new THREE.Vector3(0, 0, 0);

export function applyViewToCamera(
  camera: THREE.OrthographicCamera,
  view: MapView,
  aspect: number,
): void {
  const frustum = orthographicFrustum(view, aspect);
  camera.left = frustum.left;
  camera.right = frustum.right;
  camera.up.set(0, 0, -1);
  camera.position.copy(CAMERA_FIXED_POSITION);
  camera.lookAt(CAMERA_LOOK_TARGET);
  // `orthographicFrustum`'s top/bottom describe scene Z directly (its own
  // convention, shared with panView/zoomView's abstract "scene space" — see
  // its doc comment): +Z is "top". A straight-down camera can't have both
  // local X == world X (needed for left/right to work, and already fixed
  // above) *and* local Y (its own top/bottom axis) == world +Z — a
  // right-handed frame looking straight down forces one of the two to
  // invert, and `up: (0,0,-1)` was chosen to keep X uninverted. So this
  // camera's local Y is world **-Z**, and top/bottom must be assigned
  // swapped-and-negated to compensate, or the view still centers under
  // `left`/`right` but drifts to the extreme top/bottom edge under
  // `top`/`bottom` instead (caught by `applyViewToCamera.test.ts`).
  camera.top = -frustum.bottom;
  camera.bottom = -frustum.top;
  camera.updateProjectionMatrix();
}

/**
 * The Tier 1 map: an orthographic top-down Three.js scene with pan/zoom and
 * four independently-toggleable layers (spec, "Tier 1 map"; ADR 0004 —
 * orthographic camera and a real 3D scene graph from day one, so the Tier 2
 * extruded-block upgrade is a camera/geometry change here, not a rewrite).
 *
 * All Three.js state lives in a single ref created once on mount; React
 * re-renders never touch the scene graph directly — only the data-sync and
 * layer-visibility effects below do, via {@link syncLayer} and group
 * `.visible` flags, so panning/zooming (which bypasses React state entirely
 * for per-frame smoothness) never fights a re-render.
 */
export function MapScene({ mapSnapshot, alarms, layers }: MapSceneProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<ThreeContext | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const grid = new THREE.GridHelper(GRID_SIZE_M, GRID_DIVISIONS, 0x3a3a36, 0x232320);
    scene.add(grid);

    const groups = {
      buildings: new THREE.Group(),
      movers: new THREE.Group(),
      deathCrates: new THREE.Group(),
      alarms: new THREE.Group(),
    };
    scene.add(groups.buildings, groups.movers, groups.deathCrates, groups.alarms);

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    const view: MapView = { center: { x: 0, z: 0 }, halfExtent: 200 };

    const context: ThreeContext = {
      renderer,
      scene,
      camera,
      groups,
      meshes: {
        buildings: new Map(),
        movers: new Map(),
        deathCrates: new Map(),
        alarms: new Map(),
      },
      view,
      hasFit: false,
      render: () => renderer.render(scene, camera),
      applyView: () => {
        const { width, height } = container.getBoundingClientRect();
        applyViewToCamera(camera, context.view, width / Math.max(1, height));
      },
    };
    contextRef.current = context;

    const resize = (): void => {
      const { width, height } = container.getBoundingClientRect();
      renderer.setSize(width, height);
      context.applyView();
      context.render();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    let dragging = false;
    let lastPointer = { x: 0, z: 0 };

    const onPointerDown = (event: PointerEvent): void => {
      dragging = true;
      lastPointer = { x: event.clientX, z: event.clientY };
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!dragging) return;
      const { width, height } = container.getBoundingClientRect();
      const aspect = width / Math.max(1, height);
      const frustum = orthographicFrustum(context.view, aspect);
      const metersPerPixelX = (frustum.right - frustum.left) / Math.max(1, width);
      const metersPerPixelZ = (frustum.top - frustum.bottom) / Math.max(1, height);
      const dxPixels = event.clientX - lastPointer.x;
      const dzPixels = event.clientY - lastPointer.z;
      lastPointer = { x: event.clientX, z: event.clientY };

      context.view = panView(context.view, -dxPixels * metersPerPixelX, dzPixels * metersPerPixelZ);
      context.applyView();
      context.render();
    };

    const stopDragging = (event: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      renderer.domElement.releasePointerCapture(event.pointerId);
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const { width, height, left, top } = container.getBoundingClientRect();
      const aspect = width / Math.max(1, height);
      const frustum = orthographicFrustum(context.view, aspect);
      const ndcX = ((event.clientX - left) / Math.max(1, width)) * 2 - 1;
      const ndcY = 1 - ((event.clientY - top) / Math.max(1, height)) * 2;
      const anchor: ScenePoint = {
        x: frustum.left + ((ndcX + 1) / 2) * (frustum.right - frustum.left),
        z: frustum.bottom + ((ndcY + 1) / 2) * (frustum.top - frustum.bottom),
      };
      const factor = event.deltaY > 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
      context.view = zoomView(context.view, factor, anchor);
      context.applyView();
      context.render();
    };

    const dom = renderer.domElement;
    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", stopDragging);
    dom.addEventListener("pointercancel", stopDragging);
    dom.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      resizeObserver.disconnect();
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", stopDragging);
      dom.removeEventListener("pointercancel", stopDragging);
      dom.removeEventListener("wheel", onWheel);
      for (const markers of Object.values(context.meshes)) {
        for (const marker of markers.values()) disposeMarker(marker);
      }
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      contextRef.current = null;
    };
  }, []);

  // Layer visibility: toggling never touches the entity data, just each
  // group's `.visible` flag, so switching a layer off and back on doesn't
  // lose or recreate any marker.
  useEffect(() => {
    const context = contextRef.current;
    if (!context) return;
    context.groups.buildings.visible = layers.buildings;
    context.groups.movers.visible = layers.movers;
    context.groups.deathCrates.visible = layers.deathCrates;
    context.groups.alarms.visible = layers.alarms;
    context.render();
  }, [layers]);

  // Data sync: diff every layer's entities against the scene graph, and
  // auto-fit the camera once, the first time any entity has arrived.
  useEffect(() => {
    const context = contextRef.current;
    if (!context) return;

    const buildings = mapSnapshot?.buildings.data ?? [];
    const movers = mapSnapshot?.movers.data ?? [];
    const deathCrates = mapSnapshot?.deathCrates.data ?? [];
    const locatedAlarms = alarms.filter(
      (alarm): alarm is Alarm & { location: NonNullable<Alarm["location"]> } =>
        alarm.location !== undefined,
    );

    syncLayer(
      context.groups.buildings,
      context.meshes.buildings,
      buildingGeometry,
      buildings,
      (b) => b.id,
      (b) => buildingColor(b.status),
      placeBuilding,
    );
    syncLayer(
      context.groups.movers,
      context.meshes.movers,
      moverGeometry,
      movers,
      (m) => m.id,
      (m) => moverColor(m.kind),
      placeMover,
    );
    syncLayer(
      context.groups.deathCrates,
      context.meshes.deathCrates,
      deathCrateGeometry,
      deathCrates,
      (c) => c.id,
      () => DEATH_CRATE_COLOR,
      placeDeathCrate,
    );
    syncLayer(
      context.groups.alarms,
      context.meshes.alarms,
      alarmBadgeGeometry,
      locatedAlarms,
      (a) => a.key,
      () => ALARM_BADGE_COLOR,
      placeAlarmBadge,
    );

    if (!context.hasFit) {
      const points: ScenePoint[] = [
        ...buildings.map((b) => worldToScenePoint(b.transform)),
        ...movers.map((m) => worldToScenePoint(m.transform)),
        ...deathCrates.map((c) => worldToScenePoint(c.transform)),
      ];
      if (points.length > 0) {
        context.view = fitView(points);
        context.hasFit = true;
        context.applyView();
      }
    }

    context.render();
  }, [mapSnapshot, alarms]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
