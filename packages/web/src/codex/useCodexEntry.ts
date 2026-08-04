import { useEffect, useState } from "react";
import { codexEntrySchema, type CodexEntry } from "@scc/shared";
import type { CodexTarget } from "./CodexContext";

export type CodexEntryStatus = "idle" | "loading" | "success" | "notFound" | "error";

export interface CodexEntryState {
  status: CodexEntryStatus;
  /** Only meaningful when `status` is `"success"`. */
  entry: CodexEntry | null;
}

/**
 * Fetch the codex popover's REST payload for whatever is currently open
 * (ADR 0003: request/response, not SSE — a lookup is only ever wanted the
 * moment something is clicked). `null` is a valid target: nothing is open,
 * so nothing is fetched. Distinguishes "the dump has nothing for this class"
 * (`notFound`, a 404 — creatures, resource nodes, and collectibles are
 * genuinely absent) from a transport failure (`error`), so the popover can
 * say the honest thing either way.
 */
export function useCodexEntry(
  target: CodexTarget | null,
  codexUrl = "/api/codex",
): CodexEntryState {
  const [state, setState] = useState<CodexEntryState>({ status: "idle", entry: null });

  useEffect(() => {
    if (!target) {
      setState({ status: "idle", entry: null });
      return;
    }

    setState({ status: "loading", entry: null });
    let cancelled = false;

    fetch(`${codexUrl}/${target.kind}/${encodeURIComponent(target.className)}`)
      .then((res) => {
        if (res.status === 404) {
          if (!cancelled) setState({ status: "notFound", entry: null });
          return null;
        }
        if (!res.ok) throw new Error(`codex lookup failed: ${res.status}`);
        return res.json() as Promise<unknown>;
      })
      .then((data) => {
        if (cancelled || data === null) return;
        const parsed = codexEntrySchema.safeParse(data);
        if (!parsed.success) {
          setState({ status: "error", entry: null });
          return;
        }
        setState({ status: "success", entry: parsed.data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", entry: null });
      });

    return () => {
      cancelled = true;
    };
  }, [target, codexUrl]);

  return state;
}
