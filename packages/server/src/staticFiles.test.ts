import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createServer } from "./httpServer.js";

let server: Server | undefined;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "scc-static-"));
  await writeFile(path.join(dir, "index.html"), "<!doctype html><title>dash</title>");
  await writeFile(path.join(dir, "app.js"), "console.log('hi')");
});

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  await rm(dir, { recursive: true, force: true });
});

async function listen(): Promise<number> {
  server = createServer({ staticDir: dir });
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  return (server!.address() as AddressInfo).port;
}

describe("static dashboard serving", () => {
  it("serves index.html at the root", async () => {
    const port = await listen();
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<title>dash</title>");
  });

  it("serves a static asset with its content type", async () => {
    const port = await listen();
    const res = await fetch(`http://localhost:${port}/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
  });

  it("falls back to index.html for unknown client routes", async () => {
    const port = await listen();
    const res = await fetch(`http://localhost:${port}/some/spa/route`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>dash</title>");
  });

  it("does not fall back for unknown API routes", async () => {
    const port = await listen();
    const res = await fetch(`http://localhost:${port}/api/unknown`);
    expect(res.status).toBe(404);
  });

  it("rejects path traversal out of the static root", async () => {
    const port = await listen();
    // A traversal attempt resolves back inside root (or is rejected) — never
    // escapes to arbitrary files; it must not return a non-dashboard body.
    const res = await fetch(`http://localhost:${port}/../../secret`);
    const body = await res.text();
    expect(body).toContain("dash");
  });
});
