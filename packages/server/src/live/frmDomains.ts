/**
 * Mapping FRM's JSON endpoints into WorldState domain shapes — the live half of
 * the merge (ADR 0002). FRM is a third-party mod whose JSON this project reads
 * but does not own: field names have stayed stable across the versions checked,
 * but a mod update or an unrelated plugin changing the shape must degrade a
 * domain gracefully, never crash the ingestor. Every reader here is defensive in
 * the same spirit as `extractBaseline.ts`'s property readers — a missing or
 * mistyped field drops that one entry rather than throwing.
 *
 * Only the endpoints this build's WorldState domains can use are mapped here:
 * `getPower` (power), `getProdStats` (production, at the aggregate item level
 * the domain already models), `getFactory` (per-machine detail, rolled up into
 * the machines domain), `getStorageInv` (storage), `getCloudInv` (depot),
 * `getResourceSink` (sink), and `getSessionInfo` (session identity, for the
 * followed-session gating rules — not a domain itself). `getCrateInv` has a
 * domain (death crates) but is deliberately not mapped: death-crate contents
 * stay baseline-only by design (spec, "Followed session and merge rules"), so
 * there's no live counterpart to merge it against.
 *
 * Build 8 (Tier 1 map) adds `getFactory` a second time, mapped to per-instance
 * building placements rather than the aggregate `machines` rollup, plus four
 * mover endpoints — `getPlayer`, `getVehicles`, `getTrains`, `getDrone` — none
 * of which have a baseline counterpart (movers are runtime-only; see
 * `mapSnapshot.ts`'s doc comment). Every field name below is confirmed
 * against FRM's own documentation
 * (github.com/porisius/FicsitRemoteMonitoring/tree/main/docs), the same
 * verification standard the rest of this module already holds itself to.
 */
import type {
  MachineRollup,
  MachinesState,
  MapBuilding,
  MapMover,
  PowerCircuit,
  PowerState,
  ProductionState,
  SinkState,
  StorageState,
} from "@scc/shared";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberField(
  record: Record<string, unknown> | undefined,
  name: string,
): number | undefined {
  const value = record?.[name];
  return typeof value === "number" ? value : undefined;
}

function stringField(
  record: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  const value = record?.[name];
  return typeof value === "string" ? value : undefined;
}

function booleanField(
  record: Record<string, unknown> | undefined,
  name: string,
): boolean | undefined {
  const value = record?.[name];
  return typeof value === "boolean" ? value : undefined;
}

/** `getPower` -> the power domain: one entry per circuit FRM reports. */
export function mapPower(raw: unknown): PowerState {
  const circuits = asArray(raw).flatMap((item): PowerCircuit[] => {
    const record = asRecord(item);
    const id = numberField(record, "CircuitGroupID");
    const capacityMW = numberField(record, "PowerCapacity");
    if (id === undefined || capacityMW === undefined) return [];

    return [
      {
        id: String(id),
        productionMW: numberField(record, "PowerProduction") ?? null,
        consumptionMW: numberField(record, "PowerConsumed") ?? null,
        capacityMW,
        batteryPercent: numberField(record, "BatteryPercent") ?? null,
        fuseTripped: booleanField(record, "FuseTriggered") ?? null,
      },
    ];
  });

  circuits.sort((a, b) => Number(a.id) - Number(b.id));
  return { circuits };
}

/**
 * `getProdStats` -> the production domain. FRM already reports per-item actual
 * and theoretical-max rates aggregated across every machine, which is exactly
 * the shape this domain models — no re-aggregation needed, unlike the baseline
 * extractor working from raw per-machine save objects.
 */
export function mapProduction(raw: unknown): ProductionState {
  const items = asArray(raw).flatMap((item) => {
    const record = asRecord(item);
    const className = stringField(record, "ClassName");
    const maxPerMin = numberField(record, "MaxProd");
    if (!className || maxPerMin === undefined) return [];

    return [
      {
        className,
        displayName: stringField(record, "Name") ?? className,
        currentPerMin: numberField(record, "CurrentProd") ?? null,
        maxPerMin,
      },
    ];
  });

  items.sort((a, b) => b.maxPerMin - a.maxPerMin || a.className.localeCompare(b.className));
  return { items };
}

