/**
 * Building the codex popover's REST payload (spec, "Static data" / "v1
 * features: Codex popover") from the static-data module — the seed of the
 * v2 full codex, per the spec's "Reserved for v2".
 */
import path from "node:path";
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

/** Every character a real game class name ever contains (`Desc_IronPlate_C`,
 *  `Schematic_8-5_C`) — no `/`, `\`, or `.`, so nothing matching this can
 *  spell a path-traversal segment in the first place. */
const CLASS_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Resolve a className (untrusted: it comes straight off the icon route's
 * request path) to its icon file inside `iconsDirectory`, or null when the
 * name doesn't look like a real class name or the resolved path would
 * escape that directory. Two independent checks rather than one: the
 * grammar check rejects the input outright, and the resolved-path check
 * catches anything the grammar didn't anticipate (e.g. a symlink inside
 * `iconsDirectory` pointing back out) — the same belt-and-suspenders
 * pattern `staticFiles.ts`'s `resolveFile` already uses for the dashboard's
 * static assets.
 */
export function resolveCodexIconPath(iconsDirectory: string, className: string): string | null {
  if (!CLASS_NAME_PATTERN.test(className)) return null;

  const root = path.resolve(iconsDirectory);
  const candidate = path.resolve(root, `${className}.png`);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null;

  return candidate;
}
