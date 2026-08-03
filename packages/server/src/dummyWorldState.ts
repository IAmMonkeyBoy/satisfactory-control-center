import type { WorldState } from "@scc/shared";

/**
 * Build a dummy WorldState for the foundation slice. There are no real ingestors
 * yet (those arrive in Builds 2–3); this stands in so the transport contract can
 * be proven end-to-end. The values wobble gently with `now` so the live dashboard
 * visibly updates and reconnect is observable, and each domain carries a plausible
 * source/age tag exercising the real freshness fields.
 */
export function makeDummyWorldState(now: number): WorldState {
  // A slow oscillation so numbers drift instead of sitting still.
  const phase = (now / 1000) % 60;
  const wobble = Math.sin((phase / 60) * Math.PI * 2);

  const productionMW = 1200 + Math.round(wobble * 150);
  const consumptionMW = 1100 + Math.round(Math.cos((phase / 60) * Math.PI * 2) * 120);

  return {
    generatedAt: now,
    followedSession: { sessionName: "Random Defaults" },
    power: {
      tag: { source: "live", capturedAt: now },
      data: {
        circuits: [
          {
            id: "Circuit 1",
            productionMW,
            consumptionMW,
            capacityMW: 1400,
            batteryPercent: Math.max(0, Math.min(100, 60 + Math.round(wobble * 30))),
            fuseTripped: consumptionMW > productionMW,
          },
        ],
      },
    },
    production: {
      tag: { source: "live", capturedAt: now },
      data: {
        items: [
          {
            className: "Desc_IronPlate_C",
            displayName: "Iron Plate",
            currentPerMin: 90 + Math.round(wobble * 10),
            maxPerMin: 120,
          },
          {
            className: "Desc_ModularFrame_C",
            displayName: "Modular Frame",
            currentPerMin: 8 + Math.round(wobble * 2),
            maxPerMin: 10,
          },
        ],
      },
    },
    storage: {
      // Baseline domain: sourced from the last save, so it's a few minutes old.
      tag: { source: "baseline", capturedAt: now - 4 * 60 * 1000 },
      data: {
        items: [
          { className: "Desc_IronPlate_C", displayName: "Iron Plate", count: 4820 },
          { className: "Desc_Cable_C", displayName: "Cable", count: 1210 },
        ],
      },
    },
    milestones: {
      tag: { source: "baseline", capturedAt: now - 4 * 60 * 1000 },
      data: {
        currentMilestone: "Coal Power",
        spaceElevatorPhase: "Phase 2: Distribution Platform",
      },
    },
  };
}
