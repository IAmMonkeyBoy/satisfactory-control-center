/**
 * The in-memory WorldState the dashboard reads from.
 *
 * There is no database (ADR 0002): this holder *is* the state. Build 2 fills it
 * from one ingestor, the save watcher, so every domain here carries a `baseline`
 * tag; Build 3 adds the live feed on top, and the per-domain tags are what let the
 * two sources coexist without the UI ever having to guess which it is looking at.
 *
 * A session change wipes it rather than merging into it — cross-session history is
 * explicitly not a thing v1 keeps (CONTEXT.md, "Followed session").
 */
import type {
  MilestonesState,
  PowerState,
  ProductionState,
  StorageState,
  WorldState,
} from "@scc/shared";
import { emptyBaselineDomains, type BaselineDomains } from "./extractBaseline.ts";
import type { SaveHeader } from "./saveHeader.ts";

export interface WorldStateStore {
  /** The current WorldState, stamped with when it was assembled. */
  snapshot(now: number): WorldState;
  /** Replace the baseline from a save that has been accepted for merging. */
  applyBaseline(baseline: BaselineDomains, header: SaveHeader): void;
  /** Drop everything, as a session change requires. */
  reset(): void;
  /** The session currently followed, or null before any save has been accepted. */
  followedSessionName(): string | null;
}

/** Everything the store holds: the followed session and its baseline. */
interface StoreState {
  followedSessionName: string | null;
  capturedAt: number;
  domains: BaselineDomains;
}

function emptyState(): StoreState {
  return { followedSessionName: null, capturedAt: 0, domains: emptyBaselineDomains() };
}

export function createWorldStateStore(): WorldStateStore {
  let state: StoreState = emptyState();

  return {
    snapshot(now: number): WorldState {
      // Every domain here came from the same save, so they share one tag: sourced
      // from the baseline, aged from the save's own header time rather than from
      // when the server got round to reading it.
      const tag = { source: "baseline" as const, capturedAt: state.capturedAt };
      return {
        generatedAt: now,
        followedSession:
          state.followedSessionName === null ? null : { sessionName: state.followedSessionName },
        power: { tag, data: state.domains.power satisfies PowerState },
        production: { tag, data: state.domains.production satisfies ProductionState },
        storage: { tag, data: state.domains.storage satisfies StorageState },
        milestones: { tag, data: state.domains.milestones satisfies MilestonesState },
      };
    },

    applyBaseline(baseline: BaselineDomains, header: SaveHeader): void {
      state = {
        followedSessionName: header.sessionName,
        capturedAt: header.saveDateTime,
        domains: baseline,
      };
    },

    reset(): void {
      state = emptyState();
    },

    followedSessionName(): string | null {
      return state.followedSessionName;
    },
  };
}
