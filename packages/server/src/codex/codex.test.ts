import { describe, expect, it } from "vitest";
import path from "node:path";
import { testStaticData } from "../staticData/staticDataTestSupport.ts";
import { buildCodexEntry, resolveCodexIconPath } from "./codex.ts";

const staticData = testStaticData();

describe("buildCodexEntry — item", () => {
  it("carries display name, description, and the recipes that produce it", () => {
    const entry = buildCodexEntry(staticData, "item", "Desc_IronPlate_C");

    expect(entry?.kind).toBe("item");
    expect(entry?.displayName).toBe("Iron Plate");
    expect(entry?.description).toBe("Used for crafting.");
    expect(entry?.powerConsumptionMW).toBeNull();
    expect(entry?.powerProductionMW).toBeNull();
    expect(entry?.iconUrl).toBe("/api/codex/icon/Desc_IronPlate_C");

    expect(entry?.recipes).toHaveLength(1);
    const recipe = entry!.recipes[0]!;
    expect(recipe.className).toBe("Recipe_IronPlate_C");
    expect(recipe.ingredients).toEqual([
      { className: "Desc_IronIngot_C", displayName: "Iron Ingot", amount: 3, perMinute: 30 },
    ]);
    expect(recipe.products).toEqual([
      { className: "Desc_IronPlate_C", displayName: "Iron Plate", amount: 2, perMinute: 20 },
    ]);
    expect(recipe.producedIn).toEqual([
      { className: "Build_ConstructorMk1_C", displayName: "Constructor" },
    ]);
  });

  it("accepts a save's full class path as well as a bare class name", () => {
    const entry = buildCodexEntry(
      staticData,
      "item",
      "/Game/FactoryGame/Resource/Parts/IronPlate/Desc_IronPlate.Desc_IronPlate_C",
    );
    expect(entry?.className).toBe("Desc_IronPlate_C");
  });

  it("returns an entry with no description when the dump carries none", () => {
    expect(buildCodexEntry(staticData, "item", "Desc_IronIngot_C")?.description).toBeNull();
  });

  it("returns an entry with no recipes when nothing produces it", () => {
    expect(buildCodexEntry(staticData, "item", "Desc_IronIngot_C")?.recipes).toEqual([]);
  });

  it("returns null for a class the dump doesn't cover", () => {
    expect(buildCodexEntry(staticData, "item", "Desc_NotInTheDump_C")).toBeNull();
  });
});

describe("buildCodexEntry — building", () => {
  it("carries power ratings and the recipes it can run", () => {
    const entry = buildCodexEntry(staticData, "building", "Build_ConstructorMk1_C");

    expect(entry?.kind).toBe("building");
    expect(entry?.displayName).toBe("Constructor");
    expect(entry?.powerConsumptionMW).toBe(4);
    expect(entry?.powerProductionMW).toBe(0);
    expect(entry?.recipes.map((r) => r.className)).toEqual(["Recipe_IronPlate_C"]);
  });

  it("returns an entry with no recipes for a building nothing is produced in", () => {
    const entry = buildCodexEntry(staticData, "building", "Build_GeneratorCoal_C");
    expect(entry?.recipes).toEqual([]);
    expect(entry?.powerProductionMW).toBe(75);
  });

  it("returns null for a class the dump doesn't cover", () => {
    expect(buildCodexEntry(staticData, "building", "Build_NotInTheDump_C")).toBeNull();
  });
});

describe("resolveCodexIconPath", () => {
  const iconsDir = path.join("/fixture", "icons");

  it("resolves a well-formed class name to a file inside the icons directory", () => {
    expect(resolveCodexIconPath(iconsDir, "Desc_IronPlate_C")).toBe(
      path.join(iconsDir, "Desc_IronPlate_C.png"),
    );
  });

  it("accepts the hyphenated class names schematics use", () => {
    expect(resolveCodexIconPath(iconsDir, "Schematic_8-5_C")).toBe(
      path.join(iconsDir, "Schematic_8-5_C.png"),
    );
  });

  it("rejects a traversal attempt disguised as a class name", () => {
    expect(resolveCodexIconPath(iconsDir, "../../etc/passwd")).toBeNull();
    expect(resolveCodexIconPath(iconsDir, "../secret")).toBeNull();
  });

  it("rejects a class name containing a path separator", () => {
    expect(resolveCodexIconPath(iconsDir, "sub/Desc_IronPlate_C")).toBeNull();
  });

  it("rejects an empty class name", () => {
    expect(resolveCodexIconPath(iconsDir, "")).toBeNull();
  });
});
