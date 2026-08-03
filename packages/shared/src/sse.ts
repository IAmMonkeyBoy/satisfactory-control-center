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
import { z } from "zod";
import { worldStateSchema } from "./worldState.ts";

/** Full-snapshot push — the whole current WorldState. */
export const snapshotEventSchema = z.object({
  type: z.literal("snapshot"),
  worldState: worldStateSchema,
});
export type SnapshotEvent = z.infer<typeof snapshotEventSchema>;

/** Every message the server can push over the SSE stream. */
export const serverEventSchema = z.discriminatedUnion("type", [snapshotEventSchema]);
export type ServerEvent = z.infer<typeof serverEventSchema>;

/** Serialize a server event to the string placed in an SSE `data:` field. */
export function serializeEvent(event: ServerEvent): string {
  return JSON.stringify(event);
}

/**
 * Parse the raw `data` string from an SSE message into a fully-validated
 * ServerEvent. This is the untrusted transport boundary, so the entire payload —
 * including every nested WorldState domain — is checked against the schema, not
 * just the discriminant. A malformed or truncated frame throws a ZodError here
 * rather than flowing on and crashing the dashboard when it reads a missing field.
 */
export function deserializeEvent(raw: string): ServerEvent {
  return serverEventSchema.parse(JSON.parse(raw));
}

/**
 * Encode a server event as a complete SSE frame (terminated by a blank line),
 * ready to write to the response stream.
 */
export function encodeSseFrame(event: ServerEvent): string {
  return `data: ${serializeEvent(event)}\n\n`;
}
