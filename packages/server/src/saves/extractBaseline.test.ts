import { describe, expect, it } from "vitest";
import { testStaticData } from "../staticData/staticDataTestSupport.ts";
import { extractBaseline, type SaveObjectView } from "./extractBaseline.ts";
import {
  centralStorage,
  circuit,
  crate,
  gamePhaseManager,
  inventory,
  machine,
  powerStorage,
  researchManager,
  resourceSink,
  schematicManager,
  storageContainer,
  worldObject,
} from "./saveObjectTestSupport.ts";

const staticData = testStaticData();

function baselineOf(objects: SaveObjectView[]) {
  return extractBaseline(objects, staticData);
}

describe("power baseline", () => {
  it("sums the installed generator capacity on each circuit", () => {
    const baseline = baselineOf([
      circuit(1, [
        "Build_GeneratorCoal_C_1",
        "Build_GeneratorCoal_C_2",
        "Build_ConstructorMk1_C_3",
      ]),
      worldObject("Build_GeneratorCoal_C_1", "Build_GeneratorCoal_C"),
      worldObject("Build_GeneratorCoal_C_2", "Build_GeneratorCoal_C"),
      worldObject("Build_ConstructorMk1_C_3", "Build_ConstructorMk1_C"),
    ]);

    // Two coal generators at 75 MW each; the constructor generates nothing.
    expect(baseline.power.circuits).toEqual([
      {
        id: "1",
        productionMW: null,
        consumptionMW: null,
        capacityMW: 150,
        batteryPercent: null,
        fuseTripped: null,
      },
    ]);
  });

  it("reports battery charge as a percentage of installed storage capacity", () => {
    const baseline = baselineOf([
      circuit(1, ["Build_PowerStorageMk1_C_1", "Build_PowerStorageMk1_C_2"]),
      powerStorage("Build_PowerStorageMk1_C_1", 100),
      powerStorage("Build_PowerStorageMk1_C_2", 20),
    ]);

    // 120 MWh stored across two 100 MWh banks.
    expect(baseline.power.circuits[0]?.batteryPercent).toBe(60);
  });

  it("leaves live-only figures unknown rather than reporting zero", () => {
    const baseline = baselineOf([
      circuit(1, ["Build_GeneratorCoal_C_1"]),
      worldObject("Build_GeneratorCoal_C_1", "Build_GeneratorCoal_C"),
    ]);

    const [only] = baseline.power.circuits;
    expect(only?.productionMW).toBeNull();
    expect(only?.consumptionMW).toBeNull();
    expect(only?.fuseTripped).toBeNull();
  });

  it("orders circuits by id so the panel does not reshuffle between saves", () => {
    const baseline = baselineOf([circuit(10, []), circuit(2, []), circuit(1, [])]);

    expect(baseline.power.circuits.map((c) => c.id)).toEqual(["1", "2", "10"]);
  });
});

describe("storage baseline", () => {
  it("totals an item across every storage container", () => {
    const baseline = baselineOf([
      storageContainer("Build_StorageContainerMk1_C_1", "inv-1"),
      inventory("inv-1", [
        { className: "Desc_IronPlate_C", count: 500 },
        { className: "Desc_IronPlate_C", count: 500 },
      ]),
      storageContainer("Build_StorageContainerMk1_C_2", "inv-2"),
      inventory("inv-2", [{ className: "Desc_IronPlate_C", count: 120 }]),
    ]);

    expect(baseline.storage.items).toEqual([
      { className: "Desc_IronPlate_C", displayName: "Iron Plate", count: 1120 },
    ]);
  });

  it("includes the dimensional depot's contents", () => {
    const baseline = baselineOf([centralStorage([{ className: "Desc_Cement_C", count: 2000 }])]);

    expect(baseline.storage.items).toEqual([
      { className: "Desc_Cement_C", displayName: "Concrete", count: 2000 },
    ]);
  });

  it("ignores machine buffers, which are throughput rather than storage", () => {
    const baseline = baselineOf([
      machine("Build_ConstructorMk1_C_1", "Recipe_IronPlate_C"),
      inventory("Build_ConstructorMk1_C_1.InputInventory", [
        { className: "Desc_IronIngot_C", count: 100 },
      ]),
    ]);

    expect(baseline.storage.items).toEqual([]);
  });

  it("falls back to the class name for an item the dump does not cover", () => {
    const baseline = baselineOf([
      storageContainer("Build_StorageContainerMk1_C_1", "inv-1"),
      inventory("inv-1", [{ className: "Desc_ModdedThing_C", count: 3 }]),
    ]);

    expect(baseline.storage.items).toEqual([
      { className: "Desc_ModdedThing_C", displayName: "Desc_ModdedThing_C", count: 3 },
    ]);
  });
});

