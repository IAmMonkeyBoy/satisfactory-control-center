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

/** Build a schema for a domain wrapping the given payload schema. Exported so
 *  other request/response payloads outside {@link worldStateSchema} itself
 *  (e.g. the map snapshot, ADR 0003: REST, not SSE) can carry the same
 *  source/age freshness contract without redeclaring its shape. */
export const domainSchema = <T extends z.ZodTypeAny>(data: T) =>
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

/**
 * Machine efficiency domain — per-building-class rollups (FRM `getFactory`).
 * `totalCount` is recoverable from a save (a machine with a recipe configured is
 * a machine, whether or not the game is running); `producingCount`, `idleCount`,
 * `pausedCount` and `averageEfficiencyPercent` are runtime state — whether a
 * machine is actually running, starved, or manually paused — that only the live
 * feed can answer, so a baseline reports them null rather than a fabricated
 * zero, mirroring the power domain's live-only fields.
 */
export const machineRollupSchema = z.object({
  className: z.string(),
  displayName: z.string(),
  totalCount: z.number(),
  producingCount: z.number().nullable(),
  idleCount: z.number().nullable(),
  pausedCount: z.number().nullable(),
  /** Average of FRM's per-machine `Productivity` (actual output vs. installed
   *  rate) across configured machines of this class; null wherever no live
   *  reading has ever covered this class. */
  averageEfficiencyPercent: z.number().nullable(),
});
export type MachineRollup = z.infer<typeof machineRollupSchema>;

export const machinesStateSchema = z.object({ machines: z.array(machineRollupSchema) });
export type MachinesState = z.infer<typeof machinesStateSchema>;

/** Storage domain — item totals across containers. */
export const storageItemSchema = z.object({
  className: z.string(),
  displayName: z.string(),
  count: z.number(),
});
export type StorageItem = z.infer<typeof storageItemSchema>;

export const storageStateSchema = z.object({ items: z.array(storageItemSchema) });
export type StorageState = z.infer<typeof storageStateSchema>;

/** A point in the game's world space, shared by anything the storage/inventory
 *  panel can locate — a container, a death crate. */
export const worldLocationSchema = z.object({ x: z.number(), y: z.number(), z: z.number() });
export type WorldLocation = z.infer<typeof worldLocationSchema>;

/**
 * A death crate: the items dropped where a player died, with contents and
 * location. Baseline-only always (spec, "Followed session and merge rules":
 * death-crate contents are a domain FRM doesn't expose in this build) — there
 * is no live variant to prefer, unlike every other domain here.
 */
export const deathCrateSchema = z.object({
  id: z.string(),
  location: worldLocationSchema,
  items: z.array(storageItemSchema),
});
export type DeathCrate = z.infer<typeof deathCrateSchema>;

export const deathCratesStateSchema = z.object({ crates: z.array(deathCrateSchema) });
export type DeathCratesState = z.infer<typeof deathCratesStateSchema>;

/**
 * AWESOME Sink domain — accumulated points and printed coupons. A save
 * records total points and coupons on hand, but not the point curve needed to
 * say how far into the next coupon that total sits, so
 * `pointsToNextCoupon`/`percentToNextCoupon` stay null until the live feed
 * (which computes them) fills them in — the same live-only-field pattern as
 * the power and machines domains.
 */
export const sinkStateSchema = z.object({
  totalPoints: z.number(),
  numCoupons: z.number(),
  pointsToNextCoupon: z.number().nullable(),
  percentToNextCoupon: z.number().nullable(),
});
export type SinkState = z.infer<typeof sinkStateSchema>;

/**
 * One ingredient of the currently active HUB milestone, with progress toward
 * its cost. `amount` is what has been paid off so far (a save tracks partial
 * milestone payment across sessions — submitting resources at the HUB
 * terminal persists even before the milestone completes); `targetAmount` is
 * the full cost, read from static data since a save only ever records what's
 * been paid, never the recipe-like total it's being paid against.
 */
export const milestoneIngredientSchema = z.object({
  className: z.string(),
  displayName: z.string(),
  amount: z.number(),
  targetAmount: z.number(),
});
export type MilestoneIngredient = z.infer<typeof milestoneIngredientSchema>;

/** The HUB milestone resources are currently being sold towards, with
 *  per-ingredient progress. */
export const currentMilestoneSchema = z.object({
  className: z.string(),
  displayName: z.string(),
  ingredients: z.array(milestoneIngredientSchema),
});
export type CurrentMilestone = z.infer<typeof currentMilestoneSchema>;

/**
 * One in-flight MAM research: the schematic being researched and how long
 * until it completes. `secondsRemaining` is null when a save doesn't carry a
 * timer for this entry (defensive — the field a save's version doesn't
 * expose stays honestly unknown rather than fabricated).
 */
export const activeResearchSchema = z.object({
  className: z.string(),
  displayName: z.string(),
  secondsRemaining: z.number().nullable(),
});
export type ActiveResearch = z.infer<typeof activeResearchSchema>;

/** The compact collectibles row: hard drive research results generated and
 *  waiting on the player to pick one (a hard drive's analysis finishes with
 *  a set of candidate alternate-recipe rewards; the save calls this set
 *  "unclaimed" until one is chosen — not a drive sitting uncollected), and
 *  alternate recipes already unlocked from past research. */
export const collectiblesStateSchema = z.object({
  hardDriveResultsAwaitingClaim: z.number(),
  alternateRecipesUnlocked: z.number(),
});
export type CollectiblesState = z.infer<typeof collectiblesStateSchema>;

/**
 * Milestones domain — current HUB milestone with ingredient progress, Space
 * Elevator phase, in-flight MAM research, and the compact collectibles/
 * session-stat row (spec, "Milestones summary"). Baseline-only: FRM exposes
 * no milestone/schematic/research endpoint in this build, so unlike power or
 * production there is no live variant to prefer — see
 * `worldStateStore.ts`'s doc comment. `playDurationSeconds` comes from the
 * save header rather than from any game object, so it stays null until the
 * store that reads the header stamps it on.
 */
export const milestonesStateSchema = z.object({
  currentMilestone: currentMilestoneSchema.nullable(),
  spaceElevatorPhase: z.string().nullable(),
  activeResearch: z.array(activeResearchSchema),
  collectibles: collectiblesStateSchema,
  playDurationSeconds: z.number().nullable(),
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
  machines: domainSchema(machinesStateSchema),
  storage: domainSchema(storageStateSchema),
  /** The dimensional depot's inventory — same shape as `storage`, kept as its
   *  own domain (rather than folded into `storage.items`) so the panel can
   *  show it as the distinct, spendable pool it is in-game. */
  depot: domainSchema(storageStateSchema),
  deathCrates: domainSchema(deathCratesStateSchema),
  sink: domainSchema(sinkStateSchema),
  milestones: domainSchema(milestonesStateSchema),
});
export type WorldState = z.infer<typeof worldStateSchema>;
