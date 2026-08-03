import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { classNameFromPath, loadStaticData, parseDocs } from "./staticData.ts";
import { docsFixture, encodeAsGameDocs } from "./staticDataTestSupport.ts";

const staticData = parseDocs(docsFixture);

describe("classNameFromPath", () => {
  it("reduces a save's class path to the class name the Docs file is keyed by", () => {
    expect(
      classNameFromPath(
        "/Game/FactoryGame/Resource/Parts/IronPlate/Desc_IronPlate.Desc_IronPlate_C",
      ),
    ).toBe("Desc_IronPlate_C");
  });

  it("leaves a bare class name alone", () => {
    expect(classNameFromPath("Desc_IronPlate_C")).toBe("Desc_IronPlate_C");
  });
});

describe("static data lookups", () => {
  it("maps a class name to its display name", () => {
    expect(staticData.displayName("Desc_IronPlate_C")).toBe("Iron Plate");
  });

  it("accepts a save's full class path as well as a bare class name", () => {
    expect(
      staticData.displayName(
        "/Game/FactoryGame/Resource/Parts/IronPlate/Desc_IronPlate.Desc_IronPlate_C",
      ),
    ).toBe("Iron Plate");
  });

  it("returns null for a class the game's dump does not cover", () => {
    // Creatures, resource nodes and collectibles are absent from the dump.
    expect(staticData.displayName("Desc_NotInTheDump_C")).toBeNull();
  });
});

describe("recipes and rates", () => {
  it("reads a recipe's ingredients and products as per-minute rates", () => {
    // Iron Plate: 3 Iron Ingot in, 2 Iron Plate out, over 6 s => 30/min in, 20/min out.
    const recipe = staticData.recipe("Recipe_IronPlate_C");

    expect(recipe?.displayName).toBe("Iron Plate");
    expect(recipe?.ingredients).toEqual([
      { className: "Desc_IronIngot_C", amount: 3, perMinute: 30 },
    ]);
    expect(recipe?.products).toEqual([{ className: "Desc_IronPlate_C", amount: 2, perMinute: 20 }]);
    expect(recipe?.producedIn).toEqual(["Build_ConstructorMk1_C"]);
  });

  it("scales fluid amounts out of the dump's millilitre units", () => {
    // Fluids are written x1000 in the dump: 2000 means 2 m3, i.e. 120 m3/min at 1 s.
    const recipe = staticData.recipe("Recipe_Water_C");

    expect(recipe?.products).toEqual([{ className: "Desc_Water_C", amount: 2, perMinute: 120 }]);
  });

  it("returns null for an unknown recipe", () => {
    expect(staticData.recipe("Recipe_Imaginary_C")).toBeNull();
  });
});

describe("building power", () => {
  it("reads a generator's rated power production", () => {
    expect(staticData.building("Build_GeneratorCoal_C")?.powerProductionMW).toBe(75);
  });

  it("reads a machine's rated power draw", () => {
    expect(staticData.building("Build_ConstructorMk1_C")?.powerConsumptionMW).toBe(4);
  });

  it("reports zero production for a building that generates nothing", () => {
    expect(staticData.building("Build_ConstructorMk1_C")?.powerProductionMW).toBe(0);
  });

  it("exposes the raw exported entry for codex fields with no typed view yet", () => {
    expect(staticData.entry("Desc_IronPlate_C")?.fields.mDescription).toBe("Used for crafting.");
  });
});

describe("loadStaticData", () => {
  it("reads the game's UTF-16 LE Docs file from disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "scc-docs-"));
    const file = path.join(dir, "en-US.json");
    await writeFile(file, encodeAsGameDocs(docsFixture));

    try {
      const loaded = await loadStaticData(file);
      expect(loaded.displayName("Desc_IronPlate_C")).toBe("Iron Plate");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
