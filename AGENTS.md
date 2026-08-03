# satisfactory-control-center

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues on `IAmMonkeyBoy/satisfactory-control-center`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each using its default label string. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root and ADRs under `docs/adr/`. See `docs/agents/domain.md`.

## Implementation workflow

When picking up a work item (a build ticket / GitHub issue), follow this branch-and-PR flow:

1. **Start clean on `main`.** Before creating a branch, make sure the checkout is on `main` with no uncommitted changes (`git switch main`, `git status` clean, pull latest). Never start work on top of a dirty tree or another item's branch.
2. **Create a branch for the work item.** One branch per work item, named for it (e.g. `build/01-scaffold-shared-contract`). Do the implementation there and commit.
3. **On completion, open a PR and mark it ready for review.** Once the item is agreed complete, push the branch and open a pull request that is *ready for review* (not a draft).
4. **Link the work item to the PR.** The PR body must reference the originating issue with a closing keyword (`Closes #13`) so the item and the PR are linked and the issue auto-closes on merge.

## Technical workflow

### Toolchain

- **Node** — the version in `.nvmrc` (Node 24 LTS; `engines` requires `>=24.0.0 <25`). Use `nvm use` (or install Node 24) before working.
- **npm** — pinned via `packageManager` (npm 10.9.x). This is an npm-workspaces monorepo; there is no Turborepo/Nx.
- **Packages** — `packages/shared` (WorldState + SSE contract, the source of truth both sides compile against), `packages/server` (Node + TypeScript API and dashboard host), `packages/web` (React + Vite + Tailwind dashboard).

### Setup

```bash
nvm use            # Node 24 per .nvmrc
npm ci             # clean, lockfile-exact install (use `npm install` when changing deps)
```

### Verify (the definition of done)

`npm run check` is the single gate — it must pass before a work item is considered complete and is exactly what CI runs (`.github/workflows/ci.yml`). It runs, in order:

1. `build:shared` — build the shared package so the others resolve its types.
2. `format:check` — Prettier (`npm run format` to fix).
3. `lint` — ESLint with type-aware `typescript-eslint` (`npm run lint`).
4. `typecheck` — `tsc --noEmit` across all workspaces, including test files.
5. `test` — Vitest (`vitest run`).
6. `build` — the production build of all three packages.

A work item is **done** when: acceptance criteria are met, `npm run check` is green, the branch is pushed, and a ready-for-review PR links the issue.

### Targeted commands

Run a script in one workspace with `--workspace`:

```bash
npm run test --workspace @scc/server      # or: npx vitest run packages/server
npm run typecheck --workspace @scc/web
npm run build --workspace @scc/shared
npm run dev                               # server (:4317) + Vite dashboard (:5173) together
```

Serve everything from one origin (server hosts the built dashboard on :4317):

```bash
npm run build --workspace @scc/web
npm run start --workspace @scc/server
```

### Conventions and generated output

- Each package has `tsconfig.json` (production build; excludes `*.test.ts`) and, for `shared`/`server`, `tsconfig.typecheck.json` (includes tests, `--noEmit`). Keep test-only helpers out of the production build (see `packages/server/src/testSupport.ts` and its `tsconfig.json` exclude).
- **Generated, never committed** (gitignored): `packages/*/dist`, `node_modules`, `*.tsbuildinfo`. `tsc -b` does not delete orphaned outputs — after changing a tsconfig `include`/`exclude`, delete `dist` and rebuild.
- Prettier owns code formatting; prose docs (`**/*.md`, `docs/`, `archive/`) are hand-authored and excluded (see `.prettierignore`).