describe("containers (search index)", () => {
  it("captures a container's id, location, and per-item contents", () => {
    const baseline = baselineOf([
      storageContainer("Build_StorageContainerMk1_C_1", "inv-1", { x: 100, y: 200, z: 5 }),
      inventory("inv-1", [{ className: "Desc_IronPlate_C", count: 42 }]),
    ]);

    expect(baseline.containers).toEqual([
      {
        id: `${"Persistent_Level:PersistentLevel"}.Build_StorageContainerMk1_C_1`,
        displayName: "Storage Container",
        location: { x: 100, y: 200, z: 5 },
        items: [{ className: "Desc_IronPlate_C", displayName: "Iron Plate", count: 42 }],
      },
    ]);
  });

  it("keeps containers separate rather than aggregating across them", () => {
    const baseline = baselineOf([
      storageContainer("Build_StorageContainerMk1_C_1", "inv-1", { x: 0, y: 0, z: 0 }),
      inventory("inv-1", [{ className: "Desc_IronPlate_C", count: 500 }]),
      storageContainer("Build_StorageContainerMk1_C_2", "inv-2", { x: 10, y: 0, z: 0 }),
      inventory("inv-2", [{ className: "Desc_IronPlate_C", count: 120 }]),
    ]);

    expect(baseline.containers).toHaveLength(2);
    expect(baseline.containers.map((c) => c.items[0]?.count)).toEqual([500, 120]);
  });

  it("omits a container with no transform, since search results need a location", () => {
    const baseline = baselineOf([
      { ...storageContainer("Build_StorageContainerMk1_C_1", "inv-1"), transform: undefined },
      inventory("inv-1", [{ className: "Desc_IronPlate_C", count: 42 }]),
    ]);

    expect(baseline.containers).toEqual([]);
  });

  it("omits an empty container", () => {
    const baseline = baselineOf([
      storageContainer("Build_StorageContainerMk1_C_1", "inv-1", { x: 0, y: 0, z: 0 }),
      inventory("inv-1", []),
    ]);

    expect(baseline.containers).toEqual([]);
  });

  it("excludes the dimensional depot from search results — it has no world location", () => {
    const baseline = baselineOf([centralStorage([{ className: "Desc_Cement_C", count: 2000 }])]);

    expect(baseline.containers).toEqual([]);
  });
});

describe("depot baseline", () => {
  it("reports the dimensional depot's contents on its own domain", () => {
    const baseline = baselineOf([centralStorage([{ className: "Desc_Cement_C", count: 2000 }])]);

    expect(baseline.depot.items).toEqual([
      { className: "Desc_Cement_C", displayName: "Concrete", count: 2000 },
    ]);
  });

  it("reports an empty depot when the save has none", () => {
    expect(baselineOf([]).depot.items).toEqual([]);
  });
});

