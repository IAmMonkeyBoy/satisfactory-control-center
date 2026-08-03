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
 * the machines domain), `getStorageInv` (storage), and `getSessionInfo`
 * (session identity, for the followed-session gating rules — not a domain
 * itself). `getTrains` (map movers) has no WorldState domain to land in yet;
 * it arrives with the Tier 1 map (spec, build ticket 8).
 */
import type {
  MachineRollup,
  MachinesState,
  PowerCircuit,
  PowerState,
  ProductionState,
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
 * A paused machine still reports `IsConfigured: true` with a `Productivity`
 * of 0, so counting it toward the efficiency average (rather than excluding
 * it as "no data") is what makes a machine switched off in-game visible in
 * the rollup, not just in its own status count.
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

    if (booleanField(record, "IsConfigured") ?? false) {
      const productivity = numberField(record, "Productivity");
      if (productivity !== undefined) {
        group.efficiencySum += productivity;
        group.efficiencyCount += 1;
      }
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
 * minus the dimensional depot: FRM exposes that separately via `getCloudInv`,
 * not among this build's subscribed endpoints).
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
