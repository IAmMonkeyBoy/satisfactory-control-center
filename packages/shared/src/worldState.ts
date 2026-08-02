/**
 * The WorldState contract — the single canonical in-memory snapshot of the game,
 * merged from all ingestors and pushed to the dashboard.
 *
 * Build 1 (this slice) carries dummy data over the real transport. The domain
 * payloads below are intentionally minimal but shaped so later slices flesh them
 * out without changing the envelope: every domain is wrapped in {@link Domain},
 * which pins a per-domain {@link SourceAgeTag} so the UI can stay honest about
 * freshness (spec "Goals", CONTEXT.md "Source/age tag").
 */

/** Where a domain's data came from. */
export type Source = "live" | "baseline";

/**
 * Per-domain provenance and staleness, carried on every domain of WorldState.
 * `capturedAt` is epoch milliseconds at the moment the underlying source produced
 * the data; the UI derives displayed age from it against the current clock, so age
 * stays correct even if a snapshot sits in a buffer or the client reconnects.
 */
export interface SourceAgeTag {
  source: Source;
  capturedAt: number;
}

/** A domain payload paired with its source/age tag. */
export interface Domain<T> {
  tag: SourceAgeTag;
  data: T;
}

/** The session WorldState currently describes (the following indicator's data). */
export interface FollowedSession {
  sessionName: string;
}

/** Power domain — per-circuit production/consumption/capacity and battery state. */
export interface PowerState {
  circuits: PowerCircuit[];
}

export interface PowerCircuit {
  id: string;
  productionMW: number;
  consumptionMW: number;
  capacityMW: number;
  batteryPercent: number | null;
  fuseTripped: boolean;
}

/** Production domain — per-item current vs. max rates. */
export interface ProductionState {
  items: ProductionItem[];
}

export interface ProductionItem {
  className: string;
  displayName: string;
  currentPerMin: number;
  maxPerMin: number;
}

/** Storage domain — item totals across containers. */
export interface StorageState {
  items: StorageItem[];
}

export interface StorageItem {
  className: string;
  displayName: string;
  count: number;
}

/** Milestones domain — current HUB milestone summary. */
export interface MilestonesState {
  currentMilestone: string;
  spaceElevatorPhase: string;
}

/**
 * The canonical merged snapshot. `generatedAt` stamps when the server assembled
 * this WorldState (distinct from each domain's `capturedAt`, which tracks the
 * underlying source).
 */
export interface WorldState {
  generatedAt: number;
  followedSession: FollowedSession;
  power: Domain<PowerState>;
  production: Domain<ProductionState>;
  storage: Domain<StorageState>;
  milestones: Domain<MilestonesState>;
}
