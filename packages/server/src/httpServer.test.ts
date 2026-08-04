import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  deserializeEvent,
  type CodexEntry,
  type CodexKind,
  type MapSnapshot,
  type StorageSearchResponse,
  type WorldState,
} from "@scc/shared";
import { createServer, type ServerOptions } from "./httpServer.ts";
import {
  boundPort,
  sampleCodexEntry,
  sampleMapSnapshot,
  sampleStorageSearchResponse,
  sampleWorldState,
} from "./testSupport.ts";

let server: Server | undefined;
let lastSearchQuery: string | undefined;
let lastCodexLookup: { kind: CodexKind; className: string } | undefined;

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  lastSearchQuery = undefined;
  lastCodexLookup = undefined;
});

async function listen(overrides: Partial<ServerOptions> = {}): Promise<number> {
  server = createServer({
    pushIntervalMs: 20,
    buildWorldState: sampleWorldState,
    searchStorage: (query) => {
      lastSearchQuery = query;
      return sampleStorageSearchResponse(query);
    },
    buildMapSnapshot: sampleMapSnapshot,
    lookupCodex: (kind, className) => {
      lastCodexLookup = { kind, className };
      return className === "Desc_Unknown_C" ? null : sampleCodexEntry(kind, className);
    },
    resolveIconPath: () => null,
    ...overrides,
  });
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  return boundPort(server);
}

/** Read the `data:` payloads of the first `count` complete SSE frames. */
async function readEventData(body: ReadableStream<Uint8Array>, count: number): Promise<string[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  let buffer = "";
  try {
    while (frames.length < count) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended before enough events arrived");
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1 && frames.length < count) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) throw new Error("SSE frame had no data line");
        frames.push(dataLine.slice("data:".length).trim());
        boundary = buffer.indexOf("\n\n");
      }
    }
    return frames;
  } finally {
    await reader.cancel();
  }
}

function expectValidWorldState(ws: WorldState): void {
  expect(typeof ws.generatedAt).toBe("number");
  expect(ws.followedSession?.sessionName).toBeTruthy();
  // Every domain must carry a source/age tag — the freshness contract.
  for (const domain of [ws.power, ws.production, ws.storage, ws.milestones]) {
    expect(["live", "baseline"]).toContain(domain.tag.source);
    expect(typeof domain.tag.capturedAt).toBe("number");
  }
  expect(ws.power.data.circuits.length).toBeGreaterThan(0);
}

