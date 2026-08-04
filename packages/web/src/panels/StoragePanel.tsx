import type { JSX } from "react";
import type { DeathCrate, StorageItem, StorageSearchResponse, WorldState } from "@scc/shared";
import { PanelFrame } from "../alarms/PanelFrame";
import { CodexTrigger } from "../codex/CodexTrigger";
import { formatCoupons, formatLocation, formatPoints, hasBaseline } from "../storage/storageFormat";
import { useStorageSearch, type StorageSearchStatus } from "../storage/useStorageSearch";
import { FreshnessTag } from "./FreshnessTag";
import { Section } from "./Section";

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
  // Identifies which followed session/baseline the search index reflects —
  // `deathCrates.tag` is always the store's baseline tag (see its doc
  // comment below), so its `capturedAt` doubles as "the current baseline's
  // capture time" without reaching into store internals. A change here
  // (a session reset, or a newer save landing) invalidates the current
  // search result immediately (see `useStorageSearch`'s doc comment).
  const sourceKey = `${worldState.followedSession?.sessionName ?? ""}:${worldState.deathCrates.tag.capturedAt}`;
  const search = useStorageSearch(sourceKey);

  return (
    <PanelFrame title="Storage" className={className}>
      <SearchSection
        query={search.query}
        setQuery={search.setQuery}
        status={search.status}
        result={search.result}
        now={now}
      />

      <Section title="Depot" right={<FreshnessTag tag={worldState.depot.tag} now={now} />}>
        <DepotItems items={worldState.depot.data.items} />
      </Section>

      <Section
        title="Death crates"
        right={<FreshnessTag tag={worldState.deathCrates.tag} now={now} />}
      >
        <DeathCrateList
          crates={worldState.deathCrates.data.crates}
          baselineKnown={hasBaseline(worldState.deathCrates.tag)}
        />
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

function SearchSection({
  query,
  setQuery,
  status,
  result,
  now,
}: {
  query: string;
  setQuery: (query: string) => void;
  status: StorageSearchStatus;
  result: StorageSearchResponse | null;
  now: number;
}): JSX.Element {
  return (
    <Section
      title="Find an item"
      right={result ? <FreshnessTag tag={result.tag} now={now} /> : undefined}
    >
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
            <SearchResults status={status} result={result} />
          </ul>
        )}
      </div>
    </Section>
  );
}

function SearchResults({
  status,
  result,
}: {
  status: StorageSearchStatus;
  result: StorageSearchResponse | null;
}): JSX.Element {
  if (status === "searching") return <li className="text-neutral-600">Searching…</li>;
  if (status === "error") return <li className="text-neutral-600">Search failed — try again.</li>;
  if (!result) return <></>;

  if (!result.available) {
    return <li className="text-neutral-600">No save loaded yet — search needs a baseline.</li>;
  }
  if (result.matches.length === 0) {
    return <li className="text-neutral-600">No containers hold that item.</li>;
  }

  return (
    <>
      {result.matches.map((match, index) => (
        <li key={`${match.containerId}-${match.itemClassName}-${index}`}>
          <div className="flex items-baseline justify-between gap-2">
            <CodexTrigger
              kind="item"
              gameClassName={match.itemClassName}
              className="truncate text-left text-neutral-200"
              title={match.containerDisplayName}
            >
              {match.itemDisplayName} × {match.count.toLocaleString()}
            </CodexTrigger>
          </div>
          <div className="text-xs text-neutral-600">
            {match.containerDisplayName} · {formatLocation(match.location)}
          </div>
        </li>
      ))}
    </>
  );
}

function DepotItems({ items }: { items: StorageItem[] }): JSX.Element {
  if (items.length === 0) return <p className="text-sm text-neutral-600">Depot is empty.</p>;

  return (
    <ul className="space-y-1 text-sm">
      {items.map((item) => (
        <li key={item.className} className="flex items-baseline justify-between gap-3">
          <CodexTrigger
            kind="item"
            gameClassName={item.className}
            className="truncate text-left text-neutral-300"
          >
            {item.displayName}
          </CodexTrigger>
          <span className="text-neutral-500">{item.count.toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

function DeathCrateList({
  crates,
  baselineKnown,
}: {
  crates: DeathCrate[];
  baselineKnown: boolean;
}): JSX.Element {
  if (crates.length === 0) {
    return (
      <p className="text-sm text-neutral-600">
        {baselineKnown ? "No death crates on the map." : "Not yet known — waiting for a save."}
      </p>
    );
  }

  return (
    <ul className="space-y-2 text-sm">
      {crates.map((crate) => (
        <li key={crate.id} className="border-l-2 border-alarm-warning pl-2">
          <div className="text-neutral-300">{formatLocation(crate.location)}</div>
          {crate.items.length === 0 ? (
            <div className="text-xs text-neutral-600">empty</div>
          ) : (
            <ul className="text-xs text-neutral-500">
              {crate.items.map((item) => (
                <li key={item.className} className="flex items-baseline justify-between gap-2">
                  <CodexTrigger
                    kind="item"
                    gameClassName={item.className}
                    className="truncate text-left"
                  >
                    {item.displayName}
                  </CodexTrigger>
                  <span>{item.count.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
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
