import { describe, expect, it } from "vitest";
import { chooseBaselineSave, type SaveCandidate } from "./followedSession.ts";
import type { SaveHeader } from "./saveHeader.ts";

function candidate(overrides: {
  path: string;
  sessionName: string;
  saveDateTime: number;
  mtimeMs?: number;
}): SaveCandidate {
  const header: SaveHeader = {
    headerVersion: 14,
    saveVersion: 60,
    buildVersion: 495413,
    saveName: overrides.path,
    mapName: "Persistent_Level",
    sessionName: overrides.sessionName,
    playDurationSeconds: 100,
    saveDateTime: overrides.saveDateTime,
  };
  return { path: overrides.path, header, mtimeMs: overrides.mtimeMs ?? overrides.saveDateTime };
}

describe("chooseBaselineSave", () => {
  it("follows the newest save by header SaveDateTime, not by filename", () => {
    // Autosave slots rotate, so slot 0 can easily be the newest — and a player can
    // name a manual save anything at all. Only the header orders saves.
    const choice = chooseBaselineSave({
      candidates: [
        candidate({ path: "zzz_autosave_2.sav", sessionName: "A", saveDateTime: 1000 }),
        candidate({ path: "aaa_autosave_0.sav", sessionName: "A", saveDateTime: 3000 }),
        candidate({ path: "mmm_autosave_1.sav", sessionName: "A", saveDateTime: 2000 }),
      ],
      liveSessionName: null,
      followedSessionName: "A",
    });

    expect(choice?.save.path).toBe("aaa_autosave_0.sav");
  });

  it("breaks an exact SaveDateTime tie by modification time", () => {
    const choice = chooseBaselineSave({
      candidates: [
        candidate({ path: "first.sav", sessionName: "A", saveDateTime: 5000, mtimeMs: 90 }),
        candidate({ path: "second.sav", sessionName: "A", saveDateTime: 5000, mtimeMs: 99 }),
      ],
      liveSessionName: null,
      followedSessionName: "A",
    });

    expect(choice?.save.path).toBe("second.sav");
  });

  it("never lets modification time outrank the header save time", () => {
    // Steam Cloud can rewrite files in the save directory long after the game did,
    // which moves mtime without changing what the save contains.
    const choice = chooseBaselineSave({
      candidates: [
        candidate({ path: "older.sav", sessionName: "A", saveDateTime: 1000, mtimeMs: 9999 }),
        candidate({ path: "newer.sav", sessionName: "A", saveDateTime: 2000, mtimeMs: 1 }),
      ],
      liveSessionName: null,
      followedSessionName: "A",
    });

    expect(choice?.save.path).toBe("newer.sav");
  });

  it("returns nothing when the directory holds no readable save", () => {
    expect(
      chooseBaselineSave({ candidates: [], liveSessionName: null, followedSessionName: null }),
    ).toBeNull();
  });
});

describe("chooseBaselineSave — held saves", () => {
  const saves = [
    candidate({ path: "old-session.sav", sessionName: "Random Defaults", saveDateTime: 1000 }),
    candidate({ path: "new-session.sav", sessionName: "Dune Desert", saveDateTime: 2000 }),
  ];

  it("holds a save belonging to a session the live feed is not streaming", () => {
    // Aaron loads a different world mid-play: its autosaves are newest on disk but
    // describe a world the live feed knows nothing about.
    const choice = chooseBaselineSave({
      candidates: saves,
      liveSessionName: "Random Defaults",
      followedSessionName: "Random Defaults",
    });

    expect(choice?.save.path).toBe("new-session.sav");
    expect(choice?.disposition).toBe("held");
  });

  it("merges a save whose session matches the live feed", () => {
    const choice = chooseBaselineSave({
      candidates: [
        candidate({ path: "match.sav", sessionName: "Random Defaults", saveDateTime: 9 }),
      ],
      liveSessionName: "Random Defaults",
      followedSessionName: "Random Defaults",
    });

    expect(choice?.disposition).toBe("merged");
  });

  it("merges the newest save outright when the live feed is down", () => {
    // With no live feed there is no competing session identity to contradict, so
    // newest wins even though it belongs to a different world than before.
    const choice = chooseBaselineSave({
      candidates: saves,
      liveSessionName: null,
      followedSessionName: "Random Defaults",
    });

    expect(choice?.save.path).toBe("new-session.sav");
    expect(choice?.disposition).toBe("merged");
  });
});

describe("chooseBaselineSave — session changes", () => {
  it("flags a session change when the merged save belongs to another session", () => {
    const choice = chooseBaselineSave({
      candidates: [candidate({ path: "other.sav", sessionName: "Dune Desert", saveDateTime: 1 })],
      liveSessionName: null,
      followedSessionName: "Random Defaults",
    });

    expect(choice?.sessionChanged).toBe(true);
  });

  it("flags a session change for the very first save followed", () => {
    const choice = chooseBaselineSave({
      candidates: [candidate({ path: "first.sav", sessionName: "Dune Desert", saveDateTime: 1 })],
      liveSessionName: null,
      followedSessionName: null,
    });

    expect(choice?.sessionChanged).toBe(true);
  });

  it("does not flag a session change for a held save", () => {
    // A held save never becomes the followed session, so it must not trigger the
    // reset that a real session change does.
    const choice = chooseBaselineSave({
      candidates: [candidate({ path: "other.sav", sessionName: "Dune Desert", saveDateTime: 1 })],
      liveSessionName: "Random Defaults",
      followedSessionName: "Random Defaults",
    });

    expect(choice?.disposition).toBe("held");
    expect(choice?.sessionChanged).toBe(false);
  });

  it("does not flag a session change when the save continues the followed session", () => {
    const choice = chooseBaselineSave({
      candidates: [
        candidate({ path: "same.sav", sessionName: "Random Defaults", saveDateTime: 1 }),
      ],
      liveSessionName: null,
      followedSessionName: "Random Defaults",
    });

    expect(choice?.sessionChanged).toBe(false);
  });
});
