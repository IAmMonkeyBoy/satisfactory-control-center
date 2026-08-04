/**
 * Turning a parsed save into WorldState domains — the baseline.
 *
 * A save is a complete record of the world's *persistent* state, which is not the
 * same as its current state: it stores which recipe a machine is set to but not
 * what it is producing this second, and it stores which buildings share a power
 * circuit but nothing about the power flowing through it. So every figure below is
 * either something the save genuinely records (stored charge, container contents,
 * milestone progress) or something derivable from it plus the game's own static
 * data (installed generator capacity, theoretical maximum output). Anything that
 * exists only at runtime stays null for the live feed to fill in (ADR 0002).
 *
 * This runs inside the parser worker, and only its small result crosses back to
 * the main thread — never the parsed save itself.
 */
import type {
  DeathCratesState,
  MachinesState,
  MilestonesState,
  PowerState,
  ProductionState,
  SinkState,
  StorageItem,
  StorageState,
  WorldLocation,
} from "@scc/shared";
import { classNameFromPath, type StaticData } from "../staticData/staticData.ts";

/**
 * The slice of a parsed save object this extractor reads. Depending on the shape
 * rather than on the parser's classes keeps the extraction rules testable with
 * plain objects, and keeps the parser an implementation detail of the worker.
 */
export interface SaveObjectView {
  typePath: string;
  instanceName: string;
  properties: Record<string, unknown>;
  /** World placement, present on save *entities* (placed actors) but not on
   *  save *components* — undefined for those, and treated defensively as "no
   *  location" rather than thrown on. */
  transform?: { translation?: { x: number; y: number; z: number } };
  /** Attached components. Used to find a crate's inventory, which — unlike a
   *  building's `mStorageInventory` — isn't a `SaveGame`-flagged property, so
   *  it doesn't show up in `properties` the way a container's does. */
  components?: { pathName?: string }[];
}

/** One container's full contents and location — the search index behind the
 *  item-location search REST endpoint (spec: "full container inventories"),
 *  never pushed as part of WorldState (ADR 0003: request/response, not SSE). */
export interface ContainerInventory {
  id: string;
  displayName: string;
  location: WorldLocation;
  items: StorageItem[];
}

/** The WorldState domains a save can speak to. */
export interface BaselineDomains {
  power: PowerState;
  production: ProductionState;
  machines: MachinesState;
  storage: StorageState;
  depot: StorageState;
  deathCrates: DeathCratesState;
  sink: SinkState;
  milestones: MilestonesState;
  containers: ContainerInventory[];
}

/** Rated capacity of a power storage bank when the dump doesn't say otherwise. */
const DEFAULT_POWER_STORE_CAPACITY_MWH = 100;

/** `EResourceSinkTrack::RST_Default` — the main AWESOME Sink track, index 0 of
 *  `mTotalPoints`. `RST_Exploration` (index 1) has no v1 domain. */
const RESOURCE_SINK_DEFAULT_TRACK_INDEX = 0;

/** The domains of a WorldState that knows nothing yet. */
export function emptyBaselineDomains(): BaselineDomains {
  return {
    power: { circuits: [] },
    production: { items: [] },
    machines: { machines: [] },
    storage: { items: [] },
    depot: { items: [] },
    deathCrates: { crates: [] },
    sink: { totalPoints: 0, numCoupons: 0, pointsToNextCoupon: null, percentToNextCoupon: null },
    milestones: {
      currentMilestone: null,
      spaceElevatorPhase: null,
      activeResearch: [],
      collectibles: { hardDriveResultsAwaitingClaim: 0, alternateRecipesUnlocked: 0 },
      playDurationSeconds: null,
    },
    containers: [],
  };
}

export function extractBaseline(
  objects: Iterable<SaveObjectView>,
  staticData: StaticData,
): BaselineDomains {
  const index = new SaveIndex(objects);
  return {
    power: extractPower(index, staticData),
    production: extractProduction(index, staticData),
    machines: extractMachines(index, staticData),
    storage: extractStorage(index, staticData),
    depot: extractDepot(index, staticData),
    deathCrates: extractDeathCrates(index, staticData),
    sink: extractSink(index),
    milestones: extractMilestones(index, staticData),
    containers: extractContainers(index, staticData),
  };
}

