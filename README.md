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
npm test                 # typed SSE contract + static-serving tests
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

Build 1 (foundation): a dummy `WorldState` flows server → dashboard over SSE with
browser-native reconnect. Real ingestors (save watcher, FRM client) and the
feature panels land in later slices.
