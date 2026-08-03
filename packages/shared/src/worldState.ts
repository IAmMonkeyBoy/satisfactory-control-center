/**
 * The WorldState contract — the single canonical in-memory snapshot of the game,
 * merged from all ingestors and pushed to the dashboard.
 *
 * Defined as Zod schemas with the TypeScript types derived via `z.infer`, so the
 * runtime shape and the compile-time type can never drift apart. This matters
 * because WorldState is the untrusted transport boundary: every payload the
 * dashboard receives — and, in later slices, every payload parsed from a save or
 * the FRM feed — is validated against these schemas before anything trusts it.
 *
 * Build 1 (this slice) carries dummy data over the real transport. The domain
 * payloads below are intentionally minimal but shaped so later slices flesh them
 * out without changing the envelope: every domain is wrapped in {@link Domain},
 * which pins a per-domain {@link SourceAgeTag} so the UI can stay honest about
 * freshness (spec "Goals", CONTEXT.md "Source/age tag").
 */
import { z } from "zod";

/** Where a domain's data came from. */
export const sourceSchema = z.enum(["live", "baseline"]);
export type Source = z.infer<typeof sourceSchema>;

/**
 * Per-domain provenance and staleness, carried on every domain of WorldState.
 * `capturedAt` is epoch milliseconds at the moment the underlying source produced
 * the data; the UI derives displayed age from it against the current clock, so age
 * stays correct even if a snapshot sits in a buffer or the client reconnects.
 */
export const sourceAgeTagSchema = z.object({
  source: sourceSchema,
  capturedAt: z.number(),
});
export type SourceAgeTag = z.infer<typeof sourceAgeTagSchema>;

/**
 * A domain payload paired with its source/age tag. The generic interface is used
 * where the payload type varies (e.g. a UI component that renders any domain's
 * freshness); concrete domains in {@link worldStateSchema} are built with
 * {@link domainSchema} and validate structurally against this.
 */
export interface Domain<T> {
  tag: SourceAgeTag;
  data: T;
}

/** Build a schema for a domain wrapping the given payload schema. */
const domainSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ tag: sourceAgeTagSchema, data });

/**
 * Power domain — per-circuit production/consumption/capacity and battery state.
 *
 * Fields the live feed alone can answer are nullable, because a save file simply
 * does not record them: instantaneous production and draw, and the fuse flag, are
 * runtime state the game never serializes. A baseline therefore leaves them null
 * rather than reporting a fabricated zero, and the UI can say "unknown" honestly
 * until FRM fills them in. `capacityMW` (installed generator capacity) and
 * `batteryPercent` (stored MWh over capacity) are recoverable from a save, so they
 * stay non-null wherever the domain has any data at all.
 */
export const powerCircuitSchema = z.object({
  id: z.string(),
  productionMW: z.number().nullable(),
  consumptionMW: z.number().nullable(),
  capacityMW: z.number(),
  batteryPercent: z.number().nullable(),
  fuseTripped: z.boolean().nullable(),
});
export type PowerCircuit = z.infer<typeof powerCircuitSchema>;

export const powerStateSchema = z.object({ circuits: z.array(powerCircuitSchema) });
export type PowerState = z.infer<typeof powerStateSchema>;

/**
 * Production domain — per-item current vs. max rates. `currentPerMin` is null in a
 * baseline for the same reason as the live-only power fields: a save records which
 * recipe each machine is set to (hence a theoretical max) but not what it is
 * actually producing right now.
 */
export const productionItemSchema = z.object({
  className: z.string(),
  displayName: z.string(),
  currentPerMin: z.number().nullable(),
  maxPerMin: z.number(),
});
export type ProductionItem = z.infer<typeof productionItemSchema>;

export const productionStateSchema = z.object({ items: z.array(productionItemSchema) });
export type ProductionState = z.infer<typeof productionStateSchema>;

/** Storage domain — item totals across containers. */
export const storageItemSchema = z.object({
  className: z.string(),
  displayName: z.string(),
  count: z.number(),
});
export type StorageItem = z.infer<typeof storageItemSchema>;

export const storageStateSchema = z.object({ items: z.array(storageItemSchema) });
export type StorageState = z.infer<typeof storageStateSchema>;

/** Milestones domain — current HUB milestone summary. */
export const milestonesStateSchema = z.object({
  currentMilestone: z.string().nullable(),
  spaceElevatorPhase: z.string().nullable(),
});
export type MilestonesState = z.infer<typeof milestonesStateSchema>;

/**
 * The session WorldState currently describes (the following indicator's data).
 * `source`/`capturedAt` carry the same freshness meaning as a domain's tag, but
 * describe the session identity itself: `live` while the FRM session is the one
 * being followed, `baseline` when the newest save is (CONTEXT.md, "Followed
 * session"). Individual domains can still disagree — a save-only domain stays
 * `baseline`-tagged even while the session itself is followed live.
 */
export const followedSessionSchema = z.object({
  sessionName: z.string(),
  source: sourceSchema,
  capturedAt: z.number(),
});
export type FollowedSession = z.infer<typeof followedSessionSchema>;

/**
 * The canonical merged snapshot. `generatedAt` stamps when the server assembled
 * this WorldState (distinct from each domain's `capturedAt`, which tracks the
 * underlying source).
 *
 * `followedSession` is null before any ingestor has identified a session — the
 * state the dashboard is in at startup, and the state it returns to if the watched
 * directory holds no readable save.
 */
export const worldStateSchema = z.object({
  generatedAt: z.number(),
  followedSession: followedSessionSchema.nullable(),
  power: domainSchema(powerStateSchema),
  production: domainSchema(productionStateSchema),
  storage: domainSchema(storageStateSchema),
  milestones: domainSchema(milestonesStateSchema),
});
export type WorldState = z.infer<typeof worldStateSchema>;
