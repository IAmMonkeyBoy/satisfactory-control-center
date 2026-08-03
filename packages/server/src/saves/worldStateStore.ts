/**
 * The in-memory WorldState the dashboard reads from.
 *
 * There is no database (ADR 0002): this holder *is* the state. Build 2 filled it
 * from one ingestor, the save watcher, so every domain carried a `baseline` tag.
 * Build 3 adds the live feed on top: power, production and storage can each be
 * overridden by the most recent FRM push, independently of one another, which is
 * what per-domain source/age tags exist to make honest — power can be live while
 * storage is still waiting on its first push, or has fallen back after FRM dropped.
 * Milestones has no live source in this build, so it stays baseline-only.
 *
 * A session change wipes it rather than merging into it — cross-session history is
 * explicitly not a thing v1 keeps (CONTEXT.md, "Followed session"). Deciding *when*
 * a session has changed is the caller's job (the save watcher and the live
 * ingestor each own that decision for their own source); the store just holds
 * what it's told and never second-guesses it.
 */
import type {
  MilestonesState,
  PowerState,
  ProductionState,
  Source,
  StorageState,
  WorldState,
} from "@scc/shared";
import { emptyBaselineDomains, type BaselineDomains } from "./extractBaseline.ts";
import type { SaveHeader } from "./saveHeader.ts";

/** The live-feed domains a single FRM push can update. Any subset may be present:
 *  FRM pushes one subscribed endpoint at a time. */
export interface LiveDomainUpdate {
  power?: PowerState;
  production?: ProductionState;
  storage?: StorageState;
}

export interface ApplyLiveDomainsArgs {
  /** The session this push describes — FRM's session identity is authoritative
   *  while live, so the store trusts it without re-checking. */
  sessionName: string;
  capturedAt: number;
}

export interface WorldStateStore {
  /** The current WorldState, stamped with when it was assembled. */
  snapshot(now: number): WorldState;
  /** Replace the baseline from a save that has been accepted for merging. */
  applyBaseline(baseline: BaselineDomains, header: SaveHeader): void;
  /** Merge a live push into whichever domains it carries. */
  applyLiveDomains(update: LiveDomainUpdate, args: ApplyLiveDomainsArgs): void;
  /** FRM has gone down (or dropped to unreachable): every domain it was
   *  supplying falls back to baseline immediately, ages and all. */
  clearLive(): void;
  /** Drop everything, as a session change requires. */
  reset(): void;
  /** The session currently followed, or null before any save has been accepted. */
  followedSessionName(): string | null;
}

interface LiveDomainEntry<T> {
  data: T;
  capturedAt: number;
}

/** Everything the store holds: the followed session, its baseline, and whatever
 *  the live feed has supplied on top. */
interface StoreState {
  followedSessionName: string | null;
  /** `exists` is false until the first save is accepted — distinct from a save
   *  genuinely captured at epoch 0. Without it, a session known only from FRM
   *  (no save has ever been parsed for it) would report a fabricated baseline
   *  at `capturedAt: 0` the moment `clearLive` runs, rather than admitting no
   *  baseline backs it. */
  baseline: { exists: boolean; capturedAt: number; domains: BaselineDomains };
  /** `connected` gates whether live entries are *authoritative* — `clearLive`
   *  flips it off without discarding `followedSessionName` or the entries
   *  themselves, since the session being followed doesn't change just because
   *  its transport did, and a stale-but-real live reading is more honest than
   *  a fabricated baseline when there is no baseline to fall back to. */
  live: {
    connected: boolean;
    /** When the most recent live push of any kind landed, independent of which
     *  domain it carried — the followed session's own freshness. */
    lastMessageAt: number;
    power?: LiveDomainEntry<PowerState>;
    production?: LiveDomainEntry<ProductionState>;
    storage?: LiveDomainEntry<StorageState>;
  };
}

function emptyState(): StoreState {
  return {
    followedSessionName: null,
    baseline: { exists: false, capturedAt: 0, domains: emptyBaselineDomains() },
    live: { connected: false, lastMessageAt: 0 },
  };
}

