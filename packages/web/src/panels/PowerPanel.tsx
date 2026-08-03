import { useMemo, type JSX } from "react";
import type { PowerCircuit, WorldState } from "@scc/shared";
import { PanelFrame } from "../alarms/PanelFrame";
import { usePanelAlarms } from "../alarms/usePanelAlarms";
import { batteryTrend } from "../power/batteryTimeToEmpty";
import { batteryTrendLabel } from "../power/batteryTrendLabel";
import { formatMW, idleCircuitCount, notableCircuits } from "../powerCircuits";
import { powerAlarms } from "../power/powerAlarms";
import { powerSeriesKey, powerSparklineSamples } from "../power/powerSparklineSamples";
import { Sparkline } from "../sparklines/Sparkline";
import { useSparklineWindow } from "../sparklines/useSparklineWindow";
import type { SparklineSeriesMap } from "../sparklines/sparklineWindow";
import { optionalValue } from "../format";
import { FreshnessTag } from "./FreshnessTag";
import { Stat } from "./Stat";

/**
 * Per-circuit production/consumption/capacity, battery % with time-to-empty,
 * and the fuse-tripped alarm (spec, "Power panel + alarms") — the first panel
 * to consume the alarm framework and the sparkline window.
 */
export function PowerPanel({
  worldState,
  now,
}: {
  worldState: WorldState;
  now: number;
}): JSX.Element {
  const circuits = worldState.power.data.circuits;
  const alarms = useMemo(() => powerAlarms(circuits), [circuits]);
  const severity = usePanelAlarms("power", alarms);
  const sparklineWindow = useSparklineWindow(worldState, powerSparklineSamples);

  const notable = notableCircuits(circuits);
  const idle = idleCircuitCount(circuits);

  return (
    <PanelFrame
      title="Power"
      alarmSeverity={severity}
      right={<FreshnessTag tag={worldState.power.tag} now={now} />}
    >
      {notable.length === 0 ? (
        <p className="text-sm text-neutral-400">
          {circuits.length === 0 ? "No circuits." : `${circuits.length} circuits, none powered.`}
        </p>
      ) : (
        <div className="space-y-3">
          {notable.map((circuit) => (
            <PowerCircuitRow key={circuit.id} circuit={circuit} series={sparklineWindow.series} />
          ))}
        </div>
      )}
      {idle > 0 && (
        <p className="mt-2 text-xs text-neutral-600">
          {idle} further {idle === 1 ? "circuit" : "circuits"} with no generator or battery
        </p>
      )}
    </PanelFrame>
  );
}

function PowerCircuitRow({
  circuit,
  series,
}: {
  circuit: PowerCircuit;
  series: SparklineSeriesMap;
}): JSX.Element {
  const production = series.get(powerSeriesKey(circuit.id, "production")) ?? [];
  const consumption = series.get(powerSeriesKey(circuit.id, "consumption")) ?? [];
  const battery = series.get(powerSeriesKey(circuit.id, "battery")) ?? [];
  const trend = batteryTrend(battery);
  const tripped = circuit.fuseTripped === true;

  return (
    <div className={`border-l-2 pl-3 ${tripped ? "border-alarm-critical" : "border-neutral-800"}`}>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-xs uppercase tracking-wider text-neutral-500">
          Circuit {circuit.id}
        </span>
        {tripped && <span className="text-xs font-semibold text-alarm-critical">FUSE TRIPPED</span>}
      </div>

      {(production.length > 1 || consumption.length > 1) && (
        <div className="mb-1.5">
          <Sparkline
            width={220}
            height={28}
            series={[
              { series: production, color: "#3987e5" },
              // Canvas strokeStyle can't resolve CSS custom properties, so this
              // repeats the `--color-ficsit-orange` theme token's literal value.
              { series: consumption, color: "#f2a33c" },
            ]}
          />
        </div>
      )}

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
        {circuit.batteryPercent !== null && (
          <Stat
            label="Battery"
            value={`${circuit.batteryPercent}% · ${batteryTrendLabel(trend)}`}
          />
        )}
      </ul>
    </div>
  );
}
