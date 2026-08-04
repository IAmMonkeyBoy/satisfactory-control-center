import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startFrmClient,
  type FrmClient,
  type FrmEndpoint,
  type FrmSocket,
  type FrmStatus,
} from "./frmClient.ts";

/** A stand-in WebSocket the test drives by hand: no real socket, no real clock. */
class FakeSocket implements FrmSocket {
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners: {
    open: (() => void)[];
    message: ((event: { data: unknown }) => void)[];
    close: (() => void)[];
    error: (() => void)[];
  } = { open: [], message: [], close: [], error: [] };

  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (...args: never[]) => void,
  ): void {
    (this.listeners[type] as ((...args: never[]) => void)[]).push(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    for (const listener of this.listeners.open) listener();
  }

  message(data: unknown): void {
    for (const listener of this.listeners.message) listener({ data });
  }

  dropWithClose(): void {
    for (const listener of this.listeners.close) listener();
  }

  dropWithError(): void {
    for (const listener of this.listeners.error) listener();
  }
}

interface FakeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

function jsonResponse(data: unknown): FakeResponse {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

const FRM_PUSH: Record<FrmEndpoint, unknown> = {
  getSessionInfo: { SessionName: "Random Defaults" },
  getPower: [{ CircuitGroupID: 0, PowerCapacity: 100 }],
  getProdStats: [],
  getFactory: [],
  getStorageInv: [],
  getCloudInv: [],
  getResourceSink: [],
  getPlayer: [],
  getVehicles: [],
  getTrains: [],
  getDrone: [],
};

let sockets: FakeSocket[];
let createSocket: () => FrmSocket;
let fetchCalls: string[];
let fetchImpl: (url: string, init?: RequestInit) => Promise<FakeResponse>;
let onData: ReturnType<
  typeof vi.fn<(endpoint: FrmEndpoint, data: unknown, capturedAt: number) => void>
>;
let onStatusChange: ReturnType<typeof vi.fn<(status: FrmStatus) => void>>;
let client: FrmClient | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  createSocket = () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  };
  fetchCalls = [];
  // Default: every poll succeeds with fixture data, keyed off the endpoint in the URL.
  fetchImpl = (url: string) => {
    fetchCalls.push(url);
    const endpoint = url.split("/").pop() as FrmEndpoint;
    return Promise.resolve(jsonResponse(FRM_PUSH[endpoint]));
  };
  onData = vi.fn<(endpoint: FrmEndpoint, data: unknown, capturedAt: number) => void>();
  onStatusChange = vi.fn<(status: FrmStatus) => void>();
});

afterEach(() => {
  client?.close();
  client = undefined;
  vi.useRealTimers();
});

function start(overrides: Partial<Parameters<typeof startFrmClient>[0]> = {}): FrmClient {
  client = startFrmClient({
    host: "localhost",
    port: 8080,
    createSocket,
    fetchImpl: ((url: string, init?: RequestInit) => fetchImpl(url, init)) as typeof fetch,
    onData,
    onStatusChange,
    reconnectDelayMs: 1000,
    pollIntervalMs: 2000,
    ...overrides,
  });
  return client;
}

