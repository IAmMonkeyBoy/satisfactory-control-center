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
import type { MilestonesState, PowerState, ProductionState, StorageState } from "@scc/shared";
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
}

/** The WorldState domains a save can speak to. */
export interface BaselineDomains {
  power: PowerState;
  production: ProductionState;
  storage: StorageState;
  milestones: MilestonesState;
}

/** Rated capacity of a power storage bank when the dump doesn't say otherwise. */
const DEFAULT_POWER_STORE_CAPACITY_MWH = 100;

/** The domains of a WorldState that knows nothing yet. */
export function emptyBaselineDomains(): BaselineDomains {
  return {
    power: { circuits: [] },
    production: { items: [] },
    storage: { items: [] },
    milestones: { currentMilestone: null, spaceElevatorPhase: null },
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
    storage: extractStorage(index, staticData),
    milestones: extractMilestones(index, staticData),
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

function extractMilestones(index: SaveIndex, staticData: StaticData): MilestonesState {
  const schematicManager = index.singleton("BP_SchematicManager_C");
  const lastSchematic = objectPath(schematicManager?.properties.mLastActiveSchematic);

  const phaseManager = index.singleton("BP_GamePhaseManager_C");
  const currentPhase = objectPath(phaseManager?.properties.mCurrentGamePhase);

  return {
    currentMilestone: lastSchematic
      ? (staticData.displayName(lastSchematic) ?? classNameFromPath(lastSchematic))
      : null,
    spaceElevatorPhase: currentPhase ? gamePhaseLabel(currentPhase) : null,
  };
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

function arrayValues(object: SaveObjectView, name: string): unknown[] {
  const values = asRecord(object.properties[name])?.values;
  return Array.isArray(values) ? values : [];
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
