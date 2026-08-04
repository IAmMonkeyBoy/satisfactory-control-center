/**
 * The static-data module: the game's own class dump, turned into lookups.
 *
 * Saves and the live feed both speak in class names (`Desc_IronPlate_C`,
 * `Build_ConstructorMk1_C`); nothing in them is human-readable and nothing carries
 * a rate. The game install ships `CommunityResources\Docs\en-US.json` — a UTF-16 LE
 * dump of every item, recipe, buildable and schematic — which supplies the display
 * names, recipe graphs and rates the dashboard needs (spec, "Static data").
 *
 * The dump is read from Aaron's own install at runtime and never vendored: it
 * carries no explicit licence, and the recipes must match the install that wrote
 * the save anyway.
 *
 * This module is v1's display-name source and the seed of the v2 codex, so it
 * keeps each class's raw entry alongside the typed views below. New codex needs
 * (descriptions, categories, schematic trees) become new accessors over data
 * already indexed here, not a second pass over the file.
 */
import { readFile } from "node:fs/promises";

/** One class as the game exported it, with every value still a string. */
export interface DocsEntry {
  className: string;
  /** The `NativeClass` group the entry came from — its broad kind. */
  nativeClass: string;
  fields: Record<string, unknown>;
}

/** An item or fluid. Anything beyond this is read from {@link DocsEntry.fields}. */
export interface ItemInfo {
  className: string;
  displayName: string;
  /** True for fluids and gases, whose amounts the dump scales by 1000. */
  isFluid: boolean;
}

/** One side of a recipe: how much of an item, and at what rate. */
export interface RecipeAmount {
  className: string;
  amount: number;
  /** Amount per minute when the producing machine runs at 100%. */
  perMinute: number;
}

export interface RecipeInfo {
  className: string;
  displayName: string;
  ingredients: RecipeAmount[];
  products: RecipeAmount[];
  durationSeconds: number;
  /** Class names of the buildings that can run this recipe. */
  producedIn: string[];
}

export interface BuildingInfo {
  className: string;
  displayName: string;
  /** Rated draw at 100%; 0 for buildings that consume nothing. */
  powerConsumptionMW: number;
  /** Rated output at 100%; 0 for anything that is not a generator. */
  powerProductionMW: number;
}

/**
 * A schematic: a HUB milestone, MAM research node, alternate-recipe unlock,
 * or similar. `type` is the raw `mType` value (`EST_Milestone`, `EST_MAM`,
 * `EST_Alternate`, `EST_HardDrive`, `EST_ResourceSink`, `EST_Tutorial`,
 * `EST_Custom`) — kept as the game's own string rather than a narrower enum,
 * since v1 only ever needs to filter or label by it, never branch deeply.
 */
export interface SchematicInfo {
  className: string;
  displayName: string;
  type: string;
  /** The full cost to purchase this schematic, in the same shape a recipe's
   *  ingredients are — a save only ever records what's been paid off, never
   *  this total, so ingredient-progress UI needs both. */
  cost: RecipeAmount[];
}

/**
 * Reduce a class path to the class name the Docs file is keyed by. Save files
 * refer to classes by full path (`/Game/…/Desc_IronPlate.Desc_IronPlate_C`) while
 * the dump keys on the bare name.
 */
export function classNameFromPath(classPath: string): string {
  const afterDot = classPath.slice(classPath.lastIndexOf(".") + 1);
  return afterDot.slice(afterDot.lastIndexOf("/") + 1);
}

/** Indexed game data: display names, recipes and rates, and building power. */
export class StaticData {
  private readonly entries: Map<string, DocsEntry>;

  constructor(entries: Map<string, DocsEntry>) {
    this.entries = entries;
  }

  /** The raw exported entry, for codex features not yet given a typed view. */
  entry(classNameOrPath: string): DocsEntry | null {
    return this.entries.get(classNameFromPath(classNameOrPath)) ?? null;
  }

  /**
   * The human-readable name for any class, or null when the dump doesn't cover it
   * — creatures, resource nodes and collectibles are genuinely absent, so callers
   * must be ready to fall back to the class name.
   */
  displayName(classNameOrPath: string): string | null {
    const name = this.field(classNameOrPath, "mDisplayName");
    return name === undefined || name === "" ? null : name;
  }

  item(classNameOrPath: string): ItemInfo | null {
    const entry = this.entry(classNameOrPath);
    if (!entry) return null;
    return {
      className: entry.className,
      displayName: asString(entry.fields.mDisplayName) ?? entry.className,
      isFluid: isFluidForm(asString(entry.fields.mForm)),
    };
  }

