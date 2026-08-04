/**
 * Building the codex popover's REST payload (spec, "Static data" / "v1
 * features: Codex popover") from the static-data module — the seed of the
 * v2 full codex, per the spec's "Reserved for v2".
 */
import type { CodexAmount, CodexEntry, CodexKind, CodexRecipe } from "@scc/shared";
import {
  classNameFromPath,
  type RecipeAmount,
  type RecipeInfo,
  type StaticData,
} from "../staticData/staticData.ts";

function toCodexAmount(staticData: StaticData, amount: RecipeAmount): CodexAmount {
  return {
    className: amount.className,
    displayName: staticData.displayName(amount.className) ?? amount.className,
    amount: amount.amount,
    perMinute: amount.perMinute,
  };
}

function toCodexRecipe(staticData: StaticData, recipe: RecipeInfo): CodexRecipe {
  return {
    className: recipe.className,
    displayName: recipe.displayName,
    ingredients: recipe.ingredients.map((amount) => toCodexAmount(staticData, amount)),
    products: recipe.products.map((amount) => toCodexAmount(staticData, amount)),
    durationSeconds: recipe.durationSeconds,
    producedIn: recipe.producedIn.map((className) => ({
      className,
      displayName: staticData.displayName(className) ?? className,
    })),
  };
}

/**
 * One codex entry for a clicked item or machine, or null when the dump
 * doesn't cover the class (creatures, resource nodes and collectibles are
 * genuinely absent — see `StaticData.displayName`'s doc comment). `kind` is
 * supplied by the caller rather than inferred: every click site already
 * knows which it clicked (a `ProductionItem`/`StorageItem`/
 * `MilestoneIngredient` is always an item; a `MapBuilding`/`MachineRollup`
 * is always a building), and `StaticData.item`/`.building` both resolve
 * *any* known class name regardless of its real kind — they exist to read
 * a class whose kind the caller already knows, not to classify one.
 */
export function buildCodexEntry(
  staticData: StaticData,
  kind: CodexKind,
  classNameOrPath: string,
): CodexEntry | null {
  const className = classNameFromPath(classNameOrPath);
  const iconUrl = `/api/codex/icon/${encodeURIComponent(className)}`;

  if (kind === "item") {
    const item = staticData.item(className);
    if (!item) return null;
    return {
      className: item.className,
      displayName: item.displayName,
      description: item.description,
      kind: "item",
      recipes: staticData
        .recipesProducing(className)
        .map((recipe) => toCodexRecipe(staticData, recipe)),
      powerConsumptionMW: null,
      powerProductionMW: null,
      iconUrl,
    };
  }

  const building = staticData.building(className);
  if (!building) return null;
  return {
    className: building.className,
    displayName: building.displayName,
    description: building.description,
    kind: "building",
    recipes: staticData
      .recipesProducedIn(className)
      .map((recipe) => toCodexRecipe(staticData, recipe)),
    powerConsumptionMW: building.powerConsumptionMW,
    powerProductionMW: building.powerProductionMW,
    iconUrl,
  };
}
