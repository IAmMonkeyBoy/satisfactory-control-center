import { useEffect, useRef, useState } from "react";
import { storageSearchResponseSchema, type StorageSearchResponse } from "@scc/shared";

const DEBOUNCE_MS = 300;

export type StorageSearchStatus = "idle" | "searching" | "success" | "error";

export interface StorageSearch {
  query: string;
  setQuery: (query: string) => void;
  status: StorageSearchStatus;
  /** Only meaningful when `status` is `"success"`. */
  result: StorageSearchResponse | null;
}

/**
 * Item-location search against the REST endpoint (ADR 0003: request/response,
 * not pushed over SSE). Debounced so each keystroke doesn't fire its own
 * request.
 *
 * `sourceKey` identifies which followed session/baseline the search index
 * reflects — callers pass something like session name + the baseline's
 * `capturedAt`. A change to it invalidates whatever's on screen immediately,
 * the same as a query change: without this, a result from a session that has
 * since reset, or from a baseline a newer save has since replaced, would sit
 * on screen — accurate for a session/save that's no longer the one being
 * followed, but presented as if it still were.
 */
export function useStorageSearch(
  sourceKey: string,
  searchUrl = "/api/storage/search",
): StorageSearch {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StorageSearchStatus>("idle");
  const [result, setResult] = useState<StorageSearchResponse | null>(null);
  // Read inside the async response handler so it reflects the query at the
  // moment the response lands, not the query this particular request was
  // sent for — a second, independent guard against a stale response
  // rendering as current, alongside the effect's own `cancelled` cleanup.
  const latestQuery = useRef(query);
  latestQuery.current = query;

  useEffect(() => {
    // A new query, or the source the search index reflects moving on,
    // invalidates whatever's on screen immediately — it must not survive
    // through the debounce and request round trip.
    setResult(null);

    const trimmed = query.trim();
    if (trimmed === "") {
      setStatus("idle");
      return;
    }

    setStatus("searching");
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`${searchUrl}?item=${encodeURIComponent(trimmed)}`)
        .then((res) => {
          if (!res.ok) throw new Error(`search failed: ${res.status}`);
          return res.json() as Promise<unknown>;
        })
        .then((data) => {
          if (cancelled) return;
          const parsed = storageSearchResponseSchema.safeParse(data);
          if (!parsed.success || parsed.data.query !== latestQuery.current.trim()) {
            setStatus("error");
            return;
          }
          setResult(parsed.data);
          setStatus("success");
        })
        .catch(() => {
          if (!cancelled) setStatus("error");
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, sourceKey, searchUrl]);

  return { query, setQuery, status, result };
}
