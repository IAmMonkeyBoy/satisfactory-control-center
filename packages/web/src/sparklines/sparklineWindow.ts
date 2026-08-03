/**
 * The sparkline window: an in-memory ring buffer of recent time series behind
 * the dashboard sparklines (~30-60 min, CONTEXT.md "Sparkline window"). Nothing
 * persists to disk, and it is dropped and rebuilt whenever the followed session
 * changes — the same silent-full-reset rule WorldState itself follows (spec,
 * "Followed session and merge rules").
 *
 * Deliberately generic: it knows nothing about power or production, only
 * `{ t, v }` samples keyed by an opaque series id. Panel-specific code (see
 * `power/powerSparklineSamples.ts`) extracts samples from WorldState; this
 * module only accumulates and trims them.
 */

export interface SparklinePoint {
  /** Epoch milliseconds — the domain's own `capturedAt`, not wall-clock receipt time. */
  t: number;
  v: number;
}

export type SparklineSeries = readonly SparklinePoint[];
export type SparklineSeriesMap = ReadonlyMap<string, SparklineSeries>;

export interface SparklineWindowState {
  sessionName: string | null;
  series: SparklineSeriesMap;
}

/** 45 minutes — inside the spec's ~30-60 min range. */
export const SPARKLINE_WINDOW_MS = 45 * 60 * 1000;

export const emptySparklineWindow: SparklineWindowState = { sessionName: null, series: new Map() };

function appendPoint(existing: SparklineSeries, point: SparklinePoint): SparklineSeries {
  const last = existing[existing.length - 1];
  // A domain's capturedAt only advances when its source actually refreshes;
  // the server pushes on a fixed interval regardless, so most pushes repeat the
  // same capturedAt and must not add a flat run of duplicate points.
  if (last && last.t >= point.t) return existing;

  const cutoff = point.t - SPARKLINE_WINDOW_MS;
  const trimmed = existing.filter((p) => p.t >= cutoff);
  return [...trimmed, point];
}

/**
 * Fold one round of samples into the window. `sessionName` is compared against
 * the window's own record of the followed session: a change drops every prior
 * series before the new samples are applied, exactly like a WorldState reset.
 */
export function appendSamples(
  state: SparklineWindowState,
  sessionName: string | null,
  samples: ReadonlyMap<string, SparklinePoint>,
): SparklineWindowState {
  const base =
    sessionName === state.sessionName ? state.series : new Map<string, SparklineSeries>();
  const next = new Map(base);
  for (const [key, point] of samples) {
    next.set(key, appendPoint(next.get(key) ?? [], point));
  }
  return { sessionName, series: next };
}
