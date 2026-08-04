import type { JSX } from "react";
import type {
  ActiveResearch,
  CurrentMilestone,
  MilestoneIngredient,
  WorldState,
} from "@scc/shared";
import { PanelFrame } from "../alarms/PanelFrame";
import { formatDuration } from "../format";
import {
  formatAlternates,
  formatHardDriveResults,
  ingredientPercent,
} from "../milestones/milestonesFormat";
import { FreshnessTag } from "./FreshnessTag";
import { Section } from "./Section";

/**
 * Milestones summary (spec, "Milestones summary panel"): the current HUB
 * milestone with per-ingredient progress, the Space Elevator phase,
 * in-flight MAM research, and a compact collectibles/session-stat row.
 * Summary-level only — no browsing or interaction beyond the glance
 * (acceptance criteria; the full codex/calculator experience is v2). The
 * whole domain is baseline-only (FRM exposes no milestone/schematic/research
 * endpoint in this build — see `worldStateStore.ts`), so it carries one
 * freshness tag rather than a per-section one the way Storage's search does.
 */
export function MilestonesPanel({
  worldState,
  now,
  className,
}: {
  worldState: WorldState;
  now: number;
  className?: string;
}): JSX.Element {
  const {
    currentMilestone,
    spaceElevatorPhase,
    activeResearch,
    collectibles,
    playDurationSeconds,
  } = worldState.milestones.data;

  return (
    <PanelFrame
      title="Milestone"
      right={<FreshnessTag tag={worldState.milestones.tag} now={now} />}
      className={className}
    >
      <Section title="Current milestone">
        <CurrentMilestoneView milestone={currentMilestone} />
      </Section>

      <Section title="Space Elevator">
        <p className="text-sm text-neutral-300">{spaceElevatorPhase ?? "Not yet known"}</p>
      </Section>

      <Section title="MAM research">
        <ActiveResearchView research={activeResearch} />
      </Section>

      <Section title="Collectibles">
        <ul className="space-y-1 text-sm text-neutral-300">
          <li>{formatHardDriveResults(collectibles.hardDriveResultsAwaitingClaim)}</li>
          <li>{formatAlternates(collectibles.alternateRecipesUnlocked)}</li>
          <li className="text-neutral-500">
            {playDurationSeconds === null
              ? "Playtime unknown"
              : `${formatDuration(playDurationSeconds * 1000)} played`}
          </li>
        </ul>
      </Section>
    </PanelFrame>
  );
}

function CurrentMilestoneView({ milestone }: { milestone: CurrentMilestone | null }): JSX.Element {
  if (!milestone) {
    return <p className="text-sm text-neutral-600">No milestone in progress.</p>;
  }

  return (
    <div>
      <div className="mb-1.5 text-sm text-neutral-100">{milestone.displayName}</div>
      {milestone.ingredients.length === 0 ? (
        <p className="text-xs text-neutral-600">No ingredient costs known.</p>
      ) : (
        <ul className="space-y-1.5">
          {milestone.ingredients.map((ingredient) => (
            <IngredientProgress key={ingredient.className} ingredient={ingredient} />
          ))}
        </ul>
      )}
    </div>
  );
}

function IngredientProgress({ ingredient }: { ingredient: MilestoneIngredient }): JSX.Element {
  const percent = ingredientPercent(ingredient);
  const complete = ingredient.amount >= ingredient.targetAmount;

  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="truncate text-neutral-300">{ingredient.displayName}</span>
        <span className={complete ? "text-neutral-500" : "text-neutral-300"}>
          {ingredient.amount.toLocaleString()} / {ingredient.targetAmount.toLocaleString()}
        </span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-neutral-800">
        <div className="h-full rounded-full bg-ficsit-orange" style={{ width: `${percent}%` }} />
      </div>
    </li>
  );
}

function ActiveResearchView({ research }: { research: ActiveResearch[] }): JSX.Element {
  if (research.length === 0) {
    return <p className="text-sm text-neutral-600">No research in progress.</p>;
  }

  return (
    <ul className="space-y-1 text-sm">
      {research.map((entry) => (
        <li key={entry.className} className="flex items-baseline justify-between gap-2">
          <span className="truncate text-neutral-300">{entry.displayName}</span>
          <span className="text-neutral-500">
            {entry.secondsRemaining === null
              ? "in progress"
              : `${formatDuration(entry.secondsRemaining * 1000)} left`}
          </span>
        </li>
      ))}
    </ul>
  );
}
