# PRD-13 — Offline PMTiles map bundles

- **Type:** PRD
- **Tier:** 2 — Roadmap (from PRD v1.0)
- **Priority:** P2
- **Status:** Backlog
- **Source:** PRD v1.0 (offline PMTiles bundles); PRD.md §3 (MapLibre + Protomaps extract "which
  also works offline").

## Problem / why

Field devices in Chocó / Pacífico operate with no/low signal. The panel map (PRD-2) needs to work
**offline** on a field device: a pre-built **PMTiles** bundle of the operating area, served
locally, so a coordinator or transporter can see geography without a live tile connection. This
is the offline half of the same MapLibre + Protomaps choice already made in PRD.md §3.

## Scope

**In:**
- A **PMTiles extract** of the operating basin (Chocó / Pacífico), buildable and versioned.
- The panel/field map loads from the local PMTiles bundle when offline, falling back to online
  tiles when available.
- A path to **update/download** a bundle when connectivity allows (bundle versioning + size
  budget suitable for field devices).
- Per-territory bundles (the architecture is territory-agnostic; each territory gets its own
  extract — cf. Buenaventura note in `docs/estado-nocturno.md`).

**Out (v1):** offline *data* sync (reports/pedidos offline) — that is a separate offline-first
effort (PRD.md non-goals reference Kobo/ODK for offline capture).

## Acceptance criteria

1. A PMTiles bundle for the operating area can be built and versioned.
2. With the network disabled, the map still renders the basemap from the local bundle.
3. When online, the app can fetch/update to a newer bundle version.
4. Bundle size is within a documented field-device budget.

## Validation approach (future, on staging / field build)

Build a bundle, load the map with the network disabled, and confirm the basemap renders; re-enable
network and confirm an update path works. Verify a second-territory bundle (e.g. Buenaventura)
renders independently. Never validate on production.
