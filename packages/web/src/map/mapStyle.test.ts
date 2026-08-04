import { describe, expect, it } from "vitest";
import { buildingColor, moverColor } from "./mapStyle";

describe("buildingColor", () => {
  it("gives each live status its own color", () => {
    const running = buildingColor("running");
    const idle = buildingColor("idle");
    const noPower = buildingColor("no-power");
    expect(new Set([running, idle, noPower]).size).toBe(3);
  });

  it("gives a baseline-only (null) status a color distinct from the live idle color", () => {
    expect(buildingColor(null)).not.toBe(buildingColor("idle"));
  });
});

describe("moverColor", () => {
  it("gives each mover kind its own color", () => {
    const colors = (["player", "vehicle", "train", "drone"] as const).map(moverColor);
    expect(new Set(colors).size).toBe(4);
  });
});
