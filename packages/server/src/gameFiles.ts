/**
 * Finding the game's files on this machine.
 *
 * Both locations are read-only inputs owned by the player's own install: the save
 * directory (watched, never written) and the static-data dump (read at startup,
 * never vendored into the repo — it ships with no licence, and the recipes must
 * match the install that wrote the save anyway).
 *
 * Every probe can be overridden by environment variable, which is also how the
 * server is pointed at a Windows install from a WSL or Linux shell.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/** Point the watcher at a specific SaveGames folder. */
const SAVE_DIR_ENV = "SCC_SAVE_DIR";

/** Point the static-data loader at a specific `en-US.json`. */
const DOCS_FILE_ENV = "SCC_DOCS_FILE";

/** Point the codex popover's icon lookup at a directory of extracted icon
 *  images. Unlike the save directory and Docs file, this has no on-disk
 *  default to probe for: icon extraction is a manual step Aaron does
 *  himself (spec, "Licensing constraints" — nothing extracted is ever
 *  vendored), so there is no install-relative path to guess. */
const ICONS_DIR_ENV = "SCC_ICONS_DIR";

const DOCS_RELATIVE_PATH = path.join("CommunityResources", "Docs", "en-US.json");

/**
 * Locate the per-user SaveGames folder, or null when there is no install here.
 *
 * Saves live under `%LOCALAPPDATA%\FactoryGame\Saved\SaveGames\<account id>`; the
 * account id is a SteamID64 or Epic account id, so the folder is found by shape
 * rather than by name. If several accounts have played on this machine, the one
 * with the most recently written save is the one Aaron is using.
 */
export async function findSaveDirectory(): Promise<string | null> {
  const override = process.env[SAVE_DIR_ENV];
  if (override) return (await isDirectory(override)) ? override : null;

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;

  const root = path.join(localAppData, "FactoryGame", "Saved", "SaveGames");
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return null;
  }

  let best: { directory: string; mtimeMs: number } | null = null;
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue; // account-id folders only; skip `blueprints`
    const directory = path.join(root, entry);
    const mtimeMs = await newestSaveTime(directory);
    if (mtimeMs !== null && (best === null || mtimeMs > best.mtimeMs)) {
      best = { directory, mtimeMs };
    }
  }
  return best?.directory ?? null;
}

/** Locate the game's `en-US.json`, or null when there is no install here. */
export async function findDocsFile(): Promise<string | null> {
  const override = process.env[DOCS_FILE_ENV];
  if (override) return (await isFile(override)) ? override : null;

  const programFiles = [
    process.env["ProgramFiles(x86)"],
    process.env.ProgramFiles,
    "C:\\Program Files (x86)",
    "C:\\Program Files",
  ].filter((value): value is string => Boolean(value));

  const installs = [
    path.join("Steam", "steamapps", "common", "Satisfactory"),
    path.join("Epic Games", "Satisfactory"),
    path.join("Epic Games", "SatisfactoryEarlyAccess"),
  ];

  for (const root of programFiles) {
    for (const install of installs) {
      const candidate = path.join(root, install, DOCS_RELATIVE_PATH);
      if (await isFile(candidate)) return candidate;
    }
  }
  return null;
}

/** Locate the icon image directory, or null when none is configured. */
export async function findIconsDirectory(): Promise<string | null> {
  const override = process.env[ICONS_DIR_ENV];
  if (!override) return null;
  return (await isDirectory(override)) ? override : null;
}

async function newestSaveTime(directory: string): Promise<number | null> {
  let newest: number | null = null;
  try {
    for (const name of await readdir(directory)) {
      if (!name.toLowerCase().endsWith(".sav")) continue;
      const { mtimeMs } = await stat(path.join(directory, name));
      if (newest === null || mtimeMs > newest) newest = mtimeMs;
    }
  } catch {
    return null;
  }
  return newest;
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}
