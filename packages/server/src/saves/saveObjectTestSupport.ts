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

/** A manufacturer set to a recipe, optionally overclocked. */
export function machine(
  instance: string,
  recipeClassName: string | null,
  options: { potential?: number } = {},
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
  };
}

/** The schematic manager, which records the last milestone worked on. */
export function schematicManager(lastActiveSchematicPath: string): SaveObjectView {
  return {
    typePath: "/Game/FactoryGame/Schematics/Progression/BP_SchematicManager.BP_SchematicManager_C",
    instanceName: `${LEVEL}.schematicManager`,
    properties: { mLastActiveSchematic: objectProperty(lastActiveSchematicPath) },
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

function itemPath(className: string): string {
  return `/Game/FactoryGame/Resource/Parts/X/${className.slice(0, -2)}.${className}`;
}

function recipePath(className: string): string {
  return `/Game/FactoryGame/Recipes/Constructor/${className.slice(0, -2)}.${className}`;
}
