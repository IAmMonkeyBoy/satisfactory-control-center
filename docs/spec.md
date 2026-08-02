# Satisfactory Control Center — build-ready spec

A read-only companion dashboard for inspecting the live state of Aaron's Satisfactory game, designed as an **always-on second-monitor command center**: glanceable while playing, high density, push updates, unmissable alarm states. It never modifies game state.

This document assembles every decision made on the [wayfinder map](https://github.com/IAmMonkeyBoy/satisfactory-control-center/issues/1) into one build-ready artifact. Detail lives in the linked ADRs, research docs, and ticket resolutions; this spec is the index and the contract. Terminology follows [CONTEXT.md](../CONTEXT.md) — **WorldState**, **ingestor**, **live feed**, **baseline**, **followed session**, **held save**, **sparkline window** are used here in their glossary senses.

## Goals and non-goals

**Goals (v1):**

- Show the current state of the followed session: power, production, storage, milestones, and a live top-down factory map.
- Stay honest about freshness: every domain carries a source/age tag surfaced in the UI.
- Alarm states (fuse trips, battery drain) are unmissable at a glance from across the room.

**Non-goals:**

- Modifying game state in any way — save editing, cheats, gameplay automation ([map](https://github.com/IAmMonkeyBoy/satisfactory-control-center/issues/1), Out of scope).
- Authoring game mods (consuming FRM is in scope; writing mods is not).
- Persistent history. v1 is current-state-only plus a RAM-only sparkline window (~30–60 min, lost on restart).
- Multi-user, remote access, or auth — single user on a trusted LAN.
- The dedicated-server API as a v1 data source (Aaron plays single-player; [#2](https://github.com/IAmMonkeyBoy/satisfactory-control-center/issues/2)). Future extension only: if a dedicated server ever enters play, the official HTTPS API adds health checks and on-demand save download ([#6](https://github.com/IAmMonkeyBoy/satisfactory-control-center/issues/6)).

## Architecture

Decided in [#9](https://github.com/IAmMonkeyBoy/satisfactory-control-center/issues/9) and recorded as ADRs; the ADRs are normative.

| Decision | ADR |
|---|---|
| Local Node + TypeScript server, started manually; dashboard is a browser window fullscreen on monitor 2. No Electron/Tauri. Save parsing runs in a worker thread. | [0001](adr/0001-local-web-app-single-node-process.md) |
| Two ingestors (FRM client, save watcher) merge into one in-memory WorldState; FRM-first; per-domain source/age tags; no database. | [0002](adr/0002-frm-first-worldstate-merge.md) |
| SSE push stream + REST GETs. No WebSocket serving. | [0003](adr/0003-sse-plus-rest-transport.md) |
| React + Vite + TypeScript + Tailwind; uPlot sparklines; Tier 1 map in Three.js with an orthographic top-down camera from day one. | [0004](adr/0004-threejs-orthographic-map-from-day-one.md) |
| npm-workspaces monorepo: `packages/server`, `packages/web`, `packages/shared`; Vitest; plain npm scripts. | [0005](adr/0005-npm-workspaces-monorepo.md) |

`packages/shared` holds the WorldState and SSE payload types — the contract both sides compile against.

## Data layer

### Ingestor 1: FRM client (the live feed)

Per [#6](https://github.com/IAmMonkeyBoy/satisfactory-control-center/issues/6) ([full research](https://github.com/IAmMonkeyBoy/satisfactory-control-center/blob/research/live-state-alternatives/docs/research/live-state-alternatives.md)):

- Ficsit Remote Monitoring mod, HTTP/WebSocket on port 8080, LAN-only (no TLS; read endpoints are unauthenticated).
- Subscribe over WebSocket (push cycle ~5 s default); fall back to HTTP polling if the socket drops.
- Endpoints of record: `getPower`, `getFactory`, `getProdStats`, `getStorageInv`, `getTrains`, and peers (~50 available).
- Caveat: heavy endpoints like `getFactory` can hitch large saves — keep poll cadences conservative and prefer the push stream.

### Ingestor 2: save watcher (the baseline)

Per [#5](https://github.com/IAmMonkeyBoy/satisfactory-control-center/issues/5) ([full research](https://github.com/IAmMonkeyBoy/satisfactory-control-center/blob/research/save-access-mechanics/docs/research/save-access-mechanics.md)):

- Watch `%LOCALAPPDATA%\FactoryGame\Saved\SaveGames\<SteamID64>\*.sav`, debounced ~2 s. Never write there.
- On change: open with share-friendly flags, **copy to scratch, parse the copy**; retry with backoff on sharing violations.
- Validate before trusting: parse the header, then check zlib chunk magics (`0x9E2A83C1`) so partial writes fail fast.
- Parser: [`@etothepii/satisfactory-file-parser`](https://www.npmjs.com/package/@etothepii/satisfactory-file-parser) (MIT, tracks 1.0–1.2, mod-tolerant; [#3](https://github.com/IAmMonkeyBoy/satisfactory-control-center/issues/3)). GreyHak's Python `sat_sav_parse` serves as a development cross-check oracle only (GPL — never linked in).
- Trust header fields (`SessionName`, `SaveDateTime`), never filenames. Autosaves rotate 3 slots every 300 s by default, so baseline staleness is at most ~5 min while playing.

### Followed session and merge rules

Per [#11](https://github.com/IAmMonkeyBoy/satisfactory-control-center/issues/11):

1. **Auto-follow only; no session picker.** The dashboard follows the newest save by header `SaveDateTime`; autosaves and manual saves form one stream. Filenames are never consulted for ordering (mtime breaks exact ties only).
2. **FRM's session identity is authoritative while live.** A save merges into WorldState only if its header `SessionName` matches the session FRM is streaming; a mismatched save is parsed but **held**, never merged. With FRM down, newest save wins outright.
3. **Session change = silent full reset.** When the followed session changes (from either source), WorldState and the sparkline window are dropped and rebuilt. No cross-session history.
4. **Merge precedence:** FRM domains are authoritative while connected; each accepted save parse refreshes the full baseline and fills domains FRM doesn't expose (death-crate contents, full container inventories).

## Transport and API surface

Per [ADR 0003](adr/0003-sse-plus-rest-transport.md): one `EventSource` SSE stream pushes WorldState deltas (browser-native auto-reconnect); REST GETs serve request/response needs — storage search, codex lookups, map payload snapshots. Exact route shapes are an implementation concern; the payload types in `packages/shared` are the contract.

## v1 features

Per [#8](https://github.com/IAmMonkeyBoy/satisfactory-control-center/issues/8), in build-priority order:

1. **Power panel + alarms.** Per-circuit production/consumption/capacity, battery % with time-to-empty, fuse-tripped alarm. **Dashboard-only alerting**: unmissable visual alarm states (panel/border state change, alarm banner); no Discord/toast/push. Audible cue is a build-time toggle, not a spec commitment. The alarm framework built here serves all later features.
2. **Production efficiency.** Per-item current vs. max rates, machine efficiency rollups (FRM `getFactory` / `getProdStats`).
3. **Storage/inventory.** Item-location search across containers, plus dimensional-depot inventory, death-crate locations/contents, and AWESOME sink points/coupons. One pillar: "know where all your stuff is."
4. **Milestones summary.** Current HUB milestone with ingredient progress, Space Elevator phase, in-flight MAM research, compact collectibles/session stat row. Summary-level only.
5. **Tier 1 map** — **required, not cut-first.** See below.
6. **Codex popover.** Click any item/machine anywhere in the dashboard → static recipe/rates/description. Seed for the v2 codex.

Cross-cutting: sparklines on power and production, fed by the in-memory sparkline window. Nothing persists to disk.

### Tier 1 map

Per [#7](https://github.com/IAmMonkeyBoy/satisfactory-control-center/issues/7) ([full research](https://github.com/IAmMonkeyBoy/satisfactory-control-center/blob/research/3d-visualization-feasibility/docs/research/3d-visualization-feasibility.md)) and [#8](https://github.com/IAmMonkeyBoy/satisfactory-control-center/issues/8):

- Top-down icon/footprint map in world coordinates, rendered in Three.js with an orthographic camera ([ADR 0004](adr/0004-threejs-orthographic-map-from-day-one.md)).
- Layers, individually toggleable: factory buildings tinted by status (running / idle / no-power), live movers (player, vehicles, trains, drones), death crates, alarm badges at fault locations.
- **Tier-2-ready payload:** every map entity ships as `class + transform + footprint`, so the 2.5D extruded-blocks upgrade is a camera/geometry change, not a renderer or payload swap.
- Map background is stylized or user-supplied — never extracted game assets (see Licensing).

## UI concept: Map Deck

Per [#10](https://github.com/IAmMonkeyBoy/satisfactory-control-center/issues/10): the command center is **map-centric**. The Tier 1 map is the full-bleed backdrop; overlay panels surround it:

- **Power + alarms** panel
- **Milestone + storage** panel
- **Production ticker**

A read-only **following indicator** shows session name, source, and data age ("Random Defaults · FRM live" / "Random Defaults · save, 4 min old") so auto-switching is always explainable ([#11](https://github.com/IAmMonkeyBoy/satisfactory-control-center/issues/11)). No session controls in v1.

**Styling:** informed by Satisfactory's FICSIT industrial aesthetic — dark metal surfaces, FICSIT orange as the signature accent. *Informed by, not copied*: original palette and artwork only. Reference prototype (all three layout variants + switcher) is preserved on branch [`prototype/command-center-ui`](https://github.com/IAmMonkeyBoy/satisfactory-control-center/tree/prototype/command-center-ui).

## Static data

Parse `<install>\CommunityResources\Docs\en-US.json` (UTF-16 LE, ~10.6 MB) from Aaron's own game install at startup for `ClassName → mDisplayName`, recipes, and rates ([#5](https://github.com/IAmMonkeyBoy/satisfactory-control-center/issues/5)). This module feeds the codex popover in v1 and must be designed to serve the full v2 codex. Item/machine icons come from Aaron's own install, never bundled into the repo.

## Licensing constraints

- **Never redistribute game assets** — models, textures, the in-game map image, item icons. Extraction for personal use is fine; nothing extracted lands in the repo or any public build ([#7](https://github.com/IAmMonkeyBoy/satisfactory-control-center/issues/7)).
- **SCIM** (satisfactory-calculator.com) is study-only — its license forbids code/asset reuse.
- **Satisfactory Tools** (greeny/SatisfactoryTools) code is MIT and may design-inform the v2 codex/calculators; its bundled game images are Coffee Stain-restricted and may not be reused ([#8](https://github.com/IAmMonkeyBoy/satisfactory-control-center/issues/8)).
- `@etothepii/satisfactory-file-parser` is MIT. GreyHak's `sat_sav_parse` is GPL — cross-check oracle only, never a dependency.

## Reserved for v2

The spec reserves space for these; v1 must not design them out:

- **Full codex + calculators** — own implementation, design-informed by Satisfactory Tools. The v1 static-data module serves it; the UI reserves a navigation slot.
- **Collectible map layers** (unopened drop pods, slugs) on the Tier 1 map.
- **Historical save/session browsing** (superseded by auto-follow in v1).
- **Tier 2 map** (2.5D extrusion) — payload and camera already prepared.

Deferred, unscheduled: map Tiers 3+ (low-poly / real meshes — Tier 4 license-blocked), persistent history, external notifications.

## Handoff: implementation slices

Implementation starts as its own effort, seeded from this spec. Decided slicing (see [#12](https://github.com/IAmMonkeyBoy/satisfactory-control-center/issues/12) for rationale): **one foundation slice, two ingestor slices, then one vertical slice per v1 feature** in the build order from [#8](https://github.com/IAmMonkeyBoy/satisfactory-control-center/issues/8). Nine build tickets:

1. **Scaffold + shared contract.** Monorepo per ADR 0005; WorldState + SSE payload types in `packages/shared`; server serves a dummy WorldState over SSE; web renders it. Proves the transport end-to-end before any real data.
2. **Save watcher ingestor.** Watch/debounce/copy/parse/validate pipeline in a worker thread; followed-session and held-save logic; static-data loader from `en-US.json`. Exit: WorldState reflects the newest save with the game closed.
3. **FRM client ingestor + merge.** WS subscribe + poll fallback; FRM-first merge with source/age tags; session-change reset; following indicator data. Exit: WorldState goes live within ~5 s of in-game changes and degrades cleanly to baseline when FRM drops.
4. **Dashboard shell + power panel + alarm framework.** Map Deck layout (map slot empty), following indicator, power panel, sparkline window + uPlot, the reusable alarm-state framework. FICSIT-informed styling lands here and is refined throughout.
5. **Production efficiency panel.**
6. **Storage/inventory panel** — search, depot, death crates, sink.
7. **Milestones summary panel.**
8. **Tier 1 map** — Three.js orthographic scene, four layers with toggles, Tier-2-ready payload, alarm badges; replaces the empty map slot.
9. **Codex popover** — static-data popovers wired across all panels and the map.

Each build ticket carries: the goal, its spec sections and ADRs by link, an exit criterion (as sketched above), and the glossary terms it touches. Slices 1–4 are strictly ordered; 5–7 are independent of each other after 4; 8 needs 5–7's data only insofar as it badges their alarms (buildable after 4, best after 5); 9 is last. Alarm framework (slice 4) is deliberately early — every later panel consumes it.
