/**
 * The codex popover's contract — a REST GET, not part of WorldState.
 *
 * Per ADR 0003, a codex lookup is request/response: fetched only when the
 * player clicks an item or machine somewhere in the dashboard, never pushed
 * with every WorldState snapshot. This is the seed for the v2 full codex
 * (spec, "Reserved for v2") — the shape is general enough to serve a full
 * codex browser later, not tailored to a popover specifically.
 */
import { z } from "zod";

/** One side of a recipe, resolved to a display name — unlike the server's
 *  internal `RecipeAmount`, which carries only a class name, the popover
 *  renders straight from this without a second lookup. */
export const codexAmountSchema = z.object({
  className: z.string(),
  displayName: z.string(),
  amount: z.number(),
  perMinute: z.number(),
});
export type CodexAmount = z.infer<typeof codexAmountSchema>;

/** A building this recipe can run in — the raw class name plus its resolved
 *  display name, mirroring {@link CodexAmount}'s reasoning. */
export const codexRecipeBuildingSchema = z.object({
  className: z.string(),
  displayName: z.string(),
});
export type CodexRecipeBuilding = z.infer<typeof codexRecipeBuildingSchema>;

export const codexRecipeSchema = z.object({
  className: z.string(),
  displayName: z.string(),
  ingredients: z.array(codexAmountSchema),
  products: z.array(codexAmountSchema),
  durationSeconds: z.number(),
  producedIn: z.array(codexRecipeBuildingSchema),
});
export type CodexRecipe = z.infer<typeof codexRecipeSchema>;

/** What was clicked: an item (a `Desc_*`/`Build_*` produced good) or a
 *  machine (a placed building). The caller already knows which — it's
 *  clicking on a `ProductionItem`/`StorageItem`/`MilestoneIngredient`
 *  (item) or a `MapBuilding`/`MachineRollup` (building) — so the lookup
 *  takes it explicitly rather than inferring it from the class name. */
export const codexKindSchema = z.enum(["item", "building"]);
export type CodexKind = z.infer<typeof codexKindSchema>;

/**
 * One codex entry: display name, description, and "its... recipe, rates"
 * (spec, "v1 features: Codex popover"). `recipes` differs by `kind` — for an
 * item, the recipes that produce it; for a building, the recipes it can run.
 * `powerConsumptionMW`/`powerProductionMW` are null for an item (the concept
 * doesn't apply) and a real number (0 where the dump has none) for a building.
 */
export const codexEntrySchema = z.object({
  className: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  kind: codexKindSchema,
  recipes: z.array(codexRecipeSchema),
  powerConsumptionMW: z.number().nullable(),
  powerProductionMW: z.number().nullable(),
  /** Always present — the icon endpoint itself 404s gracefully when the
   *  local install has no matching file (spec, "Licensing constraints":
   *  icons are never bundled, so their presence can never be guaranteed). */
  iconUrl: z.string(),
});
export type CodexEntry = z.infer<typeof codexEntrySchema>;