describe("death crates baseline", () => {
  it("includes a death crate's location and contents", () => {
    const baseline = baselineOf([
      crate("Crate_1", "Death", { x: 50, y: 60, z: 70 }, "crate-inv-1"),
      inventory("crate-inv-1", [{ className: "Desc_IronPlate_C", count: 3 }]),
    ]);

    expect(baseline.deathCrates.crates).toEqual([
      {
        id: `${"Persistent_Level:PersistentLevel"}.Crate_1`,
        location: { x: 50, y: 60, z: 70 },
        items: [{ className: "Desc_IronPlate_C", displayName: "Iron Plate", count: 3 }],
      },
    ]);
  });

  it("excludes a dismantle crate — only death crates belong here", () => {
    const baseline = baselineOf([
      crate("Crate_1", "Dismantle", { x: 0, y: 0, z: 0 }, "crate-inv-1"),
      inventory("crate-inv-1", [{ className: "Desc_IronPlate_C", count: 3 }]),
    ]);

    expect(baseline.deathCrates.crates).toEqual([]);
  });

  it("reports an empty item list for a death crate whose inventory can't be found", () => {
    const baseline = baselineOf([crate("Crate_1", "Death", { x: 0, y: 0, z: 0 })]);

    expect(baseline.deathCrates.crates).toEqual([
      {
        id: `${"Persistent_Level:PersistentLevel"}.Crate_1`,
        location: { x: 0, y: 0, z: 0 },
        items: [],
      },
    ]);
  });

  it("reports no crates for a save with none", () => {
    expect(baselineOf([]).deathCrates.crates).toEqual([]);
  });
});

describe("sink baseline", () => {
  it("reads accrued points and coupons off the resource sink subsystem", () => {
    const baseline = baselineOf([resourceSink(3_334_555_366, 13)]);

    expect(baseline.sink).toEqual({
      totalPoints: 3_334_555_366,
      numCoupons: 13,
      pointsToNextCoupon: null,
      percentToNextCoupon: null,
    });
  });

  it("reports zero rather than unknown when the save has no sink subsystem yet", () => {
    expect(baselineOf([]).sink).toEqual({
      totalPoints: 0,
      numCoupons: 0,
      pointsToNextCoupon: null,
      percentToNextCoupon: null,
    });
  });
});

describe("production baseline", () => {
  it("adds up the installed maximum rate per product", () => {
    const baseline = baselineOf([
      machine("Build_ConstructorMk1_C_1", "Recipe_IronPlate_C"),
      machine("Build_ConstructorMk1_C_2", "Recipe_IronPlate_C"),
    ]);

    // Two constructors on Iron Plate: 20/min each at 100%.
    expect(baseline.production.items).toEqual([
      {
        className: "Desc_IronPlate_C",
        displayName: "Iron Plate",
        currentPerMin: null,
        maxPerMin: 40,
      },
    ]);
  });

  it("scales an overclocked machine's maximum rate by its potential", () => {
    const baseline = baselineOf([
      machine("Build_ConstructorMk1_C_1", "Recipe_IronPlate_C", { potential: 2.5 }),
    ]);

    expect(baseline.production.items[0]?.maxPerMin).toBe(50);
  });

  it("skips a machine with no recipe set", () => {
    const baseline = baselineOf([machine("Build_ConstructorMk1_C_1", null)]);

    expect(baseline.production.items).toEqual([]);
  });
});

describe("machines baseline", () => {
  it("counts machines per building class from those with a recipe configured", () => {
    const baseline = baselineOf([
      machine("Build_ConstructorMk1_C_1", "Recipe_IronPlate_C"),
      machine("Build_ConstructorMk1_C_2", "Recipe_IronPlate_C"),
    ]);

    expect(baseline.machines.machines).toEqual([
      {
        className: "Build_ConstructorMk1_C",
        displayName: "Constructor",
        totalCount: 2,
        producingCount: null,
        idleCount: null,
        pausedCount: null,
        averageEfficiencyPercent: null,
      },
    ]);
  });

  it("skips a machine with no recipe set — a save can't tell an idle machine from an unbuilt one", () => {
    const baseline = baselineOf([machine("Build_ConstructorMk1_C_1", null)]);

    expect(baseline.machines.machines).toEqual([]);
  });

  it("falls back to the class name for a building the dump does not cover", () => {
    const baseline = baselineOf([machine("Build_ModdedMachine_C_1", "Recipe_IronPlate_C")]);

    expect(baseline.machines.machines).toEqual([
      expect.objectContaining({
        className: "Build_ModdedMachine_C",
        displayName: "Build_ModdedMachine_C",
      }),
    ]);
  });

  it("orders machine classes by total count descending, className breaking ties", () => {
    const baseline = baselineOf([
      machine("Build_ConstructorMk1_C_1", "Recipe_IronPlate_C"),
      machine("Build_SmelterMk1_C_1", "Recipe_IronPlate_C"),
      machine("Build_SmelterMk1_C_2", "Recipe_IronPlate_C"),
    ]);

    expect(baseline.machines.machines.map((m) => m.className)).toEqual([
      "Build_SmelterMk1_C",
      "Build_ConstructorMk1_C",
    ]);
  });
});

