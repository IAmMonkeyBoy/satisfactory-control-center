import { describe, expect, it } from "vitest";
import { formatAlternates, formatHardDrives, ingredientPercent } from "./milestonesFormat.ts";

describe("ingredientPercent", () => {
  it("computes a rounded percent of target reached", () => {
    expect(
      ingredientPercent({
        className: "Desc_IronPlate_C",
        displayName: "Iron Plate",
        amount: 20,
        targetAmount: 50,
      }),
    ).toBe(40);
  });

  it("clamps at 100 rather than overflowing the bar", () => {
    expect(
      ingredientPercent({
        className: "Desc_IronPlate_C",
        displayName: "Iron Plate",
        amount: 60,
        targetAmount: 50,
      }),
    ).toBe(100);
  });

  it("treats a zero target as already complete rather than dividing by zero", () => {
    expect(
      ingredientPercent({
        className: "Desc_IronPlate_C",
        displayName: "Iron Plate",
        amount: 0,
        targetAmount: 0,
      }),
    ).toBe(100);
  });
});

describe("formatHardDrives", () => {
  it("pluralizes the count", () => {
    expect(formatHardDrives(1)).toBe("1 hard drive waiting");
    expect(formatHardDrives(3)).toBe("3 hard drives waiting");
    expect(formatHardDrives(0)).toBe("0 hard drives waiting");
  });
});

describe("formatAlternates", () => {
  it("pluralizes the count", () => {
    expect(formatAlternates(1)).toBe("1 alternate unlocked");
    expect(formatAlternates(7)).toBe("7 alternates unlocked");
  });
});
