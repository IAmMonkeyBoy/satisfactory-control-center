import { useMemo, type JSX } from "react";
import type { MachineRollup, ProductionItem, WorldState } from "@scc/shared";
import { PanelFrame } from "../alarms/PanelFrame";
import { usePanelAlarms } from "../alarms/usePanelAlarms";
import { optionalValue } from "../format";
import { productionAlarms } from "../production/productionAlarms";
import { formatPerMin, notableItems } from "../production/productionItems";
import {
  productionSeriesKey,
  productionSparklineSamples,
} from "../production/productionSparklineSamples";
import { Sparkline } from "../sparklines/Sparkline";
import { useSparklineWindow } from "../sparklines/useSparklineWindow";
import type { SparklineSeriesMap } from "../sparklines/sparklineWindow";
import { FreshnessTag } from "./FreshnessTag";

/**
 * The production ticker (spec, "Production efficiency panel"): per-item
 * current vs. max rates and per-building-class machine efficiency rollups,
 * fed by the live feed's `getProdStats`/`getFactory` pushes with baseline
 * fallback. Two WorldState domains feed one panel, each on its own FRM push
 * cycle, so items and machines carry their own freshness tag rather than
 * sharing one.
 */
export function ProductionPanel({
  worldState,
  now,
  className,
}: {
  worldState: WorldState;
  now: number;
  className?: string;
}): JSX.Element {
  const items = notableItems(worldState.production.data.items);
  const machines = worldState.machines.data.machines;
  const alarms = useMemo(() => productionAlarms(machines), [machines]);
  const severity = usePanelAlarms("production", alarms);
  const sparklineWindow = useSparklineWindow(worldState, productionSparklineSamples);

  return (
    <PanelFrame
      title="Production"
      alarmSeverity={severity}
      right={<FreshnessTag tag={worldState.production.tag} now={now} />}
      className={className}
    >
      {items.length === 0 ? (
        <p className="text-sm text-neutral-400">No production yet.</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {items.map((item) => (
            <ProductionItemCard key={item.className} item={item} series={sparklineWindow.series} />
          ))}
        </div>
      )}

      {machines.length > 0 && (
        <div className="mt-3 border-t border-neutral-800 pt-2">
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="text-xs uppercase tracking-wider text-neutral-500">
              Machine efficiency
            </span>
            <span className="text-xs text-neutral-600">
              <FreshnessTag tag={worldState.machines.tag} now={now} />
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {machines.map((machine) => (
              <MachineRollupChip key={machine.className} machine={machine} />
            ))}
          </div>
        </div>
      )}
    </PanelFrame>
  );
}

function ProductionItemCard({
  item,
  series,
}: {
  item: ProductionItem;
  series: SparklineSeriesMap;
}): JSX.Element {
  const rate = series.get(productionSeriesKey(item.className)) ?? [];

  return (
    <div className="w-36 flex-none border-l-2 border-neutral-800 pl-2">
      <div className="truncate text-xs text-neutral-300" title={item.displayName}>
        {item.displayName}
      </div>
      {rate.length > 1 && (
        <div className="my-1">
          <Sparkline width={130} height={22} series={[{ series: rate, color: "#f2a33c" }]} />
        </div>
      )}
      <div className="text-xs">
        <span className={item.currentPerMin === null ? "text-neutral-600" : "text-neutral-300"}>
          {optionalValue(item.currentPerMin, formatPerMin)}
        </span>
        <span className="text-neutral-600"> / {formatPerMin(item.maxPerMin)}</span>
      </div>
    </div>
  );
}

function MachineRollupChip({ machine }: { machine: MachineRollup }): JSX.Element {
  const stalled = machine.totalCount > 0 && machine.producingCount === 0;

  return (
    <div
      className={`rounded border px-2 py-1 text-xs ${stalled ? "border-alarm-critical" : "border-neutral-800"}`}
    >
      <div className="text-neutral-300">{machine.displayName}</div>
      <div className="text-neutral-500">
        {machine.producingCount === null
          ? `${machine.totalCount} installed`
          : `${machine.producingCount}/${machine.totalCount} running`}
        {machine.averageEfficiencyPercent !== null &&
          ` · ${Math.round(machine.averageEfficiencyPercent)}% eff`}
      </div>
    </div>
  );
}
