import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/**
 * Serve a file from the built web app (`staticDir`) for a non-API GET, so the
 * control-center server can double as the dashboard host on one origin — the
 * deployment path in ADR 0001, and the one where the browser's native SSE
 * reconnect works without a dev proxy in the way. Unknown paths fall back to
 * `index.html` so a client refresh always lands on the SPA.
 *
 * Returns true if it handled the request. When no web build exists yet (dev runs
 * Vite separately), it returns false and the caller 404s.
 */
export async function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  staticDir: string,
  pathname: string,
): Promise<boolean> {
  const filePath = await resolveFile(staticDir, pathname);
  if (!filePath) return false;

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream" });
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("end", resolve);
    stream.pipe(res);
  });
  return true;
}

/** Resolve a request path to a file inside staticDir, guarding against escape. */
async function resolveFile(staticDir: string, pathname: string): Promise<string | null> {
  const root = path.resolve(staticDir);
  const requested = path.resolve(root, "." + pathname);
  // Reject path-traversal attempts that resolve outside the static root.
  if (requested !== root && !requested.startsWith(root + path.sep)) return null;

  const direct = await fileOrNull(requested);
  if (direct) return direct;

  // SPA fallback: serve index.html for client-side routes.
  return fileOrNull(path.join(root, "index.html"));
}

async function fileOrNull(candidate: string): Promise<string | null> {
  try {
    const info = await stat(candidate);
    return info.isFile() ? candidate : null;
  } catch {
    return null;
  }
}
