import { describe, expect, it } from "vitest";
import { InvalidSaveError, readSaveHeader, validateSaveFile } from "./saveHeader.ts";
import { buildSaveFile, buildSaveHeader } from "./saveTestSupport.ts";

const fields = {
  sessionName: "Random Defaults",
  saveName: "Random Defaults_autosave_2",
  saveDateTimeMs: 1785763366427,
};

describe("readSaveHeader", () => {
  it("reads the session identity and save time the dashboard follows by", () => {
    const header = readSaveHeader(buildSaveHeader(fields));

    expect(header.sessionName).toBe("Random Defaults");
    expect(header.saveName).toBe("Random Defaults_autosave_2");
    expect(header.saveDateTime).toBe(1785763366427);
  });

  it("rejects a header that ends mid-field", () => {
    const bytes = buildSaveHeader(fields);

    // A file caught halfway through being written stops in the middle of a field.
    expect(() => readSaveHeader(bytes.subarray(0, 24))).toThrow(InvalidSaveError);
  });

  it("rejects a string field claiming more bytes than the file holds", () => {
    const bytes = buildSaveHeader(fields);
    // Overstate the saveName length so the reader would run off the end.
    bytes.writeInt32LE(1 << 20, 12);

    expect(() => readSaveHeader(bytes)).toThrow(InvalidSaveError);
  });
});

describe("validateSaveFile", () => {
  it("accepts a complete save and returns its header", () => {
    const header = validateSaveFile(buildSaveFile(fields));

    expect(header.sessionName).toBe("Random Defaults");
  });

  it("rejects a body whose chunk magic is wrong", () => {
    // The game writes no atomic temp-then-rename, so a half-written body can hold
    // anything at all where the Unreal package tag belongs.
    const bytes = buildSaveFile(fields, { corruptChunkMagic: true });

    expect(() => validateSaveFile(bytes)).toThrow(InvalidSaveError);
  });

  it("rejects a body that stops short of its declared compressed length", () => {
    const bytes = buildSaveFile(fields, { truncateBody: true });

    expect(() => validateSaveFile(bytes)).toThrow(InvalidSaveError);
  });

  it("rejects a chunk whose payload is not zlib", () => {
    const bytes = buildSaveFile(fields, { garbageChunkPayload: true });

    expect(() => validateSaveFile(bytes)).toThrow(InvalidSaveError);
  });

  it("rejects a save with no body at all", () => {
    expect(() => validateSaveFile(buildSaveHeader(fields))).toThrow(InvalidSaveError);
  });
});
