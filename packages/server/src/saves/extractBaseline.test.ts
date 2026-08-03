import { describe, expect, it } from "vitest";
import { testStaticData } from "../staticData/staticDataTestSupport.ts";
import { extractBaseline, type SaveObjectView } from "./extractBaseline.ts";
import {
  centralStorage,
  circuit,
  gamePhaseManager,
  inventory,
  machine,
  powerStorage,
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

describe("milestones baseline", () => {
  it("names the current milestone and Space Elevator phase", () => {
    const baseline = baselineOf([
      schematicManager("/Game/FactoryGame/Schematics/Progression/Schematic_8-5.Schematic_8-5_C"),
      gamePhaseManager(
        "/Game/FactoryGame/GamePhases/GP_Project_Assembly_Phase_3.GP_Project_Assembly_Phase_3",
      ),
    ]);

    expect(baseline.milestones).toEqual({
      currentMilestone: "Particle Enrichment",
      spaceElevatorPhase: "Phase 3",
    });
  });

  it("reports unknown rather than guessing when the save has no progression yet", () => {
    expect(baselineOf([]).milestones).toEqual({
      currentMilestone: null,
      spaceElevatorPhase: null,
    });
  });
});

describe("a save with nothing recognisable in it", () => {
  it("produces empty domains rather than failing", () => {
    const baseline = baselineOf([]);

    expect(baseline.power.circuits).toEqual([]);
    expect(baseline.storage.items).toEqual([]);
    expect(baseline.production.items).toEqual([]);
  });
});
