import { describe, expect, it } from "vitest";
import { formatCoupons, formatLocation, formatPoints } from "./storageFormat.ts";

describe("formatLocation", () => {
  it("rounds each axis to the nearest whole unit", () => {
    expect(formatLocation({ x: 100.4, y: -200.6, z: 5.5 })).toBe("(100, -201, 6)");
  });
});

describe("formatPoints", () => {
  it("adds thousands separators", () => {
    expect(formatPoints(3_334_555_366)).toBe("3,334,555,366");
  });
});

describe("formatCoupons", () => {
  it("pluralizes coupon count", () => {
    expect(formatCoupons(1)).toBe("1 coupon");
    expect(formatCoupons(13)).toBe("13 coupons");
    expect(formatCoupons(0)).toBe("0 coupons");
  });
});
