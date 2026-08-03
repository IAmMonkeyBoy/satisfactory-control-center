import { afterEach, describe, expect, it } from "vitest";
import { createWorkerSaveParser, type SaveParser } from "./saveParseClient.ts";
import { moduleSibling } from "../moduleSibling.ts";

let parser: SaveParser | undefined;

afterEach(async () => {
  await parser?.close();
  parser = undefined;
});

/**
 * A stand-in worker that burns CPU for a fixed stretch before replying. It stands
 * in for a real save parse, which is seconds of solid CPU, without needing an
 * 11 MB save file that CI has no way to obtain.
 */
const blockingWorker = moduleSibling(import.meta.url, "blockingParserTestWorker");

describe("worker save parsing", () => {
  it("returns the baseline the worker extracted", async () => {
    parser = createWorkerSaveParser({ docsPath: null, workerUrl: blockingWorker });

    const baseline = await parser.parse(new ArrayBuffer(8));

    expect(baseline.storage.items).toEqual([
      { className: "Desc_IronPlate_C", displayName: "Iron Plate", count: 42 },
    ]);
  });

  it("keeps the main thread responsive while a save parses", async () => {
    // The whole reason parsing lives in a worker (ADR 0001): the SSE stream has to
    // keep pushing while a large save is being read.
    parser = createWorkerSaveParser({ docsPath: null, workerUrl: blockingWorker });

    let ticks = 0;
    const timer = setInterval(() => ticks++, 5);
    try {
      await parser.parse(new ArrayBuffer(8));
    } finally {
      clearInterval(timer);
    }

    // The fixture worker blocks for ~200 ms; a stalled main thread would tick
    // barely at all, while a free one gets tens of turns in.
    expect(ticks).toBeGreaterThan(10);
  });

  it("surfaces a parse failure as a rejection rather than a hang", async () => {
    parser = createWorkerSaveParser({ docsPath: null, workerUrl: blockingWorker });

    // The fixture worker fails on an empty buffer, standing in for bytes the real
    // parser cannot make sense of.
    await expect(parser.parse(new ArrayBuffer(0))).rejects.toThrow(/refused/);
  });

  it("serves several parses from the one worker", async () => {
    parser = createWorkerSaveParser({ docsPath: null, workerUrl: blockingWorker });

    const [first, second] = await Promise.all([
      parser.parse(new ArrayBuffer(8)),
      parser.parse(new ArrayBuffer(8)),
    ]);

    expect(first.storage.items).toEqual(second.storage.items);
  });

  it("rejects in-flight parses when the parser is closed", async () => {
    parser = createWorkerSaveParser({ docsPath: null, workerUrl: blockingWorker });

    const pending = parser.parse(new ArrayBuffer(8));
    await parser.close();
    parser = undefined;

    await expect(pending).rejects.toThrow();
  });
});
