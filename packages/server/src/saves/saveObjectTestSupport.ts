import type { SaveObjectView } from "./extractBaseline.ts";

/**
 * Builders for the handful of save objects the baseline extractor reads.
 *
 * A parsed save is 180,000 objects of deeply nested property structs; these
 * builders reproduce just the shapes that matter, in the same
 * `{ type, value }` / `{ type, values }` form the parser emits, so extraction
 * rules can be tested against known contents without a real 11 MB save.
 *
 * Test-only helper — excluded from the production build (see tsconfig.json).
 */

const LEVEL = "Persistent_Level:PersistentLevel";

function objectProperty(pathName: string): unknown {
  return { type: "ObjectProperty", value: { levelName: "", pathName } };
}

function floatProperty(value: number): unknown {
  return { type: "FloatProperty", value };
}

/** A plain buildable, identified only by its class — a generator, a pole, a wall. */
export function worldObject(instance: string, className: string): SaveObjectView {
  return {
    typePath: `/Game/FactoryGame/Buildable/Factory/${className}.${className}`,
    instanceName: `${LEVEL}.${instance}`,
    properties: {},
  };
}

/** A power circuit and the power connections wired into it. */
export function circuit(circuitId: number, connectedInstances: string[]): SaveObjectView {
  return {
    typePath: "/Script/FactoryGame.FGPowerCircuit",
    instanceName: `${LEVEL}.CircuitSubsystem.FGPowerCircuit_${circuitId}`,
    properties: {
      mCircuitID: { type: "IntProperty", value: circuitId },
      mComponents: {
        type: "ArrayProperty",
        values: connectedInstances.map((instance) => ({
          levelName: "Persistent_Level",
          pathName: `${LEVEL}.${instance}.PowerConnection`,
        })),
      },
    },
  };
}

/** A power storage bank holding `storedMWh` of its rated 100 MWh. */
export function powerStorage(instance: string, storedMWh: number): SaveObjectView {
  return {
    typePath:
      "/Game/FactoryGame/Buildable/Factory/PowerStorage/Build_PowerStorageMk1.Build_PowerStorageMk1_C",
    instanceName: `${LEVEL}.${instance}`,
    properties: { mPowerStore: floatProperty(storedMWh) },
  };
}

/** A storage container pointing at the inventory component that holds its items. */
export function storageContainer(
  instance: string,
  inventoryInstance: string,
  location?: { x: number; y: number; z: number },
): SaveObjectView {
  return {
    typePath:
      "/Game/FactoryGame/Buildable/Factory/StorageContainerMk1/Build_StorageContainerMk1.Build_StorageContainerMk1_C",
    instanceName: `${LEVEL}.${instance}`,
    properties: { mStorageInventory: objectProperty(`${LEVEL}.${inventoryInstance}`) },
    transform: location ? { translation: location } : undefined,
  };
}

/**
 * A crate — the same actor class the game uses for both dismantle piles and
 * death crates, distinguished only by `mCrateType`. The inventory reference
 * (`inventoryInstance`) travels via `components`, not a `properties` field:
 * unlike a building's `mStorageInventory`, `AFGCrate.mInventory` carries no
 * `SaveGame` flag, so the save's own component list is the only way to find
 * it (mirrors how the real save format attaches it).
 */
export function crate(
  instance: string,
  type: "Death" | "Dismantle",
  location: { x: number; y: number; z: number },
  inventoryInstance?: string,
): SaveObjectView {
  return {
    typePath: "/Game/FactoryGame/-Shared/Crate/BP_Crate.BP_Crate_C",
    instanceName: `${LEVEL}.${instance}`,
    properties: {
      mCrateType: {
        type: "EnumProperty",
        value: {
          name: "EFGCrateType",
          value: type === "Death" ? "CT_DeathCrate" : "CT_DismantleCrate",
        },
      },
    },
    transform: { translation: location },
    components: inventoryInstance ? [{ pathName: `${LEVEL}.${inventoryInstance}` }] : [],
  };
}

/** The AWESOME Sink subsystem, holding accrued points and printed coupons.
 *  `mTotalPoints` is a `TArray<int64>` indexed by track (0 = the default
 *  resource sink, the only one v1 surfaces); the parser reads Int64Property
 *  array elements as raw numeric strings, not `{ type, value }` objects. */