describe("SSE transport contract", () => {
  it("pushes a typed WorldState snapshot that round-trips server -> client", async () => {
    const port = await listen();

    const res = await fetch(`http://localhost:${port}/api/stream`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.body).not.toBeNull();

    const [raw] = await readEventData(res.body!, 1);
    const event = deserializeEvent(raw!);

    expect(event.type).toBe("snapshot");
    expectValidWorldState(event.worldState);
  });

  it("keeps pushing snapshots on the interval (cleanup is not premature)", async () => {
    // Guards the res-vs-req lifecycle bug: if cleanup were tied to the request
    // finishing, the interval would be cleared after the first frame and no
    // second frame would ever arrive. Reading two frames proves it keeps pushing.
    const port = await listen();

    const res = await fetch(`http://localhost:${port}/api/stream`);
    const frames = await readEventData(res.body!, 2);

    expect(frames).toHaveLength(2);
    for (const raw of frames) {
      expect(deserializeEvent(raw).type).toBe("snapshot");
    }
  });

  it("serves the current WorldState snapshot over REST", async () => {
    const port = await listen();

    const res = await fetch(`http://localhost:${port}/api/worldstate`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const ws = (await res.json()) as WorldState;
    expectValidWorldState(ws);
  });
});

describe("item-location search", () => {
  it("serves a search result over REST, passing the item query through", async () => {
    const port = await listen();

    const res = await fetch(`http://localhost:${port}/api/storage/search?item=Iron+Plate`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const result = (await res.json()) as StorageSearchResponse;
    expect(lastSearchQuery).toBe("Iron Plate");
    expect(result.query).toBe("Iron Plate");
    expect(["live", "baseline"]).toContain(result.tag.source);
    expect(typeof result.matches[0]?.itemDisplayName).toBe("string");
  });

  it("treats a missing ?item as an empty query rather than failing", async () => {
    const port = await listen();

    const res = await fetch(`http://localhost:${port}/api/storage/search`);
    expect(res.status).toBe(200);
    expect(lastSearchQuery).toBe("");
  });
});

describe("Tier 1 map", () => {
  it("serves the current map snapshot over REST, every layer tagged", async () => {
    const port = await listen();

    const res = await fetch(`http://localhost:${port}/api/map`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const map = (await res.json()) as MapSnapshot;
    expect(typeof map.generatedAt).toBe("number");
    for (const domain of [map.buildings, map.movers, map.deathCrates]) {
      expect(["live", "baseline"]).toContain(domain.tag.source);
      expect(typeof domain.tag.capturedAt).toBe("number");
    }
    expect(map.buildings.data[0]?.className).toBe("Build_ConstructorMk1_C");
    expect(map.movers.data[0]?.kind).toBe("player");
    expect(map.deathCrates.data[0]?.className).toBe("BP_Crate_C");
  });
});

describe("codex popover lookup", () => {
  it("serves a codex entry over REST, passing kind and class name through", async () => {
    const port = await listen();

    const res = await fetch(`http://localhost:${port}/api/codex/item/Desc_IronPlate_C`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const entry = (await res.json()) as CodexEntry;
    expect(lastCodexLookup).toEqual({ kind: "item", className: "Desc_IronPlate_C" });
    expect(entry.kind).toBe("item");
    expect(entry.className).toBe("Desc_IronPlate_C");
    expect(entry.recipes[0]?.className).toBe("Recipe_IronPlate_C");
  });

  it("serves a building entry the same way", async () => {
    const port = await listen();

    const res = await fetch(`http://localhost:${port}/api/codex/building/Build_ConstructorMk1_C`);
    const entry = (await res.json()) as CodexEntry;

    expect(lastCodexLookup).toEqual({ kind: "building", className: "Build_ConstructorMk1_C" });
    expect(entry.kind).toBe("building");
    expect(entry.powerConsumptionMW).toBe(4);
  });

  it("404s for a class the lookup doesn't know", async () => {
    const port = await listen();

    const res = await fetch(`http://localhost:${port}/api/codex/item/Desc_Unknown_C`);
    expect(res.status).toBe(404);
  });

  it("404s for an invalid kind rather than throwing", async () => {
    const port = await listen();

    const res = await fetch(`http://localhost:${port}/api/codex/recipe/Recipe_IronPlate_C`);
    expect(res.status).toBe(404);
    expect(lastCodexLookup).toBeUndefined();
  });

  it("URL-decodes the class name", async () => {
    const port = await listen();

    await fetch(`http://localhost:${port}/api/codex/item/Desc%20With%20Space_C`);
    expect(lastCodexLookup).toEqual({ kind: "item", className: "Desc With Space_C" });
  });
});

describe("codex popover icon", () => {
  let iconDir: string;

  afterEach(async () => {
    if (iconDir) await rm(iconDir, { recursive: true, force: true });
  });

  it("streams the icon file resolveIconPath points at", async () => {
    iconDir = await mkdtemp(path.join(tmpdir(), "scc-icons-"));
    const iconPath = path.join(iconDir, "Desc_IronPlate_C.png");
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await writeFile(iconPath, pngBytes);

    const port = await listen({ resolveIconPath: () => iconPath });

    const res = await fetch(`http://localhost:${port}/api/codex/icon/Desc_IronPlate_C`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(pngBytes);
  });

  it("404s when no icons directory is configured", async () => {
    const port = await listen({ resolveIconPath: () => null });

    const res = await fetch(`http://localhost:${port}/api/codex/icon/Desc_IronPlate_C`);
    expect(res.status).toBe(404);
  });

  it("404s when the resolved path doesn't actually exist on disk", async () => {
    const port = await listen({ resolveIconPath: () => "/nowhere/Desc_IronPlate_C.png" });

    const res = await fetch(`http://localhost:${port}/api/codex/icon/Desc_IronPlate_C`);
    expect(res.status).toBe(404);
  });
});
