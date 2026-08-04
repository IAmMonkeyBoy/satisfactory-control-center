import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { deserializeEvent, type StorageSearchResponse, type WorldState } from "@scc/shared";
import { createServer } from "./httpServer.ts";
import { boundPort, sampleStorageSearchResponse, sampleWorldState } from "./testSupport.ts";

let server: Server | undefined;
let lastSearchQuery: string | undefined;

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  lastSearchQuery = undefined;
});

async function listen(): Promise<number> {
  server = createServer({
    pushIntervalMs: 20,
    buildWorldState: sampleWorldState,
    searchStorage: (query) => {
      lastSearchQuery = query;
      return sampleStorageSearchResponse(query);
    },
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
