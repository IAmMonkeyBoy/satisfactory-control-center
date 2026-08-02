import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./httpServer.js";

const PORT = Number(process.env.PORT ?? 4317);

// Serve the built dashboard from the server so it and the API share one origin
// (ADR 0001). In dev the dashboard is run separately via Vite; if no build
// exists here yet, non-API GETs simply 404.
const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(here, "../../web/dist");

const server = createServer({ staticDir });
server.listen(PORT, () => {
  console.log(`Control center server listening on http://localhost:${PORT}`);
  console.log(`  Dashboard:     http://localhost:${PORT}/`);
  console.log(`  SSE stream:    http://localhost:${PORT}/api/stream`);
  console.log(`  REST snapshot: http://localhost:${PORT}/api/worldstate`);
});
