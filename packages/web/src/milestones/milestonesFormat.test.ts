import { describe, expect, it } from "vitest";
import { formatAlternates, formatHardDriveResults, ingredientPercent } from "./milestonesFormat.ts";

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

describe("formatHardDriveResults", () => {
  it("pluralizes the count", () => {
    expect(formatHardDriveResults(1)).toBe("1 hard drive result to claim");
    expect(formatHardDriveResults(3)).toBe("3 hard drive results to claim");
    expect(formatHardDriveResults(0)).toBe("0 hard drive results to claim");
  });
});

describe("formatAlternates", () => {
  it("pluralizes the count", () => {
    expect(formatAlternates(1)).toBe("1 alternate unlocked");
    expect(formatAlternates(7)).toBe("7 alternates unlocked");
  });
});