/**
 * `getFactory` -> the machines domain: per-building-class rollups of how many
 * machines are producing, idle, or paused, plus their average actual output
 * (`Productivity`) against installed rate. Grouped by `ClassName` (the
 * building type, e.g. `Build_ConstructorMk1_C`) — `getFactory` reports one
 * entry per physical machine, not per item, so this is the aggregation the
 * baseline extractor can't do (machine running state is runtime-only).
 *
 * An unconfigured machine (`IsConfigured: false` — no recipe set, the same
 * "not yet a producer" state `extractBaseline.ts`'s `extractMachines` skips
 * entirely) is excluded here too, not just from the efficiency average: an
 * unconfigured Constructor reports `IsProducing: false`, so counting it as
 * an idle machine would make a freshly-placed, not-yet-configured building
 * register as a stalled production line, and would make `totalCount` swing
 * on nothing but which source answered — live vs. baseline.
 *
 * A paused (but configured) machine still reports a `Productivity` of 0, so
 * counting it toward the efficiency average (rather than excluding it as "no
 * data") is what makes a machine switched off in-game visible in the
 * rollup's efficiency figure, not just in its own status count.
 */
export function mapMachines(raw: unknown): MachinesState {
  interface Group {
    displayName: string;
    total: number;
    producing: number;
    idle: number;
    paused: number;
    efficiencySum: number;
    efficiencyCount: number;
  }
  const groups = new Map<string, Group>();

  for (const item of asArray(raw)) {
    const record = asRecord(item);
    const className = stringField(record, "ClassName");
    if (!className) continue;
    if (!(booleanField(record, "IsConfigured") ?? false)) continue;

    const group = groups.get(className) ?? {
      displayName: stringField(record, "Name") ?? className,
      total: 0,
      producing: 0,
      idle: 0,
      paused: 0,
      efficiencySum: 0,
      efficiencyCount: 0,
    };
    group.total += 1;

    const paused = booleanField(record, "IsPaused") ?? false;
    const producing = booleanField(record, "IsProducing") ?? false;
    if (paused) group.paused += 1;
    else if (producing) group.producing += 1;
    else group.idle += 1;

    const productivity = numberField(record, "Productivity");
    if (productivity !== undefined) {
      group.efficiencySum += productivity;
      group.efficiencyCount += 1;
    }

    groups.set(className, group);
  }

  const machines: MachineRollup[] = [...groups].map(([className, group]) => ({
    className,
    displayName: group.displayName,
    totalCount: group.total,
    producingCount: group.producing,
    idleCount: group.idle,
    pausedCount: group.paused,
    averageEfficiencyPercent:
      group.efficiencyCount > 0
        ? Math.round((group.efficiencySum / group.efficiencyCount) * 100) / 100
        : null,
  }));

  machines.sort((a, b) => b.totalCount - a.totalCount || a.className.localeCompare(b.className));
  return { machines };
}

/**
 * `getStorageInv` -> the storage domain, item totals aggregated across every
 * container FRM reports (mirrors `extractBaseline.ts`'s storage aggregation,
 * minus the dimensional depot: FRM reports that separately via `getCloudInv`
 * — see {@link mapDepot} — and `extractDepot` mirrors the same split on the
 * baseline side).
 */
export function mapStorage(raw: unknown): StorageState {
  const counts = new Map<string, { displayName: string; count: number }>();

  for (const container of asArray(raw)) {
    for (const stack of asArray(asRecord(container)?.Inventory)) {
      const record = asRecord(stack);
      const className = stringField(record, "ClassName");
      const amount = numberField(record, "Amount");
      if (!className || amount === undefined || amount <= 0) continue;

      const displayName = stringField(record, "Name") ?? className;
      const existing = counts.get(className);
      counts.set(className, { displayName, count: (existing?.count ?? 0) + amount });
    }
  }

  const items = [...counts].map(([className, { displayName, count }]) => ({
    className,
    displayName,
    count,
  }));

  items.sort((a, b) => b.count - a.count || a.className.localeCompare(b.className));
  return { items };
}

/**
 * `getCloudInv` -> the depot domain: the dimensional depot's item totals,
 * reported flat (unlike `getStorageInv`, there's only one depot, so no
 * per-container grouping to do).
 */
export function mapDepot(raw: unknown): StorageState {
  const items = asArray(raw).flatMap((entry) => {
    const record = asRecord(entry);
    const className = stringField(record, "ClassName");
    const amount = numberField(record, "Amount");
    if (!className || amount === undefined || amount <= 0) return [];

    return [{ className, displayName: stringField(record, "Name") ?? className, count: amount }];
  });

  items.sort((a, b) => b.count - a.count || a.className.localeCompare(b.className));
  return { items };
}

