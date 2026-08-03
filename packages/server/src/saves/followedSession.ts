/**
 * The auto-follow rules, as pure decisions over save headers.
 *
 * v1 has no session picker: the dashboard follows the newest save by header
 * `SaveDateTime`, and while the live feed is up, its session identity is
 * authoritative — a newest save belonging to some other session is parsed but
 * **held**, never merged, so WorldState can't become a chimera of two worlds
 * (spec, "Followed session and merge rules"; CONTEXT.md, "Held save").
 *
 * Everything here is a pure function of the candidates and the two session names,
 * which keeps the rules testable away from the filesystem and the parser.
 */
import type { SaveHeader } from "./saveHeader.ts";

/** A save file on disk, identified by its header rather than its name. */
export interface SaveCandidate {
  path: string;
  header: SaveHeader;
  /** Filesystem modification time; used only to break exact header-time ties. */
  mtimeMs: number;
}

/**
 * What to do with a chosen save: fold it into WorldState as the new baseline, or
 * keep it aside because it describes a session the dashboard is not following.
 */
export type SaveDisposition = "merged" | "held";

export interface BaselineChoice {
  save: SaveCandidate;
  disposition: SaveDisposition;
  /**
   * True when merging this save moves the dashboard to a different session — the
   * trigger for a silent full reset of WorldState and the sparkline window.
   */
  sessionChanged: boolean;
}

export interface ChooseBaselineArgs {
  candidates: SaveCandidate[];
  /** Session the live feed is streaming, or null when it is down. */
  liveSessionName: string | null;
  /** Session WorldState currently describes, or null before anything is followed. */
  followedSessionName: string | null;
}

/**
 * Pick the save the dashboard should act on and say what may be done with it, or
 * null when there is nothing to act on.
 *
 * Ordering is by header `SaveDateTime`; modification time breaks exact ties only,
 * because Steam Cloud and file copies move mtime without the save's contents
 * changing. Disposition follows the live feed: while it is up, only a save from
 * the session it streams may merge; while it is down, newest wins outright.
 */
export function chooseBaselineSave(args: ChooseBaselineArgs): BaselineChoice | null {
  const save = newestSave(args.candidates);
  if (!save) return null;

  const sessionName = save.header.sessionName;
  const disposition: SaveDisposition =
    args.liveSessionName !== null && args.liveSessionName !== sessionName ? "held" : "merged";

  return {
    save,
    disposition,
    sessionChanged: disposition === "merged" && sessionName !== args.followedSessionName,
  };
}

function newestSave(candidates: SaveCandidate[]): SaveCandidate | undefined {
  let newest: SaveCandidate | undefined;
  for (const candidate of candidates) {
    if (!newest || isNewer(candidate, newest)) newest = candidate;
  }
  return newest;
}

function isNewer(candidate: SaveCandidate, than: SaveCandidate): boolean {
  if (candidate.header.saveDateTime !== than.header.saveDateTime) {
    return candidate.header.saveDateTime > than.header.saveDateTime;
  }
  return candidate.mtimeMs > than.mtimeMs;
}