/** The objects of a save, indexed the ways extraction needs to walk them. */
class SaveIndex {
  readonly all: SaveObjectView[] = [];
  private readonly byInstance = new Map<string, SaveObjectView>();

  constructor(objects: Iterable<SaveObjectView>) {
    for (const object of objects) {
      this.all.push(object);
      this.byInstance.set(object.instanceName, object);
    }
  }

  instance(instanceName: string): SaveObjectView | undefined {
    return this.byInstance.get(instanceName);
  }

  /** Objects whose class name (not full path) matches. */
  ofClass(className: string): SaveObjectView[] {
    return this.all.filter((object) => classNameFromPath(object.typePath) === className);
  }

  /** The first object whose class name matches, if the save holds one. */
  singleton(className: string): SaveObjectView | undefined {
    return this.all.find((object) => classNameFromPath(object.typePath) === className);
  }
}

function extractPower(index: SaveIndex, staticData: StaticData): PowerState {
  const circuits = index.ofClass("FGPowerCircuit").map((circuit) => {
    const id = numberProperty(circuit, "mCircuitID") ?? 0;

    let capacityMW = 0;
    let storedMWh = 0;
    let storageCapacityMWh = 0;

    for (const connection of arrayValues(circuit, "mComponents")) {
      const owner = index.instance(ownerInstanceOf(objectPath(connection) ?? ""));
      if (!owner) continue;

      const building = staticData.building(owner.typePath);
      capacityMW += building?.powerProductionMW ?? 0;

      const stored = numberProperty(owner, "mPowerStore");
      if (stored !== undefined) {
        storedMWh += stored;
        storageCapacityMWh += ratedStorageCapacity(staticData, owner.typePath);
      }
    }

    return {
      id: String(id),
      // Instantaneous flow and fuse state live only in the running game.
      productionMW: null,
      consumptionMW: null,
      capacityMW,
      batteryPercent:
        storageCapacityMWh > 0 ? Math.round((storedMWh / storageCapacityMWh) * 100) : null,
      fuseTripped: null,
    };
  });

  circuits.sort((a, b) => Number(a.id) - Number(b.id));
  return { circuits };
}

function extractProduction(index: SaveIndex, staticData: StaticData): ProductionState {
  const maxPerMin = new Map<string, number>();

  for (const object of index.all) {
    const recipePath = objectPath(object.properties.mCurrentRecipe);
    if (!recipePath) continue;

    const recipe = staticData.recipe(recipePath);
    if (!recipe) continue;

    // Overclocking raises a machine's ceiling proportionally.
    const potential = numberProperty(object, "mCurrentPotential") ?? 1;
    for (const product of recipe.products) {
      maxPerMin.set(
        product.className,
        (maxPerMin.get(product.className) ?? 0) + product.perMinute * potential,
      );
    }
  }

  const items = [...maxPerMin].map(([className, rate]) => ({
    className,
    displayName: staticData.displayName(className) ?? className,
    // What the factory is actually making right now is a live-feed question.
    currentPerMin: null,
    maxPerMin: round(rate),
  }));

  items.sort((a, b) => b.maxPerMin - a.maxPerMin || a.className.localeCompare(b.className));
  return { items };
}

/**
 * Machine rollups, counted per building class. A save records which machines
 * exist and which recipe each is set to — `totalCount` — but not whether one
 * is actually running, starved, or paused right now, so the running-state
 * split and the efficiency figure stay null for the live feed to fill in
 * (mirrors the power domain's live-only fields).
 */