  recipe(classNameOrPath: string): RecipeInfo | null {
    const entry = this.entry(classNameOrPath);
    if (!entry || entry.fields.mProduct === undefined) return null;

    const durationSeconds = asNumber(entry.fields.mManufactoringDuration) ?? 0;
    return {
      className: entry.className,
      displayName: asString(entry.fields.mDisplayName) ?? entry.className,
      ingredients: this.parseAmounts(asString(entry.fields.mIngredients), durationSeconds),
      products: this.parseAmounts(asString(entry.fields.mProduct), durationSeconds),
      durationSeconds,
      producedIn: parseClassList(asString(entry.fields.mProducedIn)),
    };
  }

  building(classNameOrPath: string): BuildingInfo | null {
    const entry = this.entry(classNameOrPath);
    if (!entry) return null;
    return {
      className: entry.className,
      displayName: asString(entry.fields.mDisplayName) ?? entry.className,
      powerConsumptionMW: asNumber(entry.fields.mPowerConsumption) ?? 0,
      powerProductionMW: asNumber(entry.fields.mPowerProduction) ?? 0,
    };
  }

  schematic(classNameOrPath: string): SchematicInfo | null {
    const entry = this.entry(classNameOrPath);
    if (!entry || entry.fields.mType === undefined) return null;
    return {
      className: entry.className,
      displayName: asString(entry.fields.mDisplayName) ?? entry.className,
      type: asString(entry.fields.mType) ?? "",
      // A schematic's cost has no duration to derive a rate from — reusing
      // parseAmounts still gets the ItemClass/Amount decoding for free.
      cost: this.parseAmounts(asString(entry.fields.mCost), 0),
    };
  }

  private field(classNameOrPath: string, name: string): string | undefined {
    return asString(this.entry(classNameOrPath)?.fields[name]);
  }

  /**
   * Decode an `((ItemClass="…",Amount=N),…)` list. Fluid amounts are exported in
   * millilitres, so they are scaled back to the cubic metres the game's own UI
   * shows before any rate is derived from them.
   */
  private parseAmounts(raw: string | undefined, durationSeconds: number): RecipeAmount[] {
    if (!raw) return [];
    const amounts: RecipeAmount[] = [];
    const pattern = /ItemClass=".*?'(?<path>[^']+)'",Amount=(?<amount>-?\d+)/g;

    for (const match of raw.matchAll(pattern)) {
      const className = classNameFromPath(match.groups!.path!);
      const exported = Number(match.groups!.amount);
      const amount = this.item(className)?.isFluid ? exported / 1000 : exported;
      amounts.push({
        className,
        amount,
        perMinute: durationSeconds > 0 ? (amount * 60) / durationSeconds : 0,
      });
    }
    return amounts;
  }
}

/** Build the lookups from the already-parsed contents of the Docs file. */
export function parseDocs(docs: unknown): StaticData {
  const entries = new Map<string, DocsEntry>();
  if (!Array.isArray(docs)) return new StaticData(entries);

  for (const group of docs) {
    if (typeof group !== "object" || group === null) continue;
    const { NativeClass, Classes } = group as { NativeClass?: unknown; Classes?: unknown };
    if (!Array.isArray(Classes)) continue;

    for (const entry of Classes) {
      if (typeof entry !== "object" || entry === null) continue;
      const fields = entry as Record<string, unknown>;
      const className = asString(fields.ClassName);
      if (!className) continue;
      entries.set(className, {
        className,
        nativeClass: asString(NativeClass) ?? "",
        fields,
      });
    }
  }
  return new StaticData(entries);
}

/**
 * Load and index the game's Docs file. It is UTF-16 LE with a byte-order mark —
 * decoding it as UTF-8 yields mojibake rather than an error, so the encoding is
 * pinned explicitly here.
 */
export async function loadStaticData(filePath: string): Promise<StaticData> {
  const bytes = await readFile(filePath);
  return parseDocs(JSON.parse(decodeDocs(bytes)));
}

/** Decode Docs-file bytes, stripping the UTF-16 byte-order mark. */
export function decodeDocs(bytes: Buffer): string {
  const text = bytes.toString("utf16le");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseClassList(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...raw.matchAll(/"([^"]+)"/g)].map((match) => classNameFromPath(match[1]!));
}

function isFluidForm(form: string | undefined): boolean {
  return form === "RF_LIQUID" || form === "RF_GAS";
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  const text = asString(value);
  if (text === undefined) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}
