import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { InvalidSaveError } from "./saveHeader.ts";
import { buildSaveFile } from "./saveTestSupport.ts";
import { readValidatedSave } from "./validatedSave.ts";

let directory: string;

const fields = {
  sessionName: "Random Defaults",
  saveName: "Random Defaults_autosave_0",
  saveDateTimeMs: 1_700_000_000_000,
};

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "scc-snapshot-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function savePath(): string {
  return path.join(directory, "Random Defaults_autosave_0.sav");
}

describe("readValidatedSave", () => {
  it("returns the header and the whole file for a complete save", async () => {
    const bytes = buildSaveFile(fields);
    await writeFile(savePath(), bytes);

    const validated = await readValidatedSave(savePath());

    expect(validated.header.sessionName).toBe("Random Defaults");
    expect(validated.bytes.byteLength).toBe(bytes.length);
  });

  it("retries until the game finishes writing the save", async () => {
    // What an autosave in progress looks like: the file is there, but its body
    // stops short of the length its chunk header promises.
    await writeFile(savePath(), buildSaveFile(fields, { truncateBody: true }));
    setTimeout(() => void writeFile(savePath(), buildSaveFile(fields)), 20);

    const validated = await readValidatedSave(savePath(), { attempts: 6, retryDelayMs: 15 });

    expect(validated.header.sessionName).toBe("Random Defaults");
  });

  it("gives up on a save that never becomes whole", async () => {
    await writeFile(savePath(), buildSaveFile(fields, { truncateBody: true }));

    await expect(readValidatedSave(savePath(), { attempts: 3, retryDelayMs: 1 })).rejects.toThrow(
      InvalidSaveError,
    );
  });

  it("does not retry a file that simply is not there", async () => {
    // A missing file is not a sharing violation; retrying it just wastes the
    // backoff budget a genuinely-being-written save needs.
    await expect(readValidatedSave(path.join(directory, "gone.sav"))).rejects.toThrow(/ENOENT/);
  });
});