function extractMachines(index: SaveIndex, staticData: StaticData): MachinesState {
  const totals = new Map<string, number>();

  for (const object of index.all) {
    if (!objectPath(object.properties.mCurrentRecipe)) continue;
    const className = classNameFromPath(object.typePath);
    totals.set(className, (totals.get(className) ?? 0) + 1);
  }

  const machines = [...totals].map(([className, totalCount]) => ({
    className,
    displayName: staticData.building(className)?.displayName ?? className,
    totalCount,
    producingCount: null,
    idleCount: null,
    pausedCount: null,
    averageEfficiencyPercent: null,
  }));

  machines.sort((a, b) => b.totalCount - a.totalCount || a.className.localeCompare(b.className));
  return { machines };
}

function extractStorage(index: SaveIndex, staticData: StaticData): StorageState {
  const counts = new Map<string, number>();

  // Only inventories a storage building points at count as storage; machine input
  // and output buffers are throughput in transit, not stock on hand.
  for (const object of index.all) {
    const inventoryPath = objectPath(object.properties.mStorageInventory);
    if (!inventoryPath) continue;

    const inventory = index.instance(inventoryPath);
    if (!inventory) continue;

    for (const stack of arrayValues(inventory, "mInventoryStacks")) {
      const itemPath = structField(stack, "Item")?.itemReference?.pathName;
      const count = structNumber(stack, "NumItems");
      if (itemPath === undefined || count === undefined || count <= 0) continue;
      addCount(counts, classNameFromPath(itemPath), count);
    }
  }

  // The dimensional depot is a subsystem rather than a building, but it is stock
  // Aaron can spend, so it belongs in the same totals.
  const depot = index.singleton("FGCentralStorageSubsystem");
  if (depot) {
    for (const entry of arrayValues(depot, "mStoredItems")) {
      const itemPath = objectPath(propertiesOf(entry)?.ItemClass);
      const count = structNumber(entry, "amount");
      if (itemPath === undefined || count === undefined || count <= 0) continue;
      addCount(counts, classNameFromPath(itemPath), count);
    }
  }

  const items = [...counts].map(([className, count]) => ({
    className,
    displayName: staticData.displayName(className) ?? className,
    count,
  }));

  items.sort((a, b) => b.count - a.count || a.className.localeCompare(b.className));
  return { items };
}

/**
 * Per-container detail for the item-location search index: unlike
 * {@link extractStorage}'s flat totals, every building keeps its own entry —
 * search needs to say *which* container holds an item, not just how many
 * exist in total. The dimensional depot is deliberately excluded: it has no
 * world location, and is shown as its own panel section instead (see
 * {@link extractDepot}), not as a search result.
 */
function extractContainers(index: SaveIndex, staticData: StaticData): ContainerInventory[] {
  const containers: ContainerInventory[] = [];

  for (const object of index.all) {
    const inventoryPath = objectPath(object.properties.mStorageInventory);
    if (!inventoryPath) continue;

    const location = objectLocation(object);
    if (!location) continue;

    const inventory = index.instance(inventoryPath);
    const items = inventory ? stacksToItems(inventory, staticData) : [];
    if (items.length === 0) continue;

    const className = classNameFromPath(object.typePath);
    containers.push({
      id: object.instanceName,
      displayName: staticData.building(className)?.displayName ?? className,
      location,
      items,
    });
  }

  containers.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
  return containers;
}

/** The dimensional depot's contents, as its own domain (distinct from
 *  {@link extractStorage}'s per-container totals) so the panel can show it as
 *  the single spendable pool it is in-game. */
function extractDepot(index: SaveIndex, staticData: StaticData): StorageState {
  const depot = index.singleton("FGCentralStorageSubsystem");
  if (!depot) return { items: [] };

  const counts = new Map<string, number>();
  for (const entry of arrayValues(depot, "mStoredItems")) {
    const itemPath = objectPath(propertiesOf(entry)?.ItemClass);
    const count = structNumber(entry, "amount");
    if (itemPath === undefined || count === undefined || count <= 0) continue;
    addCount(counts, classNameFromPath(itemPath), count);
  }

  const items = [...counts].map(([className, count]) => ({
    className,
    displayName: staticData.displayName(className) ?? className,
    count,
  }));
  items.sort((a, b) => b.count - a.count || a.className.localeCompare(b.className));
  return { items };
}

