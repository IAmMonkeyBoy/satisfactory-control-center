import type { JSX } from "react";
import type { WorldState } from "@scc/shared";
import { FreshnessTag } from "./FreshnessTag";

/**
 * Read-only session name + source + data age (spec, "Following indicator") —
 * no session controls. Updates live as WorldState pushes arrive, so a session
 * hand-off between the live feed and baseline is always explainable at a glance.
 */
export function FollowingIndicator({
  worldState,
  now,
}: {
  worldState: WorldState;
  now: number;
}): JSX.Element {
  const { followedSession } = worldState;
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="font-semibold tracking-wide text-neutral-100">
        {followedSession?.sessionName ?? "No session yet"}
      </span>
      {followedSession && (
        <span className="text-neutral-400">
          <FreshnessTag tag={followedSession} now={now} />
        </span>
      )}
    </div>
  );
}
