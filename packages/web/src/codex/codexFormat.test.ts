import { describe, expect, it } from "vitest";
import { formatCraftSeconds, kindLabel } from "./codexFormat";

describe("kindLabel", () => {
  it("labels an item", () => {
    expect(kindLabel("item")).toBe("Item");
  });

  it("labels a building as a machine, matching the spec's own wording", () => {
    expect(kindLabel("building")).toBe("Machine");
  });
});

describe("formatCraftSeconds", () => {
  it("renders a whole-second duration without decimals", () => {
    expect(formatCraftSeconds(6)).toBe("6s");
  });

  it("keeps one decimal place for a fractional duration", () => {
    expect(formatCraftSeconds(0.75)).toBe("0.8s");
  });

  it("rounds off floating-point noise into a whole number", () => {
    expect(formatCraftSeconds(1.0000000001)).toBe("1s");
  });
});