/**
 * Death crates — always baseline (spec, "Followed session and merge rules":
 * death-crate contents are a domain FRM doesn't expose in this build), so
 * there is no live counterpart to this extraction the way there is for power
 * or storage. Dismantle crates (the same `BP_Crate_C` class, spawned when a
 * player's inventory overflows a dismantle) are deliberately excluded — only
 * `CT_DeathCrate` counts as a death crate.
 */
function extractDeathCrates(index: SaveIndex, staticData: StaticData): DeathCratesState {
  const crates = index.ofClass("BP_Crate_C").flatMap((crateObject) => {
    const crateType = enumProperty(crateObject, "mCrateType");
    if (!crateType?.includes("DeathCrate")) return [];

    const location = objectLocation(crateObject);
    if (!location) return [];

    const inventory = crateInventory(crateObject, index);
    const items = inventory ? stacksToItems(inventory, staticData) : [];
    return [{ id: crateObject.instanceName, location, items }];
  });

  crates.sort((a, b) => a.id.localeCompare(b.id));
  return { crates };
}

/**
 * AWESOME Sink points and coupons. `pointsToNextCoupon`/`percentToNextCoupon`
 * need the game's internal point-level curve to derive, which a save does not
 * record, so they stay null for the live feed to fill in — the sink domain's
 * own version of the live-only-field pattern the power and machines domains
 * already follow.
 */
function extractSink(index: SaveIndex): SinkState {
  const subsystem = index.singleton("FGResourceSinkSubsystem");
  if (!subsystem) {
    return { totalPoints: 0, numCoupons: 0, pointsToNextCoupon: null, percentToNextCoupon: null };
  }

  const totalPoints =
    numericAt(arrayValues(subsystem, "mTotalPoints"), RESOURCE_SINK_DEFAULT_TRACK_INDEX) ?? 0;
  const numCoupons = numberProperty(subsystem, "mNumResourceSinkCoupons") ?? 0;

  return { totalPoints, numCoupons, pointsToNextCoupon: null, percentToNextCoupon: null };
}

/**
 * Milestones domain: current HUB milestone (with per-ingredient progress),
 * Space Elevator phase, in-flight MAM research, and the compact
 * collectibles row. `playDurationSeconds` is a header field, not a game
 * object, so it stays null here — `worldStateStore.ts` stamps it on from the
 * save header once this baseline is committed.
 */
function extractMilestones(index: SaveIndex, staticData: StaticData): MilestonesState {
  const schematicManager = index.singleton("BP_SchematicManager_C");
  const purchased = purchasedSchematicPaths(schematicManager);

  // `mActiveSchematic` is what resources are currently being sold towards
  // (so it's the one that advances as ingredients are submitted in-game).
  // `mLastActiveSchematic` is only a safe fallback for the gap between
  // completing one milestone and selecting the next, when the active slot
  // briefly empties — it is *not* transient once purchased, it just keeps
  // pointing at whatever was last worked on, so a completed milestone can
  // sit there indefinitely. Using it unconditionally would render that
  // already-finished milestone as "current" at 0% (its `mPaidOffSchematic`
  // entry is cleared on purchase), so it's only trusted here when it hasn't
  // actually been purchased yet.
  const lastActive = objectPath(schematicManager?.properties.mLastActiveSchematic);
  const activeSchematic =
    objectPath(schematicManager?.properties.mActiveSchematic) ??
    (lastActive !== undefined && !purchased.has(lastActive) ? lastActive : undefined);

  const phaseManager = index.singleton("BP_GamePhaseManager_C");
  const currentPhase = objectPath(phaseManager?.properties.mCurrentGamePhase);

  const researchManager = index.singleton("BP_ResearchManager_C");

  return {
    currentMilestone: activeSchematic
      ? currentMilestoneFor(activeSchematic, schematicManager, staticData)
      : null,
    spaceElevatorPhase: currentPhase ? gamePhaseLabel(currentPhase) : null,
    activeResearch: extractActiveResearch(researchManager, staticData),
    collectibles: extractCollectibles(researchManager, purchased, staticData),
    playDurationSeconds: null,
  };
}

