# BUG-6 — Mapa renders blank / schematic with no basemap

- **Type:** BUG
- **Tier:** 1 — Demo (this pass)
- **Priority:** P0
- **Status:** ✅ Fixed — deployed (staging + prod), pending Codex validation
- **Source:** Jam A.
- **Fixed by:** PRD-2 (real OpenStreetMap panel map).

## Reproduction (from Jam A)

On the panel's **Mapa** page, the map was blank — no data on it, and it was a **schematic
no-basemap** map (dashed connectors floating on empty space, no streets/rivers/place labels
behind them). Nishant explicitly asked for "a real map with pins + 'use my location' lat-long"
instead of the schematic one.

## Why it matters

A coordinator plans river/road logistics against geography. A schematic with no basemap gives no
sense of place — you cannot see which community is upriver, where a center sits, or how far a
request point is. It is also the single most "this looks unfinished" surface in a demo.

## Root cause (hypothesis)

Two compounding causes: (a) no basemap tile layer wired (M8 shipped with a GeoJSON fallback and a
documented "no tiles" slot — see `docs/estado-nocturno.md` M8 row), and (b) no data on the map
because the org had no seeded communities/centers/requests (BUG-5). PRD-2 wires a real
OpenStreetMap-derived basemap (MapLibre + Protomaps extract) and precision-aware markers; PRD-1
provides the data to render.

## Scope

**In:** the Mapa page shows a real basemap with markers. **Out:** the full feature build lives in
PRD-2 (basemap, precision markers, geolocation, pin-drop, center capture); this BUG tracks the
observed defect and its resolution.

## Acceptance criteria

1. The Mapa page renders a **real basemap** (streets/rivers/place labels visible), not a blank
   canvas.
2. Markers/data render on the map (communities, centers, request points) — the map is not empty.
3. The previous schematic-only, no-basemap rendering is gone.

## Codex validation (run on staging.convite.ai)

> **Do not touch production.** Log in per `docs/validacion-codex-0a1.md`.

1. Log in as **coordinador** (`talos+convite-coordinador@downshiftit.com`) and open **Mapa**.
2. Expected: a **real map** with visible basemap tiles (streets/rivers/labels for the Chocó /
   Pacífico area). The canvas is **not blank**.
3. Confirm markers render on top of the basemap (community circles/pins, center pins, request
   points) — cross-check the full marker spec in PRD-2.
4. Confirm the old schematic-on-empty-space rendering no longer appears.
5. **Before/after evidence:** capture the blank/schematic state (if reproducible pre-fix) and the
   real-map state after PRD-2.

**Pass = the Mapa page shows a real basemap with data on it, not a blank schematic.**
