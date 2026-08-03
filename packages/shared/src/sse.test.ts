import { describe, expect, it } from "vitest";
import { deserializeEvent, serializeEvent, type ServerEvent } from "./sse.ts";
import type { WorldState } from "./worldState.ts";

function validWorldState(): WorldState {
  const tag = { source: "live" as const, capturedAt: 1000 };
  return {
    generatedAt: 1000,
    followedSession: { sessionName: "Test Session" },
    power: { tag, data: { circuits: [] } },
    production: { tag, data: { items: [] } },
    storage: { tag, data: { items: [] } },
    milestones: {
      tag,
      data: { currentMilestone: "HUB Upgrade 1", spaceElevatorPhase: "Phase 1" },
    },
  };
}

function validEvent(): ServerEvent {
  return { type: "snapshot", worldState: validWorldState() };
}

describe("deserializeEvent", () => {
  it("round-trips a valid snapshot event", () => {
    const event = validEvent();
    expect(deserializeEvent(serializeEvent(event))).toEqual(event);
  });

  it("round-trips a baseline snapshot whose live-only fields are unknown", () => {
    // A save records installed capacity and stored charge but never instantaneous
    // production, draw, or fuse state; the baseline must be able to say so.
    const ws = validWorldState();
    const event: ServerEvent = {
      type: "snapshot",
      worldState: {
        ...ws,
        followedSession: null,
        power: {
          tag: { source: "baseline", capturedAt: 500 },
          data: {
            circuits: [
              {
                id: "1",
                productionMW: null,
                consumptionMW: null,
                capacityMW: 750,
                batteryPercent: 40,
                fuseTripped: null,
              },
            ],
          },
        },
        production: {
          tag: { source: "baseline", capturedAt: 500 },
          data: {
            items: [
              {
                className: "Desc_IronPlate_C",
                displayName: "Iron Plate",
                currentPerMin: null,
                maxPerMin: 60,
              },
            ],
          },
        },
        milestones: {
          tag: { source: "baseline", capturedAt: 500 },
          data: { currentMilestone: null, spaceElevatorPhase: null },
        },
      },
    };
    expect(deserializeEvent(serializeEvent(event))).toEqual(event);
  });

  it("rejects a non-JSON payload", () => {
    expect(() => deserializeEvent("not json")).toThrow();
  });

  it("rejects an empty object (no discriminant)", () => {
    expect(() => deserializeEvent("{}")).toThrow();
  });

  it("rejects an unknown event type", () => {
    expect(() => deserializeEvent(JSON.stringify({ type: "bogus" }))).toThrow();
  });

  it("rejects a snapshot missing its worldState", () => {
    expect(() => deserializeEvent(JSON.stringify({ type: "snapshot" }))).toThrow();
  });

  it("rejects a worldState missing a nested domain", () => {
    const ws = validWorldState() as Partial<WorldState>;
    delete ws.storage;
    expect(() => deserializeEvent(JSON.stringify({ type: "snapshot", worldState: ws }))).toThrow();
  });

  it("rejects a domain missing its source/age tag", () => {
    const ws = validWorldState();
    const broken = { ...ws, power: { data: ws.power.data } };
    expect(() =>
      deserializeEvent(JSON.stringify({ type: "snapshot", worldState: broken })),
    ).toThrow();
  });

  it("rejects a field of the wrong type", () => {
    const ws = validWorldState();
    const broken = {
      ...ws,
      power: { ...ws.power, data: { circuits: "not-an-array" } },
    };
    expect(() =>
      deserializeEvent(JSON.stringify({ type: "snapshot", worldState: broken })),
    ).toThrow();
  });

  it("rejects an invalid source enum value", () => {
    const ws = validWorldState();
    const broken = {
      ...ws,
      power: { tag: { source: "guess", capturedAt: 1 }, data: ws.power.data },
    };
    expect(() =>
      deserializeEvent(JSON.stringify({ type: "snapshot", worldState: broken })),
    ).toThrow();
  });
});
