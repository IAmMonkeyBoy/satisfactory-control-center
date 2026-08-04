import { useEffect, useState } from "react";
import { storageSearchResponseSchema, type StorageSearchResponse } from "@scc/shared";

const DEBOUNCE_MS = 300;

export interface StorageSearch {
  query: string;
  setQuery: (query: string) => void;
  /** The most recent successful result, or null before a query has been typed
   *  (or while it's still debouncing/in flight — the previous result stays on
   *  screen rather than flashing empty on every keystroke). */
  result: StorageSearchResponse | null;
}

/**
 * Item-location search against the REST endpoint (ADR 0003: request/response,
 * not pushed over SSE). Debounced so each keystroke doesn't fire its own
 * request, and a query that changes (or empties) again before the debounce
 * fires cancels the stale request's result from ever landing.
 */
export function useStorageSearch(searchUrl = "/api/storage/search"): StorageSearch {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<StorageSearchResponse | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === "") {
      setResult(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`${searchUrl}?item=${encodeURIComponent(trimmed)}`)
        .then((res) => res.json())
        .then((data: unknown) => {
          if (cancelled) return;
          const parsed = storageSearchResponseSchema.safeParse(data);
          if (parsed.success) setResult(parsed.data);
        })
        .catch(() => {
          // A failed request leaves the previous result on screen — the
          // search box is a nicety, not a load-bearing status indicator.
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, searchUrl]);

  return { query, setQuery, result };
}
