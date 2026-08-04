/**
 * The Tier 1 map contract — a REST GET, not part of WorldState.
 *
 * Per ADR 0003 and spec ("Transport and API surface"), map payload snapshots
 * are request/response, not pushed over SSE with every WorldState snapshot:
 * movers update at live-feed cadence independently of the domains a client
 * may not even have the map layer open to see, so folding them into every
 * WorldState push would mean paying that bandwidth whether or not the map is
 * showing.
 *
 * Every entity ships as `class + transform + footprint` (spec, "Tier 1 map")
 * so the Tier 2 (2.5D extruded-blocks) upgrade is a camera/geometry change on
 * the same payload shape, not a renderer or payload swap (ADR 0004).
 */
import { z } from "zod";
import { domainSchema } from "./worldState.ts";

/**
 * World placement: `x`/`y`/`z` are Unreal world units (centimetres) — the
 * same space `WorldLocation` already uses for containers and death crates.
 * `rotationDegrees` is yaw around the vertical axis, 0-359, mirroring FRM's
 * own `location.rotation` field directly for live entities; baseline
 * entities derive an equivalent yaw from the save's transform quaternion.
 * Neither source claims compass accuracy against the other — both are only
 * ever used to orient a top-down icon, not to calibrate against true north.
 */
export const mapTransformSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  rotationDegrees: z.number(),
});
export type MapTransform = z.infer<typeof mapTransformSchema>;

/** Ground-plane footprint, in the same centimetre units as {@link MapTransform}
 *  — the Tier-2-ready half of the payload (ADR 0004: extrusion is a geometry
 *  change over this same footprint, not a new field). */
export const mapFootprintSchema = z.object({
  widthCm: z.number(),
  depthCm: z.number(),
});
export type MapFootprint = z.infer<typeof mapFootprintSchema>;

/**
 * A factory building's running state. Baseline can never know this — a save
 * records which recipe a machine is set to, not whether it is currently
 * producing, starved, or unpowered — so baseline buildings always carry
 * `status: null` (mirrors the power/machines domains' live-only fields);
 * only the live feed (FRM `getFactory`) can resolve one of the three values.
 */
export const buildingStatusSchema = z.enum(["running", "idle", "no-power"]);
export type BuildingStatus = z.infer<typeof buildingStatusSchema>;

/**
 * One factory building on the map. Scoped to the same population as the
 * WorldState `machines` domain — buildings with a configured recipe — so the
 * map's buildings layer is spatially exactly what the production/machines
 * panels already summarize in aggregate, not a broader "every buildable"
 * sweep (which would also pull in foundations, walls, belts, and every other
 * structural piece a save records).
 */
export const mapBuildingSchema = z.object({
  id: z.string(),
  className: z.string(),
  displayName: z.string(),
  transform: mapTransformSchema,
  footprint: mapFootprintSchema,
  status: buildingStatusSchema.nullable(),
});
export type MapBuilding = z.infer<typeof mapBuildingSchema>;

/** What kind of live mover an entity is — player, vehicle, train, or drone
 *  (spec, "Tier 1 map": "live movers (player, vehicle, train, drone)"). */
export const moverKindSchema = z.enum(["player", "vehicle", "train", "drone"]);
export type MoverKind = z.infer<typeof moverKindSchema>;

/**
 * A live mover on the map. Movers are inherently runtime state — a save can
 * only record where a player or vehicle happened to be at the moment of
 * saving, not where it is now — so unlike buildings, movers have no baseline
 * source at all: the movers domain is empty until the live feed supplies it,
 * the same live-only pattern the WorldState power/production domains use for
 * their runtime-only fields, just applied to a whole domain instead of one
 * field.
 */
export const mapMoverSchema = z.object({
  id: z.string(),
  kind: moverKindSchema,
  displayName: z.string(),
  transform: mapTransformSchema,
  footprint: mapFootprintSchema,
});
export type MapMover = z.infer<typeof mapMoverSchema>;

/**
 * The Tier 1 map's REST payload. Buildings and movers each carry their own
 * source/age tag (mirroring every WorldState domain) rather than one for the
 * whole snapshot: buildings can be baseline while movers are still empty
 * awaiting the first live push, the same independence WorldState's own
 * per-domain tags exist to make honest.
 */
export const mapSnapshotSchema = z.object({
  generatedAt: z.number(),
  buildings: domainSchema(z.array(mapBuildingSchema)),
  movers: domainSchema(z.array(mapMoverSchema)),
});
export type MapSnapshot = z.infer<typeof mapSnapshotSchema>;
