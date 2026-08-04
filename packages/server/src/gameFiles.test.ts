import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findDocsFile, findIconsDirectory, findSaveDirectory } from "./gameFiles.ts";

let root: string;
const originalEnv = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "scc-install-"));
  delete process.env.SCC_SAVE_DIR;
  delete process.env.SCC_DOCS_FILE;
  delete process.env.SCC_ICONS_DIR;
  delete process.env.LOCALAPPDATA;
});

afterEach(async () => {
  process.env = { ...originalEnv };
  await rm(root, { recursive: true, force: true });
});

/** Lay out an account folder with a save written at the given time. */
async function accountFolder(saveGames: string, accountId: string, savedAt: Date): Promise<string> {
  const directory = path.join(saveGames, accountId);
  await mkdir(directory, { recursive: true });
  const save = path.join(directory, "Random Defaults_autosave_0.sav");
  await writeFile(save, "save bytes");
  await utimes(save, savedAt, savedAt);
  return directory;
}

describe("findSaveDirectory", () => {
  it("uses the override, which is how a Windows install is watched from WSL", async () => {
    process.env.SCC_SAVE_DIR = root;

    expect(await findSaveDirectory()).toBe(root);
  });

  it("reports nothing when the override points somewhere that isn't there", async () => {
    process.env.SCC_SAVE_DIR = path.join(root, "nope");

    expect(await findSaveDirectory()).toBeNull();
  });

  it("picks the account whose saves were written most recently", async () => {
    // Account-id folders are numeric; several can exist if more than one Steam or
    // Epic account has played on the machine.
    const saveGames = path.join(root, "FactoryGame", "Saved", "SaveGames");
    await accountFolder(saveGames, "76561197960567417", new Date("2026-08-03T08:00:00Z"));
    const current = await accountFolder(
      saveGames,
      "76561198000000000",
      new Date("2026-08-03T12:00:00Z"),
    );
    // `blueprints` sits alongside the account folders and must not be mistaken
    // for one.
    await mkdir(path.join(saveGames, "blueprints"), { recursive: true });
    process.env.LOCALAPPDATA = root;

    expect(await findSaveDirectory()).toBe(current);
  });

  it("reports nothing when the machine has no game install", async () => {
    process.env.LOCALAPPDATA = root;

    expect(await findSaveDirectory()).toBeNull();
  });
});

describe("findDocsFile", () => {
  it("uses the override", async () => {
    const docs = path.join(root, "en-US.json");
    await writeFile(docs, "[]");
    process.env.SCC_DOCS_FILE = docs;

    expect(await findDocsFile()).toBe(docs);
  });

  it("reports nothing when the override points at a file that isn't there", async () => {
    process.env.SCC_DOCS_FILE = path.join(root, "missing.json");

    expect(await findDocsFile()).toBeNull();
  });

  it("finds the Docs file under a Steam install", async () => {
    const install = path.join(root, "Steam", "steamapps", "common", "Satisfactory");
    const docsDir = path.join(install, "CommunityResources", "Docs");
    await mkdir(docsDir, { recursive: true });
    const docs = path.join(docsDir, "en-US.json");
    await writeFile(docs, "[]");
    process.env["ProgramFiles(x86)"] = root;

    expect(await findDocsFile()).toBe(docs);
  });
});

describe("findIconsDirectory", () => {
  it("uses the override", async () => {
    process.env.SCC_ICONS_DIR = root;

    expect(await findIconsDirectory()).toBe(root);
  });

  it("reports nothing when unconfigured — icon extraction is a manual step", async () => {
    expect(await findIconsDirectory()).toBeNull();
  });

  it("reports nothing when the override points somewhere that isn't there", async () => {
    process.env.SCC_ICONS_DIR = path.join(root, "nope");

    expect(await findIconsDirectory()).toBeNull();
  });
});