/** The classes of every schematic the save records as purchased —
 *  `mPurchasedSchematics` — shared by the active-milestone fallback (a
 *  purchased schematic is never "current") and the collectibles row's
 *  alternate-recipe count. */
function purchasedSchematicPaths(schematicManager: SaveObjectView | undefined): Set<string> {
  const purchased = new Set<string>();
  if (!schematicManager) return purchased;

  for (const entry of arrayValues(schematicManager, "mPurchasedSchematics")) {
    const path = objectPath(entry);
    if (path !== undefined) purchased.add(path);
  }
  return purchased;
}

/** The active milestone's ingredients, each paired with how much of its cost
 *  has been paid off so far. The total cost comes from static data (a save
 *  only ever records what's been paid); an ingredient the dump doesn't cover
 *  is skipped rather than shown with a fabricated target. */
function currentMilestoneFor(
  schematicPath: string,
  schematicManager: SaveObjectView | undefined,
  staticData: StaticData,
): MilestonesState["currentMilestone"] {
  const className = classNameFromPath(schematicPath);
  const cost = staticData.schematic(schematicPath)?.cost ?? [];
  const paidOff = paidOffFor(schematicManager, schematicPath);

  return {
    className,
    displayName: staticData.displayName(schematicPath) ?? className,
    ingredients: cost.map((ingredient) => ({
      className: ingredient.className,
      displayName: staticData.displayName(ingredient.className) ?? ingredient.className,
      amount: paidOff.get(ingredient.className) ?? 0,
      targetAmount: ingredient.amount,
    })),
  };
}

/** How much of each item has been paid off toward one schematic, from the
 *  schematic manager's `mPaidOffSchematic` record of partial HUB
 *  submissions. */
function paidOffFor(
  schematicManager: SaveObjectView | undefined,
  schematicPath: string,
): Map<string, number> {
  const paidOff = new Map<string, number>();
  if (!schematicManager) return paidOff;

  for (const entry of arrayValues(schematicManager, "mPaidOffSchematic")) {
    if (objectPath(propertiesOf(entry)?.Schematic) !== schematicPath) continue;

    for (const item of arrayValuesOf(propertiesOf(entry), "ItemCost")) {
      const itemPath = objectPath(propertiesOf(item)?.ItemClass);
      const amount = structNumber(item, "amount");
      if (itemPath === undefined || amount === undefined) continue;
      addCount(paidOff, classNameFromPath(itemPath), amount);
    }
  }
  return paidOff;
}

/** In-flight MAM research, from the research manager's
 *  `mSavedOngoingResearch` — populated only while a research timer is
 *  actively counting down; empty once it completes and is claimed. */
function extractActiveResearch(
  researchManager: SaveObjectView | undefined,
  staticData: StaticData,
): MilestonesState["activeResearch"] {
  if (!researchManager) return [];

  const research: MilestonesState["activeResearch"] = [];
  for (const entry of arrayValues(researchManager, "mSavedOngoingResearch")) {
    const researchData = nestedStructProperties(entry, "ResearchData");
    const schematicPath = objectPath(researchData?.Schematic);
    if (!schematicPath) continue;

    const className = classNameFromPath(schematicPath);
    const remaining = structNumber(entry, "ResearchCompleteTimestamp");
    research.push({
      className,
      displayName: staticData.displayName(schematicPath) ?? className,
      // Saved as time remaining, not an absolute timestamp; clamp defensively
      // in case a claimed-but-not-yet-removed entry saved with time to spare.
      // A missing field (a save version that doesn't record it) stays
      // honestly null rather than reading as "0s left".
      secondsRemaining: remaining === undefined ? null : Math.max(0, remaining),
    });
  }
  return research;
}

