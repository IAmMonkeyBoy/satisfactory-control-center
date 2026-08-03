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
 * the domain already models), `getStorageInv` (storage), and `getSessionInfo`
 * (session identity, for the followed-session gating rules — not a domain
 * itself). `getFactory` (per-machine detail) and `getTrains` (map movers) have
 * no WorldState domain to land in yet; they arrive with the production
 * efficiency panel and the Tier 1 map (spec, build tickets 5 and 8).
 */
import type { PowerCircuit, PowerState, ProductionState, StorageState } from "@scc/shared";

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
