import type { ProductionItem } from "@scc/shared";

/**
 * Item rows worth a ticker slot: anything with an installed maximum rate.
 * Both `mapProduction` and `extractProduction` already sort by rate
 * descending, so this only filters — a zero-max entry (FRM reporting a
 * theoretical rate of nothing) would just clutter the ticker.
 */
export function notableItems(items: readonly ProductionItem[]): ProductionItem[] {
  return items.filter((item) => item.maxPerMin > 0);
}

/** Items per minute, rounded for display — rates rarely need decimal precision
 *  at a glance. */
export function formatPerMin(value: number): string {
  return `${Math.round(value).toLocaleString()}/min`;
}
