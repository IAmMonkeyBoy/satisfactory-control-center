import type { JSX } from "react";
import type { Domain, PowerCircuit, SourceAgeTag, WorldState } from "@scc/shared";
import { useWorldState, type ConnectionStatus } from "./useWorldState";
import { ageLabel, optionalValue, sourceLabel } from "./format";
import { formatMW, idleCircuitCount, notableCircuits } from "./powerCircuits";

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

  return (
    <div className="space-y-6">
      <FollowingIndicator worldState={worldState} now={now} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Power" domain={worldState.power} now={now}>
          <PowerCircuits circuits={worldState.power.data.circuits} />
        </Panel>

        <Panel title="Production" domain={worldState.production} now={now}>
          <ul className="space-y-1 text-sm">
            {worldState.production.data.items.map((item) => (
              <Stat
                key={item.className}
                label={item.displayName}
                value={`${optionalValue(item.currentPerMin, String)} / ${item.maxPerMin} /min`}
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
            <Stat
              label="Current milestone"
              value={worldState.milestones.data.currentMilestone ?? "—"}
            />
            <Stat
              label="Space Elevator"
              value={worldState.milestones.data.spaceElevatorPhase ?? "—"}
            />
          </ul>
        </Panel>
      </div>
    </div>
  );
}

/**
 * The circuits worth showing, biggest grid first. A save can only fill capacity
 * and battery charge; production, draw and fuse state stay blank until the live
 * feed arrives, and blank is the point — a zero there would read as "all clear".
 */
function PowerCircuits({ circuits }: { circuits: PowerCircuit[] }): JSX.Element {
  const notable = notableCircuits(circuits);
  const idle = idleCircuitCount(circuits);

  if (notable.length === 0) {
    return (
      <p className="text-sm text-neutral-400">
        {circuits.length === 0 ? "No circuits." : `${circuits.length} circuits, none powered.`}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {notable.map((circuit) => (
        <div key={circuit.id} className="border-l-2 border-neutral-800 pl-3">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wider text-neutral-500">
              Circuit {circuit.id}
            </span>
            {circuit.batteryPercent !== null && (
              <span className="text-xs text-neutral-400">Battery {circuit.batteryPercent}%</span>
            )}
          </div>
          <ul className="space-y-1 text-sm">
            <Stat label="Installed capacity" value={formatMW(circuit.capacityMW)} />
            <Stat
              label="Production"
              value={optionalValue(circuit.productionMW, formatMW)}
              muted={circuit.productionMW === null}
            />
            <Stat
              label="Consumption"
              value={optionalValue(circuit.consumptionMW, formatMW)}
              muted={circuit.consumptionMW === null}
            />
            {circuit.fuseTripped !== null && (
              <Stat
                label="Fuse"
                value={circuit.fuseTripped ? "TRIPPED" : "OK"}
                emphasis={circuit.fuseTripped}
              />
            )}
          </ul>
        </div>
      ))}
      {idle > 0 && (
        <p className="text-xs text-neutral-600">
          {idle} further {idle === 1 ? "circuit" : "circuits"} with no generator or battery
        </p>
      )}
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
  const { followedSession } = worldState;
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/60 px-4 py-2 text-sm text-neutral-300">
      <span className="font-medium text-neutral-100">
        {followedSession?.sessionName ?? "No session yet"}
      </span>
      {followedSession && (
        <>
          <span className="text-neutral-500"> · </span>
          <FreshnessTag tag={followedSession} now={now} />
        </>
      )}
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
  muted,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  /** Dim a value the current source cannot answer, so it reads as absent. */
  muted?: boolean;
}): JSX.Element {
  const valueClass = emphasis
    ? "font-semibold text-red-400"
    : muted
      ? "text-neutral-600"
      : "text-neutral-100";
  return (
    <li className="flex items-baseline justify-between gap-4">
      <span className="text-neutral-400">{label}</span>
      <span className={valueClass}>{value}</span>
    </li>
  );
}
