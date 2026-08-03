import type { JSX } from "react";
import type { Domain, SourceAgeTag, WorldState } from "@scc/shared";
import { useWorldState, type ConnectionStatus } from "./useWorldState";
import { ageLabel, sourceLabel } from "./format";

/**
 * Build 1 dashboard. This is a deliberately plain render of the dummy WorldState
 * to prove the transport contract end-to-end; the Map Deck layout and FICSIT
 * styling arrive in Build 4. Every domain shows its source/age tag so freshness
 * is honest from the very first slice.
 */
export default function App(): JSX.Element {
  const { worldState, status } = useWorldState();

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <header className="mb-6 flex items-baseline justify-between border-b border-neutral-800 pb-3">
        <h1 className="text-xl font-semibold tracking-wide">
          Satisfactory <span className="text-ficsit-orange">Control Center</span>
        </h1>
        <ConnectionBadge status={status} />
      </header>

      {worldState ? (
        <Dashboard worldState={worldState} />
      ) : (
        <p className="text-neutral-400">Waiting for the first WorldState snapshot…</p>
      )}
    </div>
  );
}

function ConnectionBadge({ status }: { status: ConnectionStatus }): JSX.Element {
  const label: Record<ConnectionStatus, string> = {
    connecting: "Connecting…",
    live: "Live",
    reconnecting: "Reconnecting…",
  };
  const dot: Record<ConnectionStatus, string> = {
    connecting: "bg-amber-400",
    live: "bg-emerald-400",
    reconnecting: "bg-red-400 animate-pulse",
  };
  return (
    <span className="flex items-center gap-2 text-sm text-neutral-300">
      <span className={`h-2.5 w-2.5 rounded-full ${dot[status]}`} />
      {label[status]}
    </span>
  );
}

function Dashboard({ worldState }: { worldState: WorldState }): JSX.Element {
  const now = Date.now();
  const circuit = worldState.power.data.circuits[0];

  return (
    <div className="space-y-6">
      <FollowingIndicator worldState={worldState} now={now} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Power" domain={worldState.power} now={now}>
          {circuit ? (
            <ul className="space-y-1 text-sm">
              <Stat label="Production" value={`${circuit.productionMW} MW`} />
              <Stat label="Consumption" value={`${circuit.consumptionMW} MW`} />
              <Stat label="Capacity" value={`${circuit.capacityMW} MW`} />
              {circuit.batteryPercent !== null && (
                <Stat label="Battery" value={`${circuit.batteryPercent}%`} />
              )}
              <Stat
                label="Fuse"
                value={circuit.fuseTripped ? "TRIPPED" : "OK"}
                emphasis={circuit.fuseTripped}
              />
            </ul>
          ) : (
            <p className="text-neutral-400 text-sm">No circuits.</p>
          )}
        </Panel>

        <Panel title="Production" domain={worldState.production} now={now}>
          <ul className="space-y-1 text-sm">
            {worldState.production.data.items.map((item) => (
              <Stat
                key={item.className}
                label={item.displayName}
                value={`${item.currentPerMin} / ${item.maxPerMin} /min`}
              />
            ))}
          </ul>
        </Panel>

        <Panel title="Storage" domain={worldState.storage} now={now}>
          <ul className="space-y-1 text-sm">
            {worldState.storage.data.items.map((item) => (
              <Stat
                key={item.className}
                label={item.displayName}
                value={item.count.toLocaleString()}
              />
            ))}
          </ul>
        </Panel>

        <Panel title="Milestones" domain={worldState.milestones} now={now}>
          <ul className="space-y-1 text-sm">
            <Stat label="Current milestone" value={worldState.milestones.data.currentMilestone} />
            <Stat label="Space Elevator" value={worldState.milestones.data.spaceElevatorPhase} />
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function FollowingIndicator({
  worldState,
  now,
}: {
  worldState: WorldState;
  now: number;
}): JSX.Element {
  // Summarize freshness from the liveliest domain the UI leads with.
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/60 px-4 py-2 text-sm text-neutral-300">
      <span className="font-medium text-neutral-100">{worldState.followedSession.sessionName}</span>
      <span className="text-neutral-500"> · </span>
      <FreshnessTag tag={worldState.power.tag} now={now} />
    </div>
  );
}

/** The shared "source · age" freshness label rendered for every tagged domain. */
function FreshnessTag({ tag, now }: { tag: SourceAgeTag; now: number }): JSX.Element {
  return (
    <>
      {sourceLabel(tag.source)} · {ageLabel(tag, now)}
    </>
  );
}

function Panel({
  title,
  domain,
  now,
  children,
}: {
  title: string;
  domain: Domain<unknown>;
  now: number;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">{title}</h2>
        <span className="text-xs text-neutral-500">
          <FreshnessTag tag={domain.tag} now={now} />
        </span>
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}): JSX.Element {
  return (
    <li className="flex items-baseline justify-between gap-4">
      <span className="text-neutral-400">{label}</span>
      <span className={emphasis ? "font-semibold text-red-400" : "text-neutral-100"}>{value}</span>
    </li>
  );
}