export function resourceSink(totalPoints: number, numCoupons: number): SaveObjectView {
  return {
    typePath: "/Script/FactoryGame.FGResourceSinkSubsystem",
    instanceName: `${LEVEL}.ResourceSinkSubsystem`,
    properties: {
      mTotalPoints: { type: "ArrayProperty", values: [String(totalPoints)] },
      mNumResourceSinkCoupons: { type: "IntProperty", value: numCoupons },
    },
  };
}

export interface ItemStack {
  className: string;
  count: number;
}

/** An inventory component holding the given stacks. */
export function inventory(instance: string, stacks: ItemStack[]): SaveObjectView {
  return {
    typePath: "/Script/FactoryGame.FGInventoryComponent",
    instanceName: `${LEVEL}.${instance}`,
    properties: {
      mInventoryStacks: {
        type: "ArrayProperty",
        values: stacks.map((stack) => ({
          type: "InventoryStack",
          properties: {
            Item: {
              type: "StructProperty",
              value: {
                itemReference: { levelName: "", pathName: itemPath(stack.className) },
              },
            },
            NumItems: { type: "IntProperty", value: stack.count },
          },
        })),
      },
    },
  };
}

/** The dimensional depot's central store. */
export function centralStorage(items: ItemStack[]): SaveObjectView {
  return {
    typePath: "/Script/FactoryGame.FGCentralStorageSubsystem",
    instanceName: `${LEVEL}.CentralStorageSubsystem`,
    properties: {
      mStoredItems: {
        type: "ArrayProperty",
        values: items.map((item) => ({
          type: "ItemAmount",
          properties: {
            ItemClass: objectProperty(itemPath(item.className)),
            amount: { type: "IntProperty", value: item.count },
          },
        })),
      },
    },
  };
}

/** A manufacturer set to a recipe, optionally overclocked and/or placed at a
 *  world location — `yawDegrees` (rendered into the same rotation quaternion
 *  shape the real parser emits) exercises the map builder's yaw extraction. */
export function machine(
  instance: string,
  recipeClassName: string | null,
  options: {
    potential?: number;
    location?: { x: number; y: number; z: number };
    yawDegrees?: number;
  } = {},
): SaveObjectView {
  const className = instance.replace(/_\d+$/, "");
  const properties: Record<string, unknown> = {};
  if (recipeClassName !== null) {
    properties.mCurrentRecipe = objectProperty(recipePath(recipeClassName));
  }
  if (options.potential !== undefined) {
    properties.mCurrentPotential = floatProperty(options.potential);
  }
  return {
    typePath: `/Game/FactoryGame/Buildable/Factory/ConstructorMk1/${className.slice(0, -2)}.${className}`,
    instanceName: `${LEVEL}.${instance}`,
    properties,
    transform: options.location
      ? {
          translation: options.location,
          rotation:
            options.yawDegrees !== undefined ? quaternionFromYaw(options.yawDegrees) : undefined,
        }
      : undefined,
  };
}

/** The inverse of `objectYawDegrees`'s quaternion-to-yaw formula, for test
 *  fixtures: a pure yaw rotation about the vertical axis as a quaternion. */
function quaternionFromYaw(yawDegrees: number): { x: number; y: number; z: number; w: number } {
  const halfRadians = (yawDegrees * Math.PI) / 180 / 2;
  return { x: 0, y: 0, z: Math.sin(halfRadians), w: Math.cos(halfRadians) };
}

/** One entry of `mPaidOffSchematic`: what has been submitted so far toward a
 *  schematic's cost. */
export interface SchematicPayOff {
  schematic: string;
  items: ItemStack[];
}

/**
 * The schematic manager, which records the active/last-worked-on milestone
 * and, per schematic, how much of its cost has been paid off so far
 * (`mPaidOffSchematic` — the save's own record of partial HUB submissions).
 */