/**
 * The source/age tag for one piece of data, given what's available for it.
 * Live wins while connected; baseline wins once live drops, but only when a
 * baseline genuinely exists — a session confirmed purely by FRM, disconnected
 * before any save was ever accepted for it, has no baseline to fall back to,
 * so the last live reading (now aging, honestly) is reported instead of a
 * fabricated `capturedAt: 0` baseline. Only when neither has ever reported
 * anything does this fall through to the empty baseline default, matching the
 * pre-any-ingestor startup state.
 */
function resolveTag(
  hasLive: boolean,
  liveConnected: boolean,
  liveCapturedAt: number,
  baselineExists: boolean,
  baselineCapturedAt: number,
): { source: Source; capturedAt: number } {
  if (liveConnected && hasLive) return { source: "live", capturedAt: liveCapturedAt };
  if (baselineExists) return { source: "baseline", capturedAt: baselineCapturedAt };
  if (hasLive) return { source: "live", capturedAt: liveCapturedAt };
  return { source: "baseline", capturedAt: baselineCapturedAt };
}

/** Resolve one domain's data alongside its tag, via {@link resolveTag}. */
function resolveDomain<T>(
  live: LiveDomainEntry<T> | undefined,
  liveConnected: boolean,
  baselineExists: boolean,
  baselineData: T,
  baselineCapturedAt: number,
): { tag: { source: Source; capturedAt: number }; data: T } {
  const tag = resolveTag(
    live !== undefined,
    liveConnected,
    live?.capturedAt ?? 0,
    baselineExists,
    baselineCapturedAt,
  );
  return tag.source === "live" && live ? { tag, data: live.data } : { tag, data: baselineData };
}

export function createWorldStateStore(): WorldStateStore {
  let state: StoreState = emptyState();

  return {
    snapshot(now: number): WorldState {
      const { baseline, live, followedSessionName } = state;
      const baselineTag = { source: "baseline" as const, capturedAt: baseline.capturedAt };

      const power = resolveDomain(
        live.power,
        live.connected,
        baseline.exists,
        baseline.domains.power satisfies PowerState,
        baseline.capturedAt,
      );
      const production = resolveDomain(
        live.production,
        live.connected,
        baseline.exists,
        baseline.domains.production satisfies ProductionState,
        baseline.capturedAt,
      );
      const storage = resolveDomain(
        live.storage,
        live.connected,
        baseline.exists,
        baseline.domains.storage satisfies StorageState,
        baseline.capturedAt,
      );

      return {
        generatedAt: now,
        followedSession:
          followedSessionName === null
            ? null
            : {
                sessionName: followedSessionName,
                ...resolveTag(
                  live.lastMessageAt > 0,
                  live.connected,
                  live.lastMessageAt,
                  baseline.exists,
                  baseline.capturedAt,
                ),
              },
        power,
        production,
        storage,
        milestones: {
          tag: baselineTag,
          data: baseline.domains.milestones satisfies MilestonesState,
        },
      };
    },

    applyBaseline(baseline: BaselineDomains, header: SaveHeader): void {
      state = {
        ...state,
        followedSessionName: header.sessionName,
        baseline: { exists: true, capturedAt: header.saveDateTime, domains: baseline },
      };
    },

    applyLiveDomains(update: LiveDomainUpdate, args: ApplyLiveDomainsArgs): void {
      const entry = <T>(data: T): LiveDomainEntry<T> => ({ data, capturedAt: args.capturedAt });
      state = {
        ...state,
        followedSessionName: args.sessionName,
        live: {
          connected: true,
          lastMessageAt: args.capturedAt,
          power: update.power ? entry(update.power) : state.live.power,
          production: update.production ? entry(update.production) : state.live.production,
          storage: update.storage ? entry(update.storage) : state.live.storage,
        },
      };
    },

    clearLive(): void {
      // Only the `connected` flag flips: the entries themselves stay, as the
      // last-resort fallback `resolveTag`/`resolveDomain` use when there is no
      // baseline yet to fall back to instead. A later `applyLiveDomains` for
      // the same session overwrites them; a session change goes through
      // `reset`, which drops them for real.
      state = { ...state, live: { ...state.live, connected: false } };
    },

    reset(): void {
      state = emptyState();
    },

    followedSessionName(): string | null {
      return state.followedSessionName;
    },
  };
}
