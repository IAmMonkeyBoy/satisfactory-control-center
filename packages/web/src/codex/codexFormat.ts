import type { CodexKind } from "@scc/shared";

/** The spec's own vocabulary ("item or machine"), not the wire kind's
 *  internal "building" — the popover's heading should read the way the
 *  feature is described, not the way the schema names it. */
export function kindLabel(kind: CodexKind): string {
  return kind === "item" ? "Item" : "Machine";
}

/** A recipe's crafting time, trimmed to the precision it actually needs —
 *  most recipes run whole seconds, but a few (e.g. Water Extractor) don't. */
export function formatCraftSeconds(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`;
}