/** The compact collectibles row: hard drive analyses that have finished
 *  generating reward candidates but haven't been claimed yet (`mUnclaimedHardDriveData` —
 *  Coffee Stain's own header calls this "the stored hard drives that we have
 *  researched"; despite the name it is a post-research queue, not drives
 *  waiting to be researched), and alternate recipes already unlocked.
 *  Neither needs per-map collectible-spawn knowledge, which v1 doesn't have
 *  (spec, "Reserved for v2").
 */
function extractCollectibles(
  researchManager: SaveObjectView | undefined,
  purchased: Set<string>,
  staticData: StaticData,
): MilestonesState["collectibles"] {
  const hardDriveResultsAwaitingClaim = researchManager
    ? arrayValues(researchManager, "mUnclaimedHardDriveData").length
    : 0;

  let alternateRecipesUnlocked = 0;
  for (const path of purchased) {
    if (staticData.schematic(path)?.type === "EST_Alternate") alternateRecipesUnlocked += 1;
  }

  return { hardDriveResultsAwaitingClaim, alternateRecipesUnlocked };
}

/**
 * Name a Space Elevator phase. Game phases are one of the few things the Docs
 * dump omits entirely, so the label comes from the class name
 * (`GP_Project_Assembly_Phase_3`) rather than from static data.
 */
function gamePhaseLabel(phasePath: string): string {
  const className = classNameFromPath(phasePath);
  const phaseNumber = /Phase_(\d+)/.exec(className)?.[1];
  return phaseNumber === undefined ? className : `Phase ${phaseNumber}`;
}

/**
 * A power connection is a component of the building that owns it
 * (`…Build_GeneratorCoal_C_1.PowerConnection`); the circuit lists connections, but
 * capacity and charge belong to the buildings behind them.
 */
function ownerInstanceOf(connectionPath: string): string {
  return connectionPath.slice(0, connectionPath.lastIndexOf("."));
}

function ratedStorageCapacity(staticData: StaticData, typePath: string): number {
  const rated = staticData.entry(typePath)?.fields.mPowerStoreCapacity;
  const parsed = typeof rated === "string" ? Number(rated) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POWER_STORE_CAPACITY_MWH;
}

function addCount(counts: Map<string, number>, className: string, count: number): void {
  counts.set(className, (counts.get(className) ?? 0) + count);
}

/** An inventory component's stacks, aggregated by item class and sorted the
 *  same way every other item list in this module is (count descending,
 *  className breaking ties). Shared by {@link extractContainers} and
 *  {@link extractDeathCrates}, which each read one inventory at a time rather
 *  than {@link extractStorage}'s cross-container totals. */