describe("map buildings baseline", () => {
  it("places one entry per configured machine, with status always null", () => {
    const baseline = baselineOf([
      machine("Build_ConstructorMk1_C_1", "Recipe_IronPlate_C", {
        location: { x: 100, y: 200, z: 5 },
      }),
    ]);

    expect(baseline.mapBuildings).toEqual([
      {
        id: "Persistent_Level:PersistentLevel.Build_ConstructorMk1_C_1",
        className: "Build_ConstructorMk1_C",
        displayName: "Constructor",
        transform: { x: 100, y: 200, z: 5, rotationDegrees: 0 },
        footprint: { widthCm: 800, depthCm: 800 },
        status: null,
      },
    ]);
  });

  it("derives yaw from the save's rotation quaternion", () => {
    const baseline = baselineOf([
      machine("Build_ConstructorMk1_C_1", "Recipe_IronPlate_C", {
        location: { x: 0, y: 0, z: 0 },
        yawDegrees: 90,
      }),
    ]);

    expect(baseline.mapBuildings[0]?.transform.rotationDegrees).toBeCloseTo(90);
  });

  it("normalizes a negative yaw into the 0-359 range", () => {
    const baseline = baselineOf([
      machine("Build_ConstructorMk1_C_1", "Recipe_IronPlate_C", {
        location: { x: 0, y: 0, z: 0 },
        yawDegrees: -90,
      }),
    ]);

    expect(baseline.mapBuildings[0]?.transform.rotationDegrees).toBeCloseTo(270);
  });

  it("skips a machine with no recipe set, matching the machines domain's population", () => {
    const baseline = baselineOf([
      machine("Build_ConstructorMk1_C_1", null, { location: { x: 0, y: 0, z: 0 } }),
    ]);

    expect(baseline.mapBuildings).toEqual([]);
  });

  it("skips a configured machine with no resolvable location", () => {
    const baseline = baselineOf([machine("Build_ConstructorMk1_C_1", "Recipe_IronPlate_C")]);

    expect(baseline.mapBuildings).toEqual([]);
  });
});

