/**
 * The SSE payload contract. The server pushes WorldState over a single
 * Server-Sent Events stream (ADR 0003); the browser's native EventSource handles
 * reconnect. Both server and client encode/decode through the helpers here so the
 * wire format has exactly one definition.
 *
 * Events travel as the default SSE `message` event with a JSON {@link ServerEvent}
 * envelope in the data field. The envelope is a discriminated union so later
 * slices can add delta pushes alongside the full snapshot without breaking clients.
 */
import type { WorldState } from "./worldState.js";

/** Full-snapshot push — the whole current WorldState. */
export interface SnapshotEvent {
  type: "snapshot";
  worldState: WorldState;
}

/** Every message the server can push over the SSE stream. */
export type ServerEvent = SnapshotEvent;

/** Serialize a server event to the string placed in an SSE `data:` field. */
export function serializeEvent(event: ServerEvent): string {
  return JSON.stringify(event);
}

/**
 * Parse the raw `data` string from an SSE message back into a typed ServerEvent.
 * Throws if the payload isn't a recognized event shape, so a malformed frame
 * fails loudly rather than flowing on as `any`.
 */
export function deserializeEvent(raw: string): ServerEvent {
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { type?: unknown }).type !== "snapshot"
  ) {
    throw new Error("Unrecognized SSE event payload");
  }
  return parsed as ServerEvent;
}

/**
 * Encode a server event as a complete SSE frame (terminated by a blank line),
 * ready to write to the response stream.
 */
export function encodeSseFrame(event: ServerEvent): string {
  return `data: ${serializeEvent(event)}\n\n`;
}
