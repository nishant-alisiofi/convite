# BUG-39 · Map data overlays do not render over the OSM basemap

- **Type:** BUG · **Priority:** P1 · **Tier:** 1 (live demo)
- **Source:** Codex validation pass 1 (2026-08-16), `.forge/artifacts/validate/2026-08-15.md`
- **Status:** ✅ Fixed — deployed (staging + prod), pending Codex validation (white casings)
- **Related:** PRD-2 (real OpenStreetMap map), BUG-6 (blank map)

## Problem
On the authenticated panel `/mapa`, the OSM basemap loads, but Convite's own data
layers — community markers, accuracy circles (gps pin / centroide ~1 km / referida
~2 km) and the dashed route/tramo connectors — do **not** render. So the map shows
real geography but none of the operational data. Missed in PRD-2 verification because
that used a render harness with mock data, not the live authenticated map with the
real seeded dataset.

## Acceptance
- On `/mapa`, with the real seeded registry, the accuracy circles, community markers,
  and dashed route connectors render **on top of** the OSM basemap.
- Precision honesty preserved (a `referida` point is a fuzzy circle, never a false pin).
- The basemap is not removed.

## Codex validation (staging.convite.ai)
1. Sign in as `talos+convite-coordinador@downshiftit.com`, open `/mapa`.
2. Confirm the OSM basemap AND the community circles + route connectors are both visible.
3. Zoom; confirm circles scale with the ground (uncertainty, not a fixed pixel).
