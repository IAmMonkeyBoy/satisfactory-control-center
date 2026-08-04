# satisfactory-control-center

A read-only companion dashboard for inspecting the live state of a Satisfactory
game on a second monitor. See [docs/spec.md](docs/spec.md) for the full spec.

## Layout

npm-workspaces monorepo ([ADR 0005](docs/adr/0005-npm-workspaces-monorepo.md)):

- `packages/shared` — the `WorldState` and SSE payload types both sides compile against.
- `packages/server` — Node + TypeScript server: pushes `WorldState` over SSE, serves REST snapshots, and hosts the built dashboard.
- `packages/web` — React + Vite + TypeScript + Tailwind dashboard.

## Develop

```bash
npm install
npm run build            # builds shared, server, and web
npm test                 # Vitest: ingestors, WorldState merge, panels, map, SSE contract
npm run typecheck        # all workspaces
```

Run the two dev servers (server on :4317, Vite dashboard on :5173 proxying `/api`):

```bash
npm run dev
```

Or serve everything from one origin — build the web app, then start the server,
which hosts the dashboard and the API together on <http://localhost:4317>:

```bash
npm run build --workspace @scc/web
npm run start --workspace @scc/server
```

## Status

v1 complete — all nine build slices from [docs/spec.md](docs/spec.md) are merged:
save watcher and FRM client ingestors feed a live `WorldState` over SSE, and the
dashboard has the full panel set (power/alarms, production efficiency,
storage/inventory, milestones, Tier 1 map, codex popovers).
