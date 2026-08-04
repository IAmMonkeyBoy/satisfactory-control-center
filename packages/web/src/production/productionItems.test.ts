import { describe, expect, it } from "vitest";
import type { ProductionItem } from "@scc/shared";
import { formatPerMin, notableItems } from "./productionItems";

function item(overrides: Partial<ProductionItem> & { className: string }): ProductionItem {
  return {
    displayName: overrides.className,
    currentPerMin: null,
    maxPerMin: 0,
    ...overrides,
  };
}

describe("notableItems", () => {
  it("keeps items with an installed max rate", () => {
    const items = [item({ className: "Desc_IronPlate_C", maxPerMin: 60 })];
    expect(notableItems(items)).toEqual(items);
  });

  it("drops an item with no installed rate at all", () => {
    const items = [item({ className: "Desc_IronPlate_C", maxPerMin: 0 })];
    expect(notableItems(items)).toEqual([]);
  });
});

describe("formatPerMin", () => {
  it("rounds and adds thousands separators", () => {
    expect(formatPerMin(1234.5)).toBe("1,235/min");
  });

  it("renders zero plainly", () => {
    expect(formatPerMin(0)).toBe("0/min");
  });
});
