import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { deserializeEvent, type WorldState } from "@scc/shared";
import { createServer } from "./httpServer.js";

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

async function listen(): Promise<number> {
  server = createServer({ pushIntervalMs: 20 });
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  return (server!.address() as AddressInfo).port;
}

/** Read the first complete SSE frame's `data:` payload from a streaming body. */
async function readFirstEventData(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended before a full event arrived");
      buffer += decoder.decode(value, { stream: true });
      const boundary = buffer.indexOf("\n\n");
      if (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) throw new Error("SSE frame had no data line");
        return dataLine.slice("data:".length).trim();
      }
    }
  } finally {
    await reader.cancel();
  }
}

function expectValidWorldState(ws: WorldState): void {
  expect(typeof ws.generatedAt).toBe("number");
  expect(ws.followedSession.sessionName).toBeTruthy();
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

    const raw = await readFirstEventData(res.body!);
    const event = deserializeEvent(raw);

    expect(event.type).toBe("snapshot");
    expectValidWorldState(event.worldState);
  });

  it("serves the current WorldState snapshot over REST", async () => {
    const port = await listen();

    const res = await fetch(`http://localhost:${port}/api/worldstate`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const ws = (await res.json()) as WorldState;
    expectValidWorldState(ws);
  });

  it("rejects a malformed SSE payload rather than passing it through untyped", () => {
    expect(() => deserializeEvent("{}")).toThrow();
    expect(() => deserializeEvent('{"type":"bogus"}')).toThrow();
  });
});
