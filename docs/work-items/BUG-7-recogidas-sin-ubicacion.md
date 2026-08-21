# BUG-7 — Recogidas: centers have no location ("Ningún centro tiene ubicación")

- **Type:** BUG
- **Tier:** 1 — Demo (this pass)
- **Priority:** P1
- **Status:** ✅ Fixed — deployed (staging + prod), pending Codex validation
- **Source:** Jam A.
- **Fixed by:** PRD-1 (seed gives centers coordinates) + PRD-2 (center-location capture from the
  panel).

## Reproduction (from Jam A)

On the **Recogidas** (pickups) page, the surface showed **"Ningún centro tiene ubicación"** — no
center had a location, so pickup clustering had nothing to work with and the page was effectively
empty.

## Why it matters

Recogidas is the first-mile pickup surface: it clusters donor offers around centers to produce
ordered pickup runs (M8). Without any center having a location, clustering cannot run and the
pickup workflow cannot be demonstrated at all. It also blocks the "6 offers in 3 neighbourhoods →
1 ordered run" M8 acceptance from being shown live.

## Root cause (hypothesis)

Two causes: (a) seeded centers had no coordinates (data — PRD-1), and (b) there was no way to set
a center's location from the panel (feature — PRD-2 center-location capture / pin-drop). Both are
needed: the seed makes the demo populated now; the capture path makes it work for real centers
later.

## Scope

**In:** at least one center has a location so Recogidas can cluster and render pickup groups; a
panel path exists to set a center's location. **Out:** the map build (PRD-2) and the seed build
(PRD-1) themselves — this BUG tracks the observed defect and its resolution.

## Acceptance criteria

1. Recogidas no longer shows a blanket **"Ningún centro tiene ubicación"** — at least one center
   has a location.
2. Recogidas renders at least one **pickup group / ordered run** from clustered offers.
3. Setting a center's location from the panel (pin-drop / "use my location", PRD-2) makes that
   center appear located in Recogidas and on the Mapa.

## Codex validation (run on staging.convite.ai)

> **Do not touch production.** Log in per `docs/validacion-codex-0a1.md`.

1. Log in as **coordinador** (`talos+convite-coordinador@downshiftit.com`) and open
   **Recogidas**.
2. Expected: **not** "Ningún centro tiene ubicación" — at least one center has a location and at
   least one **pickup group / run** is shown.
3. Open **Mapa** and confirm the located center(s) render as pins (cross-check PRD-2).
4. **Round-trip capture:** using PRD-2's pin-drop / "use my location", set a location on a center
   that lacks one; return to **Recogidas** and confirm that center is now located and included in
   clustering.
5. **Before/after evidence:** capture the "Ningún centro tiene ubicación" state (if reproducible
   pre-fix) and the populated Recogidas state after the fix.

**Pass = Recogidas shows located centers and at least one pickup run, and a location set from the
panel propagates to Recogidas and the Mapa.**
