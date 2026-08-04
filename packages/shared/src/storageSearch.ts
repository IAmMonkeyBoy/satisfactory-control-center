/**
 * The item-location search contract — a REST GET, not part of WorldState.
 *
 * Per ADR 0003, request/response needs like storage search are REST GETs, not
 * pushed over SSE with every WorldState snapshot: a full per-container
 * breakdown of every item in every building is a lot of payload to push on
 * every tick for a feature only used on demand. It is also baseline-only
 * (spec, "Followed session and merge rules": "full container inventories" is
 * a domain FRM doesn't expose), so the response carries its own source/age
 * tag rather than inheriting one from a WorldState domain.
 */
import { z } from "zod";
import { sourceAgeTagSchema, worldLocationSchema } from "./worldState.ts";

export const storageSearchMatchSchema = z.object({
  containerId: z.string(),
  containerDisplayName: z.string(),
  location: worldLocationSchema,
  itemClassName: z.string(),
  itemDisplayName: z.string(),
  count: z.number(),
});
export type StorageSearchMatch = z.infer<typeof storageSearchMatchSchema>;

export const storageSearchResponseSchema = z.object({
  query: z.string(),
  tag: sourceAgeTagSchema,
  matches: z.array(storageSearchMatchSchema),
});
export type StorageSearchResponse = z.infer<typeof storageSearchResponseSchema>;