/**
 * `getResourceSink` -> the sink domain: AWESOME Sink points and coupons.
 * FRM's documented example wraps the payload in a single-element array; a
 * bare object is accepted too, the same defensive either-shape handling
 * `mapSessionName` applies to `getSessionInfo`.
 */
export function mapSink(raw: unknown): SinkState {
  const record = Array.isArray(raw) ? asRecord(raw[0]) : asRecord(raw);
  return {
    totalPoints: numberField(record, "TotalPoints") ?? 0,
    numCoupons: numberField(record, "NumCoupon") ?? 0,
    pointsToNextCoupon: numberField(record, "PointsToCoupon") ?? null,
    percentToNextCoupon: numberField(record, "Percent") ?? null,
  };
}

/**
 * `getSessionInfo` -> the session name FRM is currently streaming, or null when
 * the payload doesn't look like session info at all. Callers must treat null as
 * "this push taught us nothing" and ignore it, never as "the session went away" —
 * FRM has no way to report an absent session while connected.
 *
 * A plain HTTP poll returns the session object directly; the WebSocket envelope's
 * documented shape wraps every endpoint's payload in a `data` array, single
 * object endpoints included. Both are accepted here rather than in the
 * transport, since it's the same "which shape did FRM actually send" question
 * either way.
 */
export function mapSessionName(raw: unknown): string | null {
  const record = Array.isArray(raw) ? asRecord(raw[0]) : asRecord(raw);
  return stringField(record, "SessionName") ?? null;
}

/* ---------------------------------------------------------------------------
 * Tier 1 map (build 8): building placements and live movers.
 * ------------------------------------------------------------------------- */

/** Every mapped endpoint's `location` object: world placement plus yaw, in
 *  the same shape FRM documents for `getFactory`, `getPlayer`, `getVehicles`,
 *  `getTrains` and `getDrone` alike. */
interface FrmLocation {
  x: number;
  y: number;
  z: number;
  rotationDegrees: number;
}

function locationField(record: Record<string, unknown> | undefined): FrmLocation | undefined {
  const location = asRecord(record?.location);
  const x = numberField(location, "x");
  const y = numberField(location, "y");
  const z = numberField(location, "z");
  if (x === undefined || y === undefined || z === undefined) return undefined;
  return { x, y, z, rotationDegrees: numberField(location, "rotation") ?? 0 };
}

/** `ID` arrives as a string on most endpoints but as a bare number on
 *  `getVehicles` (confirmed in FRM's own example response) — read either,
 *  falling back to a positional id so one malformed entry can't collide with
 *  another rather than being dropped (unlike building/mover *class*, which
 *  fine to drop the entry over, an id is only ever used as a React/diff key). */
function idField(record: Record<string, unknown> | undefined, fallbackIndex: number): string {
  const value = record?.ID;
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number") return String(value);
  return `unknown-${fallbackIndex}`;
}

/** `BoundingBox.{min,max}.{x,y}` -> a ground-plane footprint, when FRM
 *  reports one (documented on `getFactory`; not on the mover endpoints,
 *  which fall back to a fixed per-kind default). */
function footprintFromBoundingBox(
  record: Record<string, unknown> | undefined,
): { widthCm: number; depthCm: number } | undefined {
  const box = asRecord(record?.BoundingBox);
  const min = asRecord(box?.min);
  const max = asRecord(box?.max);
  const minX = numberField(min, "x");
  const maxX = numberField(max, "x");
  const minY = numberField(min, "y");
  const maxY = numberField(max, "y");
  if (minX === undefined || maxX === undefined || minY === undefined || maxY === undefined) {
    return undefined;
  }
  return { widthCm: Math.abs(maxX - minX), depthCm: Math.abs(maxY - minY) };
}

/** Stand-in footprint for a building FRM didn't report a bounding box for —
 *  same order of magnitude as `extractBaseline.ts`'s baseline default, kept
 *  as its own constant since the two modules don't share fixtures. */
const DEFAULT_BUILDING_FOOTPRINT_CM = { widthCm: 800, depthCm: 800 };
const DEFAULT_PLAYER_FOOTPRINT_CM = { widthCm: 100, depthCm: 100 };
const DEFAULT_VEHICLE_FOOTPRINT_CM = { widthCm: 400, depthCm: 800 };
const DEFAULT_TRAIN_FOOTPRINT_CM = { widthCm: 400, depthCm: 2000 };
const DEFAULT_DRONE_FOOTPRINT_CM = { widthCm: 300, depthCm: 300 };

