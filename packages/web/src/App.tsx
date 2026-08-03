import type { JSX } from "react";
import { AlarmProvider } from "./alarms/AlarmContext";
import { MapDeck } from "./layout/MapDeck";
import { useWorldState } from "./useWorldState";

/**
 * Build 4: the Map Deck command-center shell, live for the first time — power
 * panel, alarm framework, and sparklines all consume the same WorldState feed
 * that Build 1 proved end-to-end with a plain dummy render.
 */
export default function App(): JSX.Element {
  const { worldState, status } = useWorldState();

  return (
    <AlarmProvider>
      <MapDeck worldState={worldState} status={status} />
    </AlarmProvider>
  );
}
