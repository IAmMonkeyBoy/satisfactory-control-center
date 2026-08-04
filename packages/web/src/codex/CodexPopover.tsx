import { useEffect, useState, type JSX, type ReactNode } from "react";
import type { CodexEntry, CodexRecipe } from "@scc/shared";
import { formatPerMin } from "../production/productionItems";
import { useCodexContext } from "./CodexContext";
import { formatCraftSeconds, kindLabel } from "./codexFormat";
import { useCodexEntry, type CodexEntryStatus } from "./useCodexEntry";

/**
 * The codex popover (spec, "v1 features: Codex popover"): display name,
 * recipe, rates, and description for whatever item or machine was clicked,
 * from the static-data module. Mounted once at the top of the Map Deck;
 * `CodexContext` decides whether it's showing anything. This is the seed of
 * the v2 full codex (spec, "Reserved for v2") — the v2 codex nav slot
 * (`CodexNavSlot.tsx`) is untouched by this feature.
 */
export function CodexPopover(): JSX.Element | null {
  const { target, close } = useCodexContext();
  const { status, entry } = useCodexEntry(target);

  useEffect(() => {
    if (!target) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [target, close]);

  if (!target) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 pointer-events-auto"
      onClick={close}
    >
      <div
        className="max-h-[80vh] w-96 overflow-y-auto rounded-lg border border-neutral-800 bg-metal-900 p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <CodexPopoverBody status={status} entry={entry} onClose={close} />
      </div>
    </div>
  );
}

function CodexPopoverBody({
  status,
  entry,
  onClose,
}: {
  status: CodexEntryStatus;
  entry: CodexEntry | null;
  onClose: () => void;
}): JSX.Element {
  if (status === "loading" || status === "idle") {
    return <CodexFrame title="Loading…" onClose={onClose} />;
  }
  if (status === "notFound") {
    return (
      <CodexFrame title="No codex data" onClose={onClose}>
        <p className="text-sm text-neutral-500">
          The game's static data doesn't cover this — likely a creature, resource node, or
          collectible.
        </p>
      </CodexFrame>
    );
  }
  if (status === "error" || !entry) {
    return (
      <CodexFrame title="Codex lookup failed" onClose={onClose}>
        <p className="text-sm text-neutral-500">Try again.</p>
      </CodexFrame>
    );
  }

  return (
    <CodexFrame title={entry.displayName} onClose={onClose}>
      <CodexEntryView entry={entry} />
    </CodexFrame>
  );
}

function CodexFrame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-neutral-500 hover:text-neutral-200"
        >
          ✕
        </button>
      </div>
      {children}
    </div>
  );
}

function CodexEntryView({ entry }: { entry: CodexEntry }): JSX.Element {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <CodexIcon iconUrl={entry.iconUrl} displayName={entry.displayName} />
        <div>
          <div className="text-xs uppercase tracking-wider text-neutral-500">
            {kindLabel(entry.kind)}
          </div>
          {entry.description && (
            <p className="mt-1 text-sm text-neutral-300">{entry.description}</p>
          )}
        </div>
      </div>

      {entry.kind === "building" && (
        <div className="flex gap-4 text-sm text-neutral-300">
          {entry.powerConsumptionMW !== null && entry.powerConsumptionMW > 0 && (
            <span>Draws {entry.powerConsumptionMW} MW</span>
          )}
          {entry.powerProductionMW !== null && entry.powerProductionMW > 0 && (
            <span>Produces {entry.powerProductionMW} MW</span>
          )}
        </div>
      )}

      <RecipeList
        title={entry.kind === "item" ? "Made by" : "Can produce"}
        recipes={entry.recipes}
      />
    </div>
  );
}

function CodexIcon({
  iconUrl,
  displayName,
}: {
  iconUrl: string;
  displayName: string;
}): JSX.Element {
  const [failed, setFailed] = useState(false);
  if (failed) return <></>;

  return (
    <img
      src={iconUrl}
      alt={displayName}
      className="h-12 w-12 flex-none rounded border border-neutral-800 bg-metal-950 object-contain"
      onError={() => setFailed(true)}
    />
  );
}

function RecipeList({ title, recipes }: { title: string; recipes: CodexRecipe[] }): JSX.Element {
  if (recipes.length === 0) {
    return <p className="text-sm text-neutral-600">No known recipes.</p>;
  }

  return (
    <div>
      <div className="mb-1.5 text-xs uppercase tracking-wider text-neutral-500">{title}</div>
      <ul className="space-y-2">
        {recipes.map((recipe) => (
          <RecipeRow key={recipe.className} recipe={recipe} />
        ))}
      </ul>
    </div>
  );
}

function RecipeRow({ recipe }: { recipe: CodexRecipe }): JSX.Element {
  return (
    <li className="border-l-2 border-neutral-800 pl-2 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-neutral-200">{recipe.displayName}</span>
        <span className="text-xs text-neutral-600">
          {formatCraftSeconds(recipe.durationSeconds)}
        </span>
      </div>
      <AmountLine label="In" amounts={recipe.ingredients} />
      <AmountLine label="Out" amounts={recipe.products} />
      {recipe.producedIn.length > 0 && (
        <div className="text-xs text-neutral-600">
          In: {recipe.producedIn.map((building) => building.displayName).join(", ")}
        </div>
      )}
    </li>
  );
}

function AmountLine({
  label,
  amounts,
}: {
  label: string;
  amounts: CodexRecipe["ingredients"];
}): JSX.Element | null {
  if (amounts.length === 0) return null;

  return (
    <div className="text-xs text-neutral-500">
      {label}:{" "}
      {amounts
        .map((amount) => `${amount.displayName} (${formatPerMin(amount.perMinute)})`)
        .join(", ")}
    </div>
  );
}