/**
 * `getFactory` -> the map's buildings layer (a second, per-instance mapping
 * of the same endpoint {@link mapMachines} aggregates). `status` is the one
 * thing this build's baseline extraction can never know: `no-power` when the
 * building's own circuit has tripped its fuse, `running` while actually
 * producing, `idle` otherwise (paused, or configured but starved/stopped).
 * An unconfigured machine — no recipe set — is excluded, mirroring
 * `mapMachines`'s own exclusion and keeping the map's building population
 * identical to the machines domain's.
 */
export function mapFactoryBuildings(raw: unknown): MapBuilding[] {
  const buildings = asArray(raw).flatMap((item, index): MapBuilding[] => {
    const record = asRecord(item);
    if (!(booleanField(record, "IsConfigured") ?? false)) return [];

    const className = stringField(record, "ClassName");
    const location = locationField(record);
    if (!className || !location) return [];

    const fuseTripped = booleanField(asRecord(record?.PowerInfo), "FuseTriggered") ?? false;
    const producing = booleanField(record, "IsProducing") ?? false;

    return [
      {
        id: idField(record, index),
        className,
        displayName: stringField(record, "Name") ?? className,
        transform: location,
        footprint: footprintFromBoundingBox(record) ?? DEFAULT_BUILDING_FOOTPRINT_CM,
        status: fuseTripped ? "no-power" : producing ? "running" : "idle",
      },
    ];
  });

  buildings.sort((a, b) => a.id.localeCompare(b.id));
  return buildings;
}

/** `getPlayer` -> the map's player movers. Offline players (logged out, but
 *  still in FRM's last response) are excluded — otherwise a marker would sit
 *  frozen wherever someone logged off, which is exactly the stale-ghost
 *  reading the live-only movers domain exists to avoid. */
export function mapPlayers(raw: unknown): MapMover[] {
  const movers = asArray(raw).flatMap((item, index): MapMover[] => {
    const record = asRecord(item);
    if (!(booleanField(record, "Online") ?? false)) return [];

    const location = locationField(record);
    if (!location) return [];

    return [
      {
        id: idField(record, index),
        kind: "player",
        displayName: stringField(record, "Name") ?? "Player",
        transform: location,
        footprint: DEFAULT_PLAYER_FOOTPRINT_CM,
      },
    ];
  });

  movers.sort((a, b) => a.id.localeCompare(b.id));
  return movers;
}

/**
 * `getVehicles` -> the map's vehicle movers (explorers, tractors, trucks,
 * factory carts). FRM's documented example response omits `Name`/`ClassName`
 * in favor of a bare `VehicleType` field, unlike every other endpoint this
 * module reads — all three are tried, in that order, before falling back to
 * a generic label.
 */
export function mapVehicles(raw: unknown): MapMover[] {
  const movers = asArray(raw).flatMap((item, index): MapMover[] => {
    const record = asRecord(item);
    const location = locationField(record);
    if (!location) return [];

    return [
      {
        id: idField(record, index),
        kind: "vehicle",
        displayName:
          stringField(record, "Name") ??
          stringField(record, "VehicleType") ??
          stringField(record, "ClassName") ??
          "Vehicle",
        transform: location,
        footprint: DEFAULT_VEHICLE_FOOTPRINT_CM,
      },
    ];
  });

  movers.sort((a, b) => a.id.localeCompare(b.id));
  return movers;
}

/** `getTrains` -> the map's train movers. */
export function mapTrains(raw: unknown): MapMover[] {
  const movers = asArray(raw).flatMap((item, index): MapMover[] => {
    const record = asRecord(item);
    const location = locationField(record);
    if (!location) return [];

    return [
      {
        id: idField(record, index),
        kind: "train",
        displayName: stringField(record, "Name") ?? "Train",
        transform: location,
        footprint: DEFAULT_TRAIN_FOOTPRINT_CM,
      },
    ];
  });

  movers.sort((a, b) => a.id.localeCompare(b.id));
  return movers;
}

/** `getDrone` -> the map's drone movers. */
export function mapDrones(raw: unknown): MapMover[] {
  const movers = asArray(raw).flatMap((item, index): MapMover[] => {
    const record = asRecord(item);
    const location = locationField(record);
    if (!location) return [];

    return [
      {
        id: idField(record, index),
        kind: "drone",
        displayName: stringField(record, "Name") ?? "Drone",
        transform: location,
        footprint: DEFAULT_DRONE_FOOTPRINT_CM,
      },
    ];
  });

  movers.sort((a, b) => a.id.localeCompare(b.id));
  return movers;
}