describe("startFrmClient", () => {
  it("subscribes to every endpoint once the socket opens", async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();

    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({
      action: "subscribe",
      endpoints: [
        "getSessionInfo",
        "getPower",
        "getProdStats",
        "getFactory",
        "getStorageInv",
        "getCloudInv",
        "getResourceSink",
        "getPlayer",
        "getVehicles",
        "getTrains",
        "getDrone",
      ],
    });
    expect(onStatusChange).toHaveBeenCalledWith("live");
  });

  it("routes a WebSocket push through onData, unwrapped from its envelope", async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();
    onData.mockClear();

    sockets[0]!.message(JSON.stringify({ endpoint: "getPower", data: FRM_PUSH.getPower }));

    expect(onData).toHaveBeenCalledWith("getPower", FRM_PUSH.getPower, expect.any(Number));
  });

  it("routes a getSessionInfo push even though FRM sends it unwrapped, with no envelope", async () => {
    // Confirmed against a running FRM instance: every other subscribed
    // endpoint arrives as `{ endpoint, data }`, but getSessionInfo pushes the
    // raw session object with no `endpoint` field at all.
    start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();
    onData.mockClear();

    sockets[0]!.message(JSON.stringify(FRM_PUSH.getSessionInfo));

    expect(onData).toHaveBeenCalledWith(
      "getSessionInfo",
      FRM_PUSH.getSessionInfo,
      expect.any(Number),
    );
  });

  it("ignores a push that isn't the documented envelope", async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();
    onData.mockClear();

    sockets[0]!.message("not json");
    sockets[0]!.message(JSON.stringify({ endpoint: "getSwitches", data: [] })); // not subscribed
    sockets[0]!.message(JSON.stringify({ noEndpoint: true }));

    expect(onData).not.toHaveBeenCalled();
  });

  it("falls back to HTTP polling immediately when the socket drops, staying live if FRM still answers", async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();
    onStatusChange.mockClear();
    onData.mockClear();
    fetchCalls = [];

    sockets[0]!.dropWithClose();
    await vi.advanceTimersByTimeAsync(0);

    // Polling started right away and reached FRM, so status never dipped.
    expect(fetchCalls.some((url) => url.endsWith("/getPower"))).toBe(true);
    expect(onData).toHaveBeenCalledWith("getPower", FRM_PUSH.getPower, expect.any(Number));
    expect(onStatusChange).not.toHaveBeenCalledWith("down");
  });

  it("reports down only once polling itself fails to reach FRM", async () => {
    fetchImpl = () => Promise.reject(new Error("ECONNREFUSED"));
    start();
    await vi.advanceTimersByTimeAsync(0);

    expect(onStatusChange).toHaveBeenCalledWith("down");
  });

  it("recovers to a fresh push-driven status once FRM answers again", async () => {
    fetchImpl = () => Promise.reject(new Error("ECONNREFUSED"));
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onStatusChange).toHaveBeenLastCalledWith("down");

    fetchImpl = (url: string) => {
      const endpoint = url.split("/").pop() as FrmEndpoint;
      return Promise.resolve(jsonResponse(FRM_PUSH[endpoint]));
    };
    await vi.advanceTimersByTimeAsync(2000); // one poll interval

    expect(onStatusChange).toHaveBeenLastCalledWith("live");
  });

  it("resumes push-driven updates and stops polling once the socket reconnects", async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();
    sockets[0]!.dropWithClose();
    await vi.advanceTimersByTimeAsync(0);
    fetchCalls = [];

    await vi.advanceTimersByTimeAsync(1000); // reconnectDelayMs
    expect(sockets).toHaveLength(2);
    sockets[1]!.open();

    fetchCalls = [];
    await vi.advanceTimersByTimeAsync(5000); // several poll intervals, if polling were still live
    expect(fetchCalls).toEqual([]);
  });

  it("does not let a poll tick already in flight downgrade status after the socket wins the race", async () => {
    let resolvePoll!: (value: FakeResponse) => void;
    fetchImpl = () =>
      new Promise((resolve) => {
        resolvePoll = resolve;
      });
    start();

    sockets[0]!.open(); // socket wins first
    onStatusChange.mockClear();
    resolvePoll(jsonResponse([])); // the poll started at t=0 finally settles
    await vi.advanceTimersByTimeAsync(0);

    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("never runs two poll ticks concurrently, even if one outruns the interval", async () => {
    const pending: ((value: FakeResponse) => void)[] = [];
    fetchImpl = (url: string) => {
      fetchCalls.push(url);
      return new Promise((resolve) => pending.push(resolve));
    };
    start({ pollIntervalMs: 1000, pollTimeoutMs: 60_000 });

    await vi.advanceTimersByTimeAsync(0); // the first tick starts; 11 requests in flight
    expect(fetchCalls).toHaveLength(11);

    await vi.advanceTimersByTimeAsync(5000); // several interval periods elapse while still pending
    // The interval found a tick already in flight each time and skipped itself,
    // rather than piling up overlapping requests.
    expect(fetchCalls).toHaveLength(11);

    for (const resolve of pending.splice(0)) resolve(jsonResponse([]));
    await vi.advanceTimersByTimeAsync(0); // the first tick finally settles

    fetchCalls = [];
    await vi.advanceTimersByTimeAsync(1000); // the interval is free to run again
    expect(fetchCalls).toHaveLength(11);
  });

  it("aborts a hung request after the poll timeout, not just stops waiting on it, so a later tick can't pile a second request for the same endpoint on top of it", async () => {
    const signals: AbortSignal[] = [];
    fetchImpl = (_url: string, init?: RequestInit) =>
      new Promise<FakeResponse>((_resolve, reject) => {
        // A real `fetch` rejects once its signal aborts; a fake that just sat
        // forever wouldn't exercise the abort path this test is checking.
        const signal = init?.signal;
        if (!signal) return;
        signals.push(signal);
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    start({ pollTimeoutMs: 3000, pollIntervalMs: 10_000 });

    await vi.advanceTimersByTimeAsync(0); // the first tick's requests are in flight
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);

    await vi.advanceTimersByTimeAsync(3000); // the timeout fires for every endpoint
    expect(onStatusChange).toHaveBeenLastCalledWith("down");
    // Every hung request was genuinely cancelled — the heavy endpoint this
    // matters most for (getFactory) never gets a second request stacked on
    // top of one FRM is still working through.
    expect(signals.every((signal) => signal.aborted)).toBe(true);

    fetchImpl = (url: string) => {
      const endpoint = url.split("/").pop() as FrmEndpoint;
      return Promise.resolve(jsonResponse(FRM_PUSH[endpoint]));
    };
    await vi.advanceTimersByTimeAsync(10_000); // the next tick, now healthy again

    expect(onStatusChange).toHaveBeenLastCalledWith("live");
  });

  it("stops reconnecting once closed", async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    client!.close();
    expect(sockets[0]!.closed).toBe(true);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(1);
  });
});
