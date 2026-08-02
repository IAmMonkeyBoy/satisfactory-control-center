# Satisfactory Control Center

A read-only companion dashboard for inspecting the live state of Aaron's Satisfactory game on a second monitor. It never modifies game state.

## Language

**WorldState**:
The single canonical in-memory snapshot of the game, merged from all ingestors and pushed to the dashboard.
_Avoid_: game state, world model

**Ingestor**:
A source-specific component that feeds WorldState. v1 has two: the FRM client and the save watcher.
_Avoid_: collector, importer, scraper

**Live feed**:
The FRM push stream (~5 s cadence); authoritative for the domains it covers while the game is running.
_Avoid_: live data, realtime stream

**Baseline**:
The full WorldState refresh parsed from the latest save file; the only source when the game is closed, and the filler for domains the live feed doesn't expose.
_Avoid_: snapshot, fallback

**Source/age tag**:
Per-domain provenance (live feed or baseline) plus staleness, carried on WorldState so the UI can display freshness honestly.
_Avoid_: freshness flag

**Sparkline window**:
The in-memory ring buffer (~30–60 minutes) of recent time series behind the dashboard sparklines. Nothing persists to disk.
_Avoid_: history, metrics database

**Tier 1 map**:
The required v1 factory map: top-down icons in world coordinates with status tints, live movers, and alarm badges.

**Tier 2 map**:
The optional 2.5D extruded-blocks upgrade, rendered from the same payload and scene graph as the Tier 1 map.

**FRM**:
Ficsit Remote Monitoring, the community mod whose JSON/WebSocket endpoints provide the live feed.

**Followed session**:
The single game session WorldState describes. The live feed's session is authoritative while the game runs; otherwise it is the session of the newest save by header `SaveDateTime`. When it changes, WorldState and the sparkline window are dropped and rebuilt — no cross-session history.
_Avoid_: active session, selected save

**Held save**:
A parsed save whose header `SessionName` doesn't match the followed session; it is retained but never merged into WorldState, so a session switch mid-play can't produce chimera data.
_Avoid_: stale save, orphan save
