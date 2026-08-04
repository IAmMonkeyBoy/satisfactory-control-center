/**
 * The Tier 1 map's color vocabulary — building status and mover kind to a
 * hex color, kept as plain lookups (not Tailwind classes: Three.js materials
 * take raw color values, not CSS) so `MapScene.tsx` never hard-codes a color
 * inline. FICSIT-informed, original palette only (spec, "Licensing
 * constraints") — no extracted game UI colors.
 */
import type { BuildingStatus, MoverKind } from "@scc/shared";

/** Mirrors `index.css`'s `--color-alarm-critical` literal value — Canvas/
 *  Three.js materials can't resolve CSS custom properties, the same
 *  constraint `PowerPanel.tsx`'s sparkline colors already work around. */
const ALARM_CRITICAL = "#e0433f";

const BUILDING_COLOR: Record<BuildingStatus, string> = {
  running: "#3fb27f",
  idle: "#8a8a86",
  "no-power": ALARM_CRITICAL,
};

/** A building's baseline status is always null (spec: a save can't know
 *  running state) — a dim neutral distinct from the "idle" live reading, so
 *  a baseline-only map doesn't misreport every building as confirmed idle. */
const BUILDING_COLOR_UNKNOWN = "#4a4a47";

export function buildingColor(status: BuildingStatus | null): string {
  return status === null ? BUILDING_COLOR_UNKNOWN : BUILDING_COLOR[status];
}

const MOVER_COLOR: Record<MoverKind, string> = {
  player: "#f2a33c",
  vehicle: "#3987e5",
  train: "#b06fe0",
  drone: "#3fd0d0",
};

export function moverColor(kind: MoverKind): string {
  return MOVER_COLOR[kind];
}

/** Death-crate markers and alarm badges are single-purpose layers, not
 *  keyed by a domain enum, so they get one constant each rather than a
 *  lookup table. */
export const DEATH_CRATE_COLOR = "#c23fc2";
export const ALARM_BADGE_COLOR = ALARM_CRITICAL;
