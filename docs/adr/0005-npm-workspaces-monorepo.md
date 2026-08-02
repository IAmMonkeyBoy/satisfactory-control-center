# npm workspaces monorepo: server, web, shared

The repo is an npm-workspaces monorepo — `packages/server`, `packages/web`, and `packages/shared` — with Vitest for tests and plain npm scripts (no Turborepo/Nx at this scale). `shared` exists because the `WorldState` payload and SSE event types are the contract three things depend on (server, dashboard, and the Tier 2 map upgrade); a first-class package keeps that seam honest. A single-package layout was rejected because it tangles the Vite and Node build configs and blurs the server/client boundary.