export function schematicManager(options: {
  activeSchematic?: string;
  lastActiveSchematic?: string;
  paidOff?: SchematicPayOff[];
  purchased?: string[];
}): SaveObjectView {
  const properties: Record<string, unknown> = {};
  if (options.activeSchematic !== undefined) {
    properties.mActiveSchematic = objectProperty(options.activeSchematic);
  }
  if (options.lastActiveSchematic !== undefined) {
    properties.mLastActiveSchematic = objectProperty(options.lastActiveSchematic);
  }
  if (options.purchased && options.purchased.length > 0) {
    properties.mPurchasedSchematics = {
      type: "ArrayProperty",
      values: options.purchased.map((path) => ({ levelName: "", pathName: path })),
    };
  }
  if (options.paidOff && options.paidOff.length > 0) {
    properties.mPaidOffSchematic = {
      type: "ArrayProperty",
      values: options.paidOff.map((payOff) => ({
        type: "SchematicCost",
        properties: {
          Schematic: objectProperty(payOff.schematic),
          ItemCost: {
            type: "ArrayProperty",
            values: payOff.items.map((item) => ({
              type: "ItemAmount",
              properties: {
                ItemClass: objectProperty(itemPath(item.className)),
                amount: { type: "IntProperty", value: item.count },
              },
            })),
          },
        },
      })),
    };
  }
  return {
    typePath: "/Game/FactoryGame/Schematics/Progression/BP_SchematicManager.BP_SchematicManager_C",
    instanceName: `${LEVEL}.schematicManager`,
    properties,
  };
}

/** The game phase manager, which records the Space Elevator phase. */
export function gamePhaseManager(currentPhasePath: string): SaveObjectView {
  return {
    typePath: "/Game/FactoryGame/Schematics/Progression/BP_GamePhaseManager.BP_GamePhaseManager_C",
    instanceName: `${LEVEL}.GamePhaseManager`,
    properties: { mCurrentGamePhase: objectProperty(currentPhasePath) },
  };
}

/** One entry of `mSavedOngoingResearch`: a MAM research in flight, and how
 *  many seconds are left — a save stores the remaining time directly, not an
 *  absolute completion timestamp. Omitting `secondsRemaining` models a save
 *  version that doesn't record the field at all. */
export interface OngoingResearch {
  schematic: string;
  secondsRemaining?: number;
}

/**
 * The research manager, which records in-flight MAM research
 * (`mSavedOngoingResearch`) and hard drive analyses whose reward candidates
 * have been generated but not yet claimed (`mUnclaimedHardDriveData` — per
 * Coffee Stain's own header, "the stored hard drives that we have
 * researched"; a post-research queue, not drives awaiting research).
 */
export function researchManager(options: {
  ongoing?: OngoingResearch[];
  unclaimedHardDriveCount?: number;
}): SaveObjectView {
  const properties: Record<string, unknown> = {};
  if (options.ongoing && options.ongoing.length > 0) {
    properties.mSavedOngoingResearch = {
      type: "ArrayProperty",
      values: options.ongoing.map((entry) => ({
        type: "ResearchTime",
        properties: {
          ResearchData: {
            type: "StructProperty",
            value: {
              type: "ResearchData",
              properties: { Schematic: objectProperty(entry.schematic) },
            },
          },
          ...(entry.secondsRemaining !== undefined
            ? { ResearchCompleteTimestamp: floatProperty(entry.secondsRemaining) }
            : {}),
        },
      })),
    };
  }
  if (options.unclaimedHardDriveCount) {
    properties.mUnclaimedHardDriveData = {
      type: "ArrayProperty",
      values: Array.from({ length: options.unclaimedHardDriveCount }, (_, index) => ({
        type: "HardDriveData",
        properties: { HardDriveID: { type: "IntProperty", value: index } },
      })),
    };
  }
  return {
    typePath: "/Game/FactoryGame/Recipes/Research/BP_ResearchManager.BP_ResearchManager_C",
    instanceName: `${LEVEL}.ResearchManager`,
    properties,
  };
}

function itemPath(className: string): string {
  return `/Game/FactoryGame/Resource/Parts/X/${className.slice(0, -2)}.${className}`;
}

function recipePath(className: string): string {
  return `/Game/FactoryGame/Recipes/Constructor/${className.slice(0, -2)}.${className}`;
}
