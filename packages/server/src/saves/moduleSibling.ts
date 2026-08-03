/**
 * Resolve a module sitting next to this one, keeping whichever extension the
 * caller is itself running as.
 *
 * Worker threads are started from a URL rather than an import, so TypeScript's
 * import rewriting cannot help: the URL has to name `.ts` when the server is run
 * straight from source (`npm run dev`, Vitest) and `.js` when it runs from `dist`.
 * Reading the extension off the calling module is what makes one line work in both.
 */
export function moduleSibling(callerUrl: string, name: string): URL {
  const extension = callerUrl.endsWith(".ts") ? ".ts" : ".js";
  return new URL(`./${name}${extension}`, callerUrl);
}
