# FRM-first merge into a single in-memory WorldState

Two read-only sources feed the dashboard: Ficsit Remote Monitoring's push feed (~5 s, only while the game runs) and parsed save files (autosaves rotate every 300 s). Both merge into one canonical in-memory `WorldState`: while FRM is connected its domains are authoritative; each save parse refreshes the full baseline and fills domains FRM doesn't expose (death crates, complete container contents). Every domain carries a source/age tag so the UI shows staleness honestly when FRM disconnects.

We rejected save-first (FRM as mere animation overlay) because the dashboard's core job is catching a blown fuse now, not at the next autosave. There is no database: state is current-only plus an in-memory sparkline window (~30–60 min), per the v1 feature-set decision (issue #8).
