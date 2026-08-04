import type { SourceAgeTag, WorldLocation } from "@scc/shared";

/** A world location as a compact coordinate triple, rounded — the panel
 *  points at a container or crate, not surveys it to the millimetre. */
export function formatLocation(location: WorldLocation): string {
  return `(${Math.round(location.x)}, ${Math.round(location.y)}, ${Math.round(location.z)})`;
}

/**
 * Whether a baseline has ever been captured for the followed session, given
 * an always-baseline domain's tag (e.g. `worldState.deathCrates.tag`).
 * `WorldStateStore` reports `capturedAt: 0` as its sentinel for "nothing
 * known yet" — this distinguishes that from a real save genuinely confirming
 * an empty domain, so the panel doesn't present "unknown" as "checked, and
 * there's nothing there."
 */
export function hasBaseline(tag: SourceAgeTag): boolean {
  return tag.capturedAt > 0;
}

/** AWESOME Sink points with thousands separators — these numbers get large. */
export function formatPoints(value: number): string {
  return value.toLocaleString();
}

export function formatCoupons(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "coupon" : "coupons"}`;
}
