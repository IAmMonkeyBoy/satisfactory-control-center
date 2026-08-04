import { describe, expect, it } from "vitest";
import {
  mapDepot,
  mapDrones,
  mapFactoryBuildings,
  mapMachines,
  mapPlayers,
  mapPower,
  mapProduction,
  mapSessionName,
  mapSink,
  mapStorage,
  mapTrains,
  mapVehicles,
} from "./frmDomains.ts";

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

describe("mapMachines", () => {
  it("rolls up one machine into its building-class group", () => {
    const raw = [
      {
        ClassName: "Build_ConstructorMk1_C",
        Name: "Constructor",
        IsConfigured: true,
        IsProducing: true,
        IsPaused: false,
        Productivity: 100,
      },
    ];

    expect(mapMachines(raw)).toEqual({
      machines: [
        {
          className: "Build_ConstructorMk1_C",
          displayName: "Constructor",
          totalCount: 1,
          producingCount: 1,
          idleCount: 0,
          pausedCount: 0,
          averageEfficiencyPercent: 100,
        },
      ],
    });
  });

  it("splits a class's machines across producing, idle, and paused", () => {
    const raw = [
      { ClassName: "Build_ConstructorMk1_C", IsConfigured: true, IsProducing: true },
      { ClassName: "Build_ConstructorMk1_C", IsConfigured: true, IsProducing: false },
      { ClassName: "Build_ConstructorMk1_C", IsConfigured: true, IsPaused: true },
    ];

    const [group] = mapMachines(raw).machines;
    expect(group).toMatchObject({ totalCount: 3, producingCount: 1, idleCount: 1, pausedCount: 1 });
  });

  it("counts a paused machine's zero productivity into the class average, not as missing data", () => {
    // This is what makes a machine switched off in-game show up in the
    // rollup's efficiency figure, not just its own paused count.
    const raw = [
      {
        ClassName: "Build_ConstructorMk1_C",
        IsConfigured: true,
        IsProducing: true,
        Productivity: 100,
      },
      { ClassName: "Build_ConstructorMk1_C", IsConfigured: true, IsPaused: true, Productivity: 0 },
    ];

    expect(mapMachines(raw).machines[0]?.averageEfficiencyPercent).toBe(50);
  });

  it("excludes an unconfigured machine from the rollup entirely, not just its productivity", () => {
    // Not just kept out of the efficiency average: an unconfigured machine
    // reports IsProducing: false, so counting it as an idle machine would
    // make a freshly-placed, not-yet-configured building register as a
    // stalled production line (mapMachines.test would then raise a false
    // "stalled" alarm) and would make totalCount disagree with the baseline
    // extractor, which skips unconfigured machines the same way.
    const raw = [
      {
        ClassName: "Build_ConstructorMk1_C",
        IsConfigured: true,
        IsProducing: true,
        Productivity: 80,
      },
      { ClassName: "Build_ConstructorMk1_C", IsConfigured: false, Productivity: 0 },
    ];

    const [group] = mapMachines(raw).machines;
    expect(group).toMatchObject({ totalCount: 1, producingCount: 1, idleCount: 0 });
  });

  it("reports no machines at all for a class where nothing has ever been configured", () => {
    const raw = [{ ClassName: "Build_ConstructorMk1_C", IsConfigured: false }];
    expect(mapMachines(raw).machines).toEqual([]);
  });

  it("reports no efficiency figure when a configured machine has never reported productivity", () => {
    const raw = [{ ClassName: "Build_ConstructorMk1_C", IsConfigured: true, IsProducing: true }];
    expect(mapMachines(raw).machines[0]?.averageEfficiencyPercent).toBeNull();
  });

  it("drops a machine with no ClassName", () => {
    expect(mapMachines([{ IsProducing: true, IsConfigured: true }]).machines).toEqual([]);
  });

  it("sorts by total count descending, className breaking ties", () => {
    const raw = [
      { ClassName: "Build_SmelterMk1_C", IsConfigured: true },
      { ClassName: "Build_ConstructorMk1_C", IsConfigured: true },
      { ClassName: "Build_ConstructorMk1_C", IsConfigured: true },
    ];
    expect(mapMachines(raw).machines.map((m) => m.className)).toEqual([
      "Build_ConstructorMk1_C",
      "Build_SmelterMk1_C",
    ]);
  });

  it("degrades to an empty domain on a malformed payload", () => {
    expect(mapMachines(null).machines).toEqual([]);
    expect(mapMachines("nope").machines).toEqual([]);
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

describe("mapDepot", () => {
  it("maps a getCloudInv entry into the storage item shape", () => {
    const raw = [
      { Name: "Iron Plate", ClassName: "Desc_IronPlate_C", Amount: 164, MaxAmount: 200 },
      { Name: "Copper Sheet", ClassName: "Desc_CopperSheet_C", Amount: 200, MaxAmount: 200 },
    ];

    expect(mapDepot(raw)).toEqual({
      items: [
        { className: "Desc_CopperSheet_C", displayName: "Copper Sheet", count: 200 },
        { className: "Desc_IronPlate_C", displayName: "Iron Plate", count: 164 },
      ],
    });
  });

  it("skips an entry with no amount, a non-positive amount, or no className", () => {
    const raw = [
      { Name: "Iron Plate", ClassName: "Desc_IronPlate_C", Amount: 0 },
      { Name: "Screws", Amount: 40 },
      { ClassName: "Desc_Screw_C" },
    ];
    expect(mapDepot(raw).items).toEqual([]);
  });

  it("degrades to an empty domain on a malformed payload", () => {
    expect(mapDepot(null).items).toEqual([]);
    expect(mapDepot("nope").items).toEqual([]);
  });
});

describe("mapSink", () => {
  it("maps a getResourceSink payload into the sink domain shape", () => {
    const raw = [
      {
        Name: "A.W.E.S.O.M.E.",
        NumCoupon: 13,
        Percent: 15.7,
        GraphPoints: [{ Index: 0, value: 33218 }],
        PointsToCoupon: 14902634,
        TotalPoints: 3334555366,
      },
    ];

    expect(mapSink(raw)).toEqual({
      totalPoints: 3334555366,
      numCoupons: 13,
      pointsToNextCoupon: 14902634,
      percentToNextCoupon: 15.7,
    });
  });

  it("accepts a bare object, not just the single-element array FRM's example shows", () => {
    const raw = { NumCoupon: 1, Percent: 0, PointsToCoupon: 100, TotalPoints: 50 };
    expect(mapSink(raw)).toEqual({
      totalPoints: 50,
      numCoupons: 1,
      pointsToNextCoupon: 100,
      percentToNextCoupon: 0,
    });
  });

  it("reports zero/null rather than throwing on a malformed payload", () => {
    expect(mapSink(null)).toEqual({
      totalPoints: 0,
      numCoupons: 0,
      pointsToNextCoupon: null,
      percentToNextCoupon: null,
    });
    expect(mapSink("nope")).toEqual({
      totalPoints: 0,
      numCoupons: 0,
      pointsToNextCoupon: null,
      percentToNextCoupon: null,
    });
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

describe("mapFactoryBuildings", () => {
  it("maps a getFactory entry into a map building, running with a bounding-box footprint", () => {
    const raw = [
      {
        ID: "Build_ConstructorMk1_C_2147415548",
        Name: "Constructor",
        ClassName: "Build_ConstructorMk1_C",
        location: { x: -70700, y: 254500, z: -3599.98, rotation: 90 },
        IsConfigured: true,
        IsProducing: true,
        IsPaused: false,
        PowerInfo: { CircuitGroupID: 0, CircuitID: 1, FuseTriggered: false },
        BoundingBox: {
          min: { x: -71000, y: 254200, z: -3600 },
          max: { x: -70400, y: 254800, z: -3400 },
        },
      },
    ];

    expect(mapFactoryBuildings(raw)).toEqual([
      {
        id: "Build_ConstructorMk1_C_2147415548",
        className: "Build_ConstructorMk1_C",
        displayName: "Constructor",
        transform: { x: -70700, y: 254500, z: -3599.98, rotationDegrees: 90 },
        footprint: { widthCm: 600, depthCm: 600 },
        status: "running",
      },
    ]);
  });

  it("reports no-power when the building's own circuit has tripped its fuse, even while paused", () => {
    const raw = [
      {
        ID: "b1",
        ClassName: "Build_ConstructorMk1_C",
        location: { x: 0, y: 0, z: 0 },
        IsConfigured: true,
        IsProducing: false,
        IsPaused: true,
        PowerInfo: { FuseTriggered: true },
      },
    ];
    expect(mapFactoryBuildings(raw)[0]?.status).toBe("no-power");
  });

  it("reports no-power for a machine that isn't wired to any circuit, even though its fuse never tripped", () => {
    // FRM documents CircuitID/CircuitGroupID of -1 as "not connected" — a
    // building placed but never wired to a power line has no circuit for a
    // fuse to trip on at all, so FuseTriggered alone would misreport it idle.
    const raw = [
      {
        ID: "b1",
        ClassName: "Build_ConstructorMk1_C",
        location: { x: 0, y: 0, z: 0 },
        IsConfigured: true,
        IsProducing: false,
        PowerInfo: { CircuitGroupID: -1, CircuitID: -1, FuseTriggered: false },
      },
    ];
    expect(mapFactoryBuildings(raw)[0]?.status).toBe("no-power");
  });

  it("reports idle for a configured machine that is neither producing nor unpowered", () => {
    const raw = [
      {
        ID: "b1",
        ClassName: "Build_ConstructorMk1_C",
        location: { x: 0, y: 0, z: 0 },
        IsConfigured: true,
        IsProducing: false,
      },
    ];
    expect(mapFactoryBuildings(raw)[0]?.status).toBe("idle");
  });

  it("falls back to the default footprint when FRM reports no bounding box", () => {
    const raw = [
      {
        ID: "b1",
        ClassName: "Build_ConstructorMk1_C",
        location: { x: 0, y: 0, z: 0 },
        IsConfigured: true,
      },
    ];
    expect(mapFactoryBuildings(raw)[0]?.footprint).toEqual({ widthCm: 800, depthCm: 800 });
  });

  it("excludes an unconfigured machine, matching mapMachines's population", () => {
    const raw = [{ ID: "b1", ClassName: "Build_ConstructorMk1_C", location: { x: 0, y: 0, z: 0 } }];
    expect(mapFactoryBuildings(raw)).toEqual([]);
  });

  it("drops an entry with no className or no location", () => {
    expect(mapFactoryBuildings([{ ID: "b1", IsConfigured: true }])).toEqual([]);
    expect(
      mapFactoryBuildings([{ ID: "b1", ClassName: "Build_ConstructorMk1_C", IsConfigured: true }]),
    ).toEqual([]);
  });

  it("degrades to an empty list on a malformed payload", () => {
    expect(mapFactoryBuildings(null)).toEqual([]);
    expect(mapFactoryBuildings("nope")).toEqual([]);
  });
});

describe("mapPlayers", () => {
  it("maps an online getPlayer entry into a player mover", () => {
    const raw = [
      {
        ID: "Char_Player_C_2147452680",
        Name: "derpierre65",
        ClassName: "Char_Player_C",
        location: { x: -57604.68, y: 260436.19, z: -3018.36, rotation: 115.55 },
        Online: true,
        PlayerHP: 100,
        Dead: false,
      },
    ];

    expect(mapPlayers(raw)).toEqual([
      {
        id: "player-Char_Player_C_2147452680",
        kind: "player",
        className: "Char_Player_C",
        displayName: "derpierre65",
        transform: { x: -57604.68, y: 260436.19, z: -3018.36, rotationDegrees: 115.55 },
        footprint: { widthCm: 100, depthCm: 100 },
      },
    ]);
  });

  it("excludes an offline player rather than showing a stale marker", () => {
    const raw = [{ ID: "p1", Name: "afk", location: { x: 0, y: 0, z: 0 }, Online: false }];
    expect(mapPlayers(raw)).toEqual([]);
  });

  it("degrades to an empty list on a malformed payload", () => {
    expect(mapPlayers(null)).toEqual([]);
  });
});

describe("mapVehicles", () => {
  it("maps a getVehicles entry, preferring VehicleType over the missing Name/ClassName", () => {
    const raw = [
      {
        ID: 0,
        VehicleType: "Explorer",
        location: { x: -52341.44, y: -162543.22, z: -904.13, rotation: 313 },
        Driver: "porisius",
      },
    ];

    expect(mapVehicles(raw)).toEqual([
      {
        id: "vehicle-0",
        kind: "vehicle",
        className: "Explorer",
        displayName: "Explorer",
        transform: { x: -52341.44, y: -162543.22, z: -904.13, rotationDegrees: 313 },
        footprint: { widthCm: 400, depthCm: 800 },
      },
    ]);
  });

  it("falls back to a generic label when neither Name, VehicleType, nor ClassName is present", () => {
    const raw = [{ ID: 1, location: { x: 0, y: 0, z: 0 } }];
    expect(mapVehicles(raw)[0]?.displayName).toBe("Vehicle");
    expect(mapVehicles(raw)[0]?.className).toBe("Unknown");
  });

  it("prefers ClassName over VehicleType for the class when both are present", () => {
    const raw = [
      {
        ID: 2,
        ClassName: "BP_Explorer_C",
        VehicleType: "Explorer",
        location: { x: 0, y: 0, z: 0 },
      },
    ];
    expect(mapVehicles(raw)[0]?.className).toBe("BP_Explorer_C");
  });

  it("drops an entry with no location", () => {
    expect(mapVehicles([{ ID: 0, VehicleType: "Explorer" }])).toEqual([]);
  });
});

describe("mapTrains", () => {
  it("maps a getTrains entry into a train mover", () => {
    const raw = [
      {
        ID: "BP_Train_C_2147339037",
        Name: "Train",
        ClassName: "BP_Train_C",
        location: { x: -92400, y: 231600.21, z: 21100.01, rotation: 0 },
        Status: "Self-Driving",
        PowerInfo: { CircuitGroupID: -1, CircuitID: -1, FuseTriggered: false },
      },
    ];

    expect(mapTrains(raw)).toEqual([
      {
        id: "train-BP_Train_C_2147339037",
        kind: "train",
        className: "BP_Train_C",
        displayName: "Train",
        transform: { x: -92400, y: 231600.21, z: 21100.01, rotationDegrees: 0 },
        footprint: { widthCm: 400, depthCm: 2000 },
      },
    ]);
  });

  it("degrades to an empty list on a malformed payload", () => {
    expect(mapTrains(null)).toEqual([]);
  });
});

describe("mapDrones", () => {
  it("maps a getDrone entry into a drone mover", () => {
    const raw = [
      {
        ID: "BP_DroneTransport_C_2147415346",
        Name: "Drone",
        ClassName: "BP_DroneTransport_C",
        location: { x: -48777.96, y: 252677.7, z: -3190.92, rotation: 90 },
        CurrentFlyingMode: "None",
      },
    ];

    expect(mapDrones(raw)).toEqual([
      {
        id: "drone-BP_DroneTransport_C_2147415346",
        kind: "drone",
        className: "BP_DroneTransport_C",
        displayName: "Drone",
        transform: { x: -48777.96, y: 252677.7, z: -3190.92, rotationDegrees: 90 },
        footprint: { widthCm: 300, depthCm: 300 },
      },
    ]);
  });

  it("degrades to an empty list on a malformed payload", () => {
    expect(mapDrones(null)).toEqual([]);
  });
});