describe("milestones baseline", () => {
  const milestonePath = "/Game/FactoryGame/Schematics/Progression/Schematic_8-5.Schematic_8-5_C";
  const researchPath =
    "/Game/FactoryGame/Schematics/Research/Sulfur/Research_Sulfur_1.Research_Sulfur_1_C";
  const alternatePath =
    "/Game/FactoryGame/Schematics/Alternate/Schematic_Alternate_PureIronIngot.Schematic_Alternate_PureIronIngot_C";

  it("names the current milestone, its ingredients unpaid, and the Space Elevator phase", () => {
    const baseline = baselineOf([
      schematicManager({ activeSchematic: milestonePath }),
      gamePhaseManager(
        "/Game/FactoryGame/GamePhases/GP_Project_Assembly_Phase_3.GP_Project_Assembly_Phase_3",
      ),
    ]);

    expect(baseline.milestones).toEqual({
      currentMilestone: {
        className: "Schematic_8-5_C",
        displayName: "Particle Enrichment",
        ingredients: [
          {
            className: "Desc_IronPlate_C",
            displayName: "Iron Plate",
            amount: 0,
            targetAmount: 50,
          },
        ],
      },
      spaceElevatorPhase: "Phase 3",
      activeResearch: [],
      collectibles: { hardDriveResultsAwaitingClaim: 0, alternateRecipesUnlocked: 0 },
      playDurationSeconds: null,
    });
  });

  it("reports how much of the active milestone has been paid off", () => {
    const baseline = baselineOf([
      schematicManager({
        activeSchematic: milestonePath,
        paidOff: [
          { schematic: milestonePath, items: [{ className: "Desc_IronPlate_C", count: 20 }] },
        ],
      }),
    ]);

    expect(baseline.milestones.currentMilestone?.ingredients).toEqual([
      { className: "Desc_IronPlate_C", displayName: "Iron Plate", amount: 20, targetAmount: 50 },
    ]);
  });

  it("falls back to the last active schematic when nothing is currently active", () => {
    const baseline = baselineOf([schematicManager({ lastActiveSchematic: milestonePath })]);

    expect(baseline.milestones.currentMilestone?.className).toBe("Schematic_8-5_C");
  });

  it("does not resurrect an already-purchased milestone as current", () => {
    // A real save can have mActiveSchematic absent (between selections) while
    // mLastActiveSchematic still points at whatever was last worked on —
    // including a milestone that has since been completed and purchased.
    // mPaidOffSchematic is cleared on purchase, so trusting the fallback
    // unconditionally would render a finished milestone as "current" at 0%.
    const baseline = baselineOf([
      schematicManager({ lastActiveSchematic: milestonePath, purchased: [milestonePath] }),
    ]);

    expect(baseline.milestones.currentMilestone).toBeNull();
  });

  it("prefers the active schematic over the last active one when both are present", () => {
    const otherPath = "/Game/FactoryGame/Schematics/Progression/Schematic_2-1.Schematic_2-1_C";
    const baseline = baselineOf([
      schematicManager({ activeSchematic: milestonePath, lastActiveSchematic: otherPath }),
    ]);

    expect(baseline.milestones.currentMilestone?.className).toBe("Schematic_8-5_C");
  });

  it("reports in-flight MAM research with time remaining", () => {
    const baseline = baselineOf([
      researchManager({ ongoing: [{ schematic: researchPath, secondsRemaining: 120 }] }),
    ]);

    expect(baseline.milestones.activeResearch).toEqual([
      { className: "Research_Sulfur_1_C", displayName: "Sulfur Research", secondsRemaining: 120 },
    ]);
  });

  it("reports unknown rather than zero when a save doesn't record research time remaining", () => {
    const baseline = baselineOf([researchManager({ ongoing: [{ schematic: researchPath }] })]);

    expect(baseline.milestones.activeResearch).toEqual([
      { className: "Research_Sulfur_1_C", displayName: "Sulfur Research", secondsRemaining: null },
    ]);
  });

  it("counts hard drive results waiting to be claimed", () => {
    const baseline = baselineOf([researchManager({ unclaimedHardDriveCount: 3 })]);

    expect(baseline.milestones.collectibles.hardDriveResultsAwaitingClaim).toBe(3);
  });

  it("counts alternate recipes among the purchased schematics", () => {
    const baseline = baselineOf([schematicManager({ purchased: [milestonePath, alternatePath] })]);

    expect(baseline.milestones.collectibles.alternateRecipesUnlocked).toBe(1);
  });

  it("reports unknown rather than guessing when the save has no progression yet", () => {
    expect(baselineOf([]).milestones).toEqual({
      currentMilestone: null,
      spaceElevatorPhase: null,
      activeResearch: [],
      collectibles: { hardDriveResultsAwaitingClaim: 0, alternateRecipesUnlocked: 0 },
      playDurationSeconds: null,
    });
  });
});

describe("a save with nothing recognisable in it", () => {
  it("produces empty domains rather than failing", () => {
    const baseline = baselineOf([]);

    expect(baseline.power.circuits).toEqual([]);
    expect(baseline.storage.items).toEqual([]);
    expect(baseline.production.items).toEqual([]);
    expect(baseline.machines.machines).toEqual([]);
    expect(baseline.containers).toEqual([]);
    expect(baseline.depot.items).toEqual([]);
    expect(baseline.deathCrates.crates).toEqual([]);
  });
});
