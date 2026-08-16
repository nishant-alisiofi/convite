# PRD-2 — Real OpenStreetMap panel map + geolocation + pin-drop + center-location capture

- **Type:** PRD (feature)
- **Tier:** 1 — Demo (this pass)
- **Priority:** P0
- **Status:** In progress (engineering, in flight)
- **Source:** Jam A ("the map must show a real map with pins + 'use my location' lat-long", not
  the schematic one), Jam B ("a real map showing the area + centers + exact request points"),
  engineering-in-flight item #2.
- **Resolves:** BUG-6 (map blank / schematic, no basemap). Supports BUG-7 (center-location
  capture) and PRD-4 (Mapa page criterion).

## Problem / why

In Jam A the Mapa page was blank — no data, and a schematic no-basemap map (dashed connectors on
empty space). The coordinator cannot orient without a real map behind the markers. The founder
asked for a real map with pins and a "use my location" control that captures lat/long. Jam B
adds: the map must show the area + centers + the exact request points. PRD.md §3 and M8 already
chose the approach (MapLibre + a Protomaps/OSM extract of Chocó; precision-aware markers;
schematic route legs) — this WI makes that real and adds location capture.

## Scope

**In:**
- A **real basemap** (OpenStreetMap-derived tiles — MapLibre + Protomaps extract per PRD.md §3
  and §5.7 of the vision) rendering the Chocó / Pacífico area behind the markers.
- **Precision-aware markers** (M8): `gps` → a pin; `centroide` → a dashed ~1000 m circle;
  `referida` → a visually distinct ~2000 m circle. Circles must draw from day one (every seeded
  community is `centroide`).
- **Center pins** for centers that have a location; **exact request points** for GPS-precision
  reports.
- **Schematic route legs** — dashed connectors labelled with time + mode; never a line pretending
  to trace the real river/road path.
- **"Use my location"** control → captures the browser's lat/long and centers/drops a pin.
- **Pin-drop** to set a location manually (used to give a center or report a location).
- **Center-location capture**: from the panel, an operator can set a center's location (feeds
  BUG-7 / Recogidas).

**Out:**
- Google Maps (PRD.md §3: 22 of 36 edges are river, unmapped by Google).
- Offline PMTiles bundles for field devices — that is Tier 2 (PRD-13).
- Automatic road routing beyond the M8 pickup-clustering already built.

## Acceptance criteria

1. The Mapa page renders a **real basemap** (streets/rivers/place labels visible), not a blank
   schematic.
2. Communities render as **precision-aware markers**: pins for `gps`, ~1000 m dashed circles for
   `centroide`, distinct ~2000 m circles for `referida`.
3. Centers with a location render as **pins**; at least one **exact request point** renders.
4. Route legs render as **dashed schematic connectors labelled with time + mode**.
5. A **"use my location"** control requests browser geolocation and drops/centers a pin at the
   returned lat/long.
6. An operator can **drop a pin** to set a location, and can **capture a center's location**,
   which then appears on the map and in Recogidas (BUG-7).
7. No external-map call is required to create/edit a `lancha` (river) route (M8 acceptance holds).

## Codex validation (run on staging.convite.ai)

> **Do not touch production.** Log in per `docs/validacion-codex-0a1.md`.

1. Log in as **coordinador** (`talos+convite-coordinador@downshiftit.com`) and open **Mapa**.
   Expected: a **real map** (basemap tiles with streets/rivers/labels), not a blank schematic.
2. Confirm **community markers**: at least one dashed ~1000 m circle (`centroide`); if any
   community is `gps`, a pin; if any is `referida`, a distinct ~2000 m circle.
3. Confirm at least one **center pin** and at least one **exact request point** on the map.
4. Confirm **route legs** appear as dashed connectors, each **labelled with time + mode** (e.g.
   "lancha · 3 h").
5. Click **"use my location"** (accept the browser geolocation prompt). Expected: the map centers
   on / drops a pin at your lat/long, and the captured coordinate is shown.
6. Use **pin-drop / center-location capture** to set a location on a center that lacks one.
   Expected: it saves, the pin appears on the map, and that center now shows a location in
   **Recogidas** (cross-check BUG-7).
7. **Negative:** confirm the previous schematic-only, no-basemap map is gone (no blank canvas).

**Pass = a real basemap with correct precision-aware markers, working geolocation + pin-drop, and
center-location capture that propagates to Recogidas.**