function stacksToItems(inventoryObject: SaveObjectView, staticData: StaticData): StorageItem[] {
  const counts = new Map<string, number>();
  for (const stack of arrayValues(inventoryObject, "mInventoryStacks")) {
    const itemPath = structField(stack, "Item")?.itemReference?.pathName;
    const count = structNumber(stack, "NumItems");
    if (itemPath === undefined || count === undefined || count <= 0) continue;
    addCount(counts, classNameFromPath(itemPath), count);
  }

  const items = [...counts].map(([className, count]) => ({
    className,
    displayName: staticData.displayName(className) ?? className,
    count,
  }));
  items.sort((a, b) => b.count - a.count || a.className.localeCompare(b.className));
  return items;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/* ---------------------------------------------------------------------------
 * Property readers.
 *
 * The parser emits every property as a tagged object — `{ type, value }` for
 * scalars and object references, `{ type, values }` for arrays, and structs whose
 * `properties` map nests the same shapes again. These readers pick values out of
 * that shape defensively: mods and game updates add and remove properties freely,
 * and a missing one must degrade to "unknown", never throw.
 * ------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function numberProperty(object: SaveObjectView, name: string): number | undefined {
  const value = asRecord(object.properties[name])?.value;
  return typeof value === "number" ? value : undefined;
}

/** The `pathName` of an ObjectProperty, which is how saves reference classes. */
function objectPath(property: unknown): string | undefined {
  const value = asRecord(asRecord(property)?.value);
  const pathName = value?.pathName ?? asRecord(property)?.pathName;
  return typeof pathName === "string" && pathName !== "" ? pathName : undefined;
}

/** An `ArrayProperty` field's raw elements, given the properties bag it lives
 *  in — shared by {@link arrayValues} (a save object's top-level properties)
 *  and callers reading an array-typed field nested inside a struct. */
function arrayValuesOf(properties: Record<string, unknown> | undefined, name: string): unknown[] {
  const values = asRecord(properties?.[name])?.values;
  return Array.isArray(values) ? values : [];
}

function arrayValues(object: SaveObjectView, name: string): unknown[] {
  return arrayValuesOf(object.properties, name);
}

function propertiesOf(struct: unknown): Record<string, unknown> | undefined {
  return asRecord(asRecord(struct)?.properties);
}

function structField(
  struct: unknown,
  name: string,
): { itemReference?: { pathName?: string } } | undefined {
  return asRecord(propertiesOf(struct)?.[name])?.value as
    { itemReference?: { pathName?: string } } | undefined;
}

function structNumber(struct: unknown, name: string): number | undefined {
  const value = asRecord(propertiesOf(struct)?.[name])?.value;
  return typeof value === "number" ? value : undefined;
}

/** A struct-typed *field*'s own nested properties bag. Unlike an array
 *  element (already a bare `{ type, properties }` struct, see
 *  {@link propertiesOf}), a struct-typed field is wrapped one layer deeper —
 *  `{ type: "StructProperty", value: { properties } }` — because it carries
 *  a property tag of its own the way an array element doesn't. */
function nestedStructProperties(
  struct: unknown,
  name: string,
): Record<string, unknown> | undefined {
  return propertiesOf(asRecord(propertiesOf(struct)?.[name])?.value);
}

/** An EnumProperty's raw value (`"CT_DeathCrate"`, possibly qualified as
 *  `"EFGCrateType::CT_DeathCrate"` depending on save version) — callers match
 *  on it with `.includes()` rather than equality so a qualifying prefix
 *  doesn't produce a false miss. */
function enumProperty(object: SaveObjectView, name: string): string | undefined {
  const value = asRecord(object.properties[name])?.value;
  const enumValue = asRecord(value)?.value;
  return typeof enumValue === "string" ? enumValue : undefined;
}

/** An entity's world location, or undefined for a component (which has none)
 *  or an entity the parser couldn't resolve a transform for. */
function objectLocation(object: SaveObjectView): WorldLocation | undefined {
  const translation = object.transform?.translation;
  if (!translation || typeof translation.x !== "number") return undefined;
  return { x: translation.x, y: translation.y, z: translation.z };
}

/**
 * A crate's inventory component. Unlike a building's `mStorageInventory`,
 * `AFGCrate.mInventory` carries no `SaveGame` flag, so it doesn't appear as a
 * `properties` reference the way a container's does — the save's own
 * component list is what actually attaches it. `properties.mInventory` is
 * still tried first, defensively, in case a future save version adds the
 * flag.
 */
function crateInventory(crateObject: SaveObjectView, index: SaveIndex): SaveObjectView | undefined {
  const direct = objectPath(crateObject.properties.mInventory);
  const viaProperty = direct ? index.instance(direct) : undefined;
  if (viaProperty) return viaProperty;

  for (const component of crateObject.components ?? []) {
    if (typeof component.pathName !== "string" || component.pathName === "") continue;
    const candidate = index.instance(component.pathName);
    if (candidate && asRecord(candidate.properties.mInventoryStacks)) return candidate;
  }
  return undefined;
}

/** The numeric value at `index` of a raw values array, tolerating Int64
 *  array elements (parsed as strings, not `{ type, value }` objects — see
 *  `resourceSink`'s doc comment in `saveObjectTestSupport.ts`). */
function numericAt(values: unknown[], index: number): number | undefined {
  const raw = values[index];
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && raw !== "") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
