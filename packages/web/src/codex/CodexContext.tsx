import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { JSX, ReactNode } from "react";
import type { CodexKind } from "@scc/shared";

/** What's currently open in the popover — a specific class of a known kind,
 *  or nothing. */
export interface CodexTarget {
  kind: CodexKind;
  className: string;
}

interface CodexContextValue {
  target: CodexTarget | null;
  open: (kind: CodexKind, className: string) => void;
  close: () => void;
}

const CodexContext = createContext<CodexContextValue | null>(null);

/**
 * Owns which codex entry (if any) is open for one Map Deck instance. Any
 * clickable item/machine anywhere in the dashboard — power panel, production
 * ticker, storage search results, milestones, or the Tier 1 map (spec, "v1
 * features: Codex popover") — calls {@link useCodexContext}'s `open` rather
 * than rendering its own popover, so exactly one can be on screen at a time.
 */
export function CodexProvider({ children }: { children: ReactNode }): JSX.Element {
  const [target, setTarget] = useState<CodexTarget | null>(null);

  const open = useCallback((kind: CodexKind, className: string) => {
    setTarget({ kind, className });
  }, []);
  const close = useCallback(() => setTarget(null), []);

  const value = useMemo<CodexContextValue>(() => ({ target, open, close }), [target, open, close]);

  return <CodexContext.Provider value={value}>{children}</CodexContext.Provider>;
}

export function useCodexContext(): CodexContextValue {
  const ctx = useContext(CodexContext);
  if (!ctx) throw new Error("useCodexContext must be used within a CodexProvider");
  return ctx;
}
