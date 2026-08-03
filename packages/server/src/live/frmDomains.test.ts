import { describe, expect, it } from "vitest";
import { mapPower, mapProduction, mapSessionName, mapStorage } from "./frmDomains.ts";

describe("mapPower", () => {
  it("maps a getPower circuit into the power domain shape", () => {
    const raw = [
      {
        CircuitGroupID: 0,
        PowerProduction: 42.5,
        PowerConsumed: 30,
        PowerCapacity: 100,
        BatteryPercent: 75,
        FuseTriggered: false,
        AssociatedCircuits: [9, 1],
      },
    ];

    expect(mapPower(raw)).toEqual({
      circuits: [
        {
          id: "0",
          productionMW: 42.5,
          consumptionMW: 30,
          capacityMW: 100,
          batteryPercent: 75,
          fuseTripped: false,
        },
      ],
    });
  });

  it("sorts circuits by id", () => {
    const raw = [
      { CircuitGroupID: 2, PowerCapacity: 1 },
      { CircuitGroupID: 0, PowerCapacity: 1 },
    ];
    expect(mapPower(raw).circuits.map((c) => c.id)).toEqual(["0", "2"]);
  });

  it("drops a circuit with no id, since it can't be addressed by the UI", () => {
    const raw = [{ PowerCapacity: 100 }];
    expect(mapPower(raw).circuits).toEqual([]);
  });

  it("degrades to an empty domain when the payload isn't an array", () => {
    expect(mapPower({ not: "an array" })).toEqual({ circuits: [] });
    expect(mapPower(null)).toEqual({ circuits: [] });
    expect(mapPower(undefined)).toEqual({ circuits: [] });
  });

  it("reports fields FRM omitted as null rather than a fabricated zero", () => {
    const raw = [{ CircuitGroupID: 1, PowerCapacity: 50 }];
    expect(mapPower(raw).circuits[0]).toMatchObject({
      productionMW: null,
      consumptionMW: null,
      batteryPercent: null,
      fuseTripped: null,
    });
  });
});

describe("mapProduction", () => {
  it("maps a getProdStats item into the production domain shape", () => {
    const raw = [
      {
        Name: "Iron Plate",
        ClassName: "Desc_IronPlate_C",
        CurrentProd: 90,
        MaxProd: 120,
        ProdPercent: 75,
      },
    ];

    expect(mapProduction(raw)).toEqual({
      items: [
        {
          className: "Desc_IronPlate_C",
          displayName: "Iron Plate",
          currentPerMin: 90,
          maxPerMin: 120,
        },
      ],
    });
  });

  it("sorts by max rate descending, className breaking ties", () => {
    const raw = [
      { ClassName: "B", MaxProd: 10 },
      { ClassName: "A", MaxProd: 20 },
      { ClassName: "C", MaxProd: 10 },
    ];
    expect(mapProduction(raw).items.map((i) => i.className)).toEqual(["A", "B", "C"]);
  });

  it("drops an item with no className or no max rate", () => {
    expect(mapProduction([{ MaxProd: 10 }]).items).toEqual([]);
    expect(mapProduction([{ ClassName: "Desc_IronPlate_C" }]).items).toEqual([]);
  });

  it("degrades to an empty domain on a malformed payload", () => {
    expect(mapProduction("nope").items).toEqual([]);
  });
});

describe("mapStorage", () => {
  it("aggregates a container's inventory by className", () => {
    const raw = [
      {
        ID: "Build_StorageContainerMk1_C_1",
        Inventory: [
          { Name: "Iron Plate", ClassName: "Desc_IronPlate_C", Amount: 164, MaxAmount: 200 },
        ],
      },
    ];

    expect(mapStorage(raw)).toEqual({
      items: [{ className: "Desc_IronPlate_C", displayName: "Iron Plate", count: 164 }],
    });
  });

  it("sums the same item across multiple containers", () => {
    const raw = [
      { Inventory: [{ Name: "Iron Plate", ClassName: "Desc_IronPlate_C", Amount: 100 }] },
      { Inventory: [{ Name: "Iron Plate", ClassName: "Desc_IronPlate_C", Amount: 50 }] },
    ];

    expect(mapStorage(raw).items).toEqual([
      { className: "Desc_IronPlate_C", displayName: "Iron Plate", count: 150 },
    ]);
  });

  it("skips stacks with no amount, a non-positive amount, or no className", () => {
    const raw = [
      {
        Inventory: [
          { Name: "Iron Plate", ClassName: "Desc_IronPlate_C", Amount: 0 },
          { Name: "Screws", Amount: 40 },
          { ClassName: "Desc_Screw_C" },
        ],
      },
    ];
    expect(mapStorage(raw).items).toEqual([]);
  });

  it("tolerates a container with no Inventory field", () => {
    expect(mapStorage([{ ID: "empty" }]).items).toEqual([]);
  });

  it("degrades to an empty domain on a malformed payload", () => {
    expect(mapStorage(null).items).toEqual([]);
  });
});

describe("mapSessionName", () => {
  it("reads SessionName off a getSessionInfo payload", () => {
    expect(mapSessionName({ SessionName: "Random Defaults", IsPaused: false })).toBe(
      "Random Defaults",
    );
  });

  it("returns null for a payload with no SessionName", () => {
    expect(mapSessionName({ IsPaused: false })).toBeNull();
  });

  it("unwraps a single-element array, matching the WebSocket envelope's shape", () => {
    expect(mapSessionName([{ SessionName: "Dune Desert" }])).toBe("Dune Desert");
  });

  it("returns null for a malformed payload rather than throwing", () => {
    expect(mapSessionName(null)).toBeNull();
    expect(mapSessionName("nope")).toBeNull();
    expect(mapSessionName([])).toBeNull();
  });
});
