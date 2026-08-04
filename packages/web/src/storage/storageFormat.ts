import type { WorldLocation } from "@scc/shared";

/** A world location as a compact coordinate triple, rounded — the panel
 *  points at a container or crate, not surveys it to the millimetre. */
export function formatLocation(location: WorldLocation): string {
  return `(${Math.round(location.x)}, ${Math.round(location.y)}, ${Math.round(location.z)})`;
}

/** AWESOME Sink points with thousands separators — these numbers get large. */
export function formatPoints(value: number): string {
  return value.toLocaleString();
}

export function formatCoupons(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "coupon" : "coupons"}`;
}
