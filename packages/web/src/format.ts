import type { SourceAgeTag } from "@scc/shared";

/** Human label for a domain's source. */
export function sourceLabel(source: SourceAgeTag["source"]): string {
  return source === "live" ? "FRM live" : "save";
}

/**
 * Render a value the current source cannot answer as an explicit dash rather than
 * a plausible-looking zero. A baseline knows a circuit's installed capacity but
 * never its instantaneous production, and the dashboard's whole freshness contract
 * rests on that difference being visible.
 */
export function optionalValue(value: number | null, render: (value: number) => string): string {
  return value === null ? "—" : render(value);
}

/** Coarse "how old is this data" string derived from a tag against the clock. */
export function ageLabel(tag: SourceAgeTag, now: number): string {
  const seconds = Math.max(0, Math.round((now - tag.capturedAt) / 1000));
  if (seconds < 5) return "now";
  if (seconds < 90) return `${seconds}s old`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} min old`;
}
