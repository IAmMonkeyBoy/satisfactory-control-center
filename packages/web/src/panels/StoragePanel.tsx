import type { JSX } from "react";
import type {
  DeathCrate,
  SourceAgeTag,
  StorageItem,
  StorageSearchMatch,
  WorldState,
} from "@scc/shared";
import { PanelFrame } from "../alarms/PanelFrame";
import { formatCoupons, formatLocation, formatPoints } from "../storage/storageFormat";
import { useStorageSearch } from "../storage/useStorageSearch";
import { FreshnessTag } from "./FreshnessTag";

/**
 * Storage/inventory (spec, "Storage/inventory panel"): item-location search
 * across containers, dimensional-depot inventory, death-crate locations and
 * contents, and AWESOME Sink points/coupons — the "know where all your
 * stuff is" pillar. Search is a REST request/response query (ADR 0003), so it
 * carries its own freshness tag rather than reading one off a WorldState
 * domain; depot, death crates, and sink each carry their own domain tag —
 * death crates are always baseline (FRM doesn't expose them in this build),
 * so its tag stays honestly stale while playing.
 */
export function StoragePanel({
  worldState,
  now,
  className,
}: {
  worldState: WorldState;
  now: number;
  className?: string;
}): JSX.Element {
  const search = useStorageSearch();

  return (
    <PanelFrame title="Storage" className={className}>
      <SearchSection
        query={search.query}
        setQuery={search.setQuery}
        matches={search.result?.matches ?? null}
        tag={search.result?.tag}
        now={now}
      />

      <Section title="Depot" right={<FreshnessTag tag={worldState.depot.tag} now={now} />}>
        <DepotItems items={worldState.depot.data.items} />
      </Section>

      <Section
        title="Death crates"
        right={<FreshnessTag tag={worldState.deathCrates.tag} now={now} />}
      >
        <DeathCrateList crates={worldState.deathCrates.data.crates} />
      </Section>

      <Section title="AWESOME Sink" right={<FreshnessTag tag={worldState.sink.tag} now={now} />}>
        <SinkSummary
          totalPoints={worldState.sink.data.totalPoints}
          numCoupons={worldState.sink.data.numCoupons}
        />
      </Section>
    </PanelFrame>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: JSX.Element;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div className="mt-3 border-t border-neutral-800 pt-2 first:mt-0 first:border-t-0 first:pt-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-xs uppercase tracking-wider text-neutral-500">{title}</span>
        {right && <span className="text-xs text-neutral-600">{right}</span>}
      </div>
      {children}
    </div>
  );
}

function SearchSection({
  query,
  setQuery,
  matches,
  tag,
  now,
}: {
  query: string;
  setQuery: (query: string) => void;
  matches: StorageSearchMatch[] | null;
  tag: SourceAgeTag | undefined;
  now: number;
}): JSX.Element {
  return (
    <Section title="Find an item" right={tag ? <FreshnessTag tag={tag} now={now} /> : undefined}>
      <div className="space-y-2">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search containers…"
          className="w-full rounded border border-neutral-800 bg-metal-950 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-ficsit-orange focus:outline-none"
        />
        {query.trim() !== "" && (
          <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
            {matches === null ? (
              <li className="text-neutral-600">Searching…</li>
            ) : matches.length === 0 ? (
              <li className="text-neutral-600">No containers hold that item.</li>
            ) : (
              matches.map((match, index) => (
                <li key={`${match.containerId}-${match.itemClassName}-${index}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-neutral-200" title={match.containerDisplayName}>
                      {match.itemDisplayName} × {match.count.toLocaleString()}
                    </span>
                  </div>
                  <div className="text-xs text-neutral-600">
                    {match.containerDisplayName} · {formatLocation(match.location)}
                  </div>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </Section>
  );
}

function DepotItems({ items }: { items: StorageItem[] }): JSX.Element {
  if (items.length === 0) return <p className="text-sm text-neutral-600">Depot is empty.</p>;

  return (
    <ul className="space-y-1 text-sm">
      {items.map((item) => (
        <li key={item.className} className="flex items-baseline justify-between gap-3">
          <span className="truncate text-neutral-300">{item.displayName}</span>
          <span className="text-neutral-500">{item.count.toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

function DeathCrateList({ crates }: { crates: DeathCrate[] }): JSX.Element {
  if (crates.length === 0) {
    return <p className="text-sm text-neutral-600">No death crates on the map.</p>;
  }

  return (
    <ul className="space-y-2 text-sm">
      {crates.map((crate) => {
        const totalItems = crate.items.reduce((sum, item) => sum + item.count, 0);
        return (
          <li key={crate.id} className="border-l-2 border-alarm-warning pl-2">
            <div className="text-neutral-300">{formatLocation(crate.location)}</div>
            <div className="text-xs text-neutral-600">
              {crate.items.length === 0
                ? "empty"
                : `${crate.items.length} item${crate.items.length === 1 ? "" : "s"}, ${totalItems.toLocaleString()} total`}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function SinkSummary({
  totalPoints,
  numCoupons,
}: {
  totalPoints: number;
  numCoupons: number;
}): JSX.Element {
  return (
    <p className="text-sm text-neutral-300">
      {formatPoints(totalPoints)} points · {formatCoupons(numCoupons)}
    </p>
  );
}
