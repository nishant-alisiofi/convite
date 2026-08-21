# BUG-22 — Locale defects: US date format and raw enum in dropdown (D4)

- **Type:** BUG
- **Tier:** 1 — Defect on the live demo (PRD v3 Part III)
- **Priority:** P2
- **Status:** ✅ Fixed — deployed (staging + prod), pending Codex validation · fixed in the D1–D9 batch
- **Source:** PRD v3 §Defects **D4**.

## What's wrong (PRD v3 · D4)

Two locale defects in a Colombian product:

1. The **Envíos** date field renders `mm/dd/yyyy` (US order) instead of the Colombian `dd/mm/yyyy`.
2. The **Temporada** dropdown shows the raw enum value **`todo_el_ano`** instead of a human label.

## Why it matters

These are the small tells that make a coordinator distrust the rest of the screen. A US date order is
genuinely ambiguous (03/04 = March 4 or April 3?), and a raw enum value reads as unfinished software.

## Fix / acceptance criteria

1. All dates in **Envíos** (and any other date input/display) render in **`dd/mm/yyyy`** with an
   es-CO locale.
2. The **Temporada** dropdown shows human labels — **«Todo el año» · «Lluvias» · «Seca»** — never the
   raw enum (`todo_el_ano`, `lluvias`, `seca`). Audit any other place a season enum surfaces (Rutas,
   Ajustes, Mapa header).
3. No raw enum value is user-visible anywhere on the audited screens.

## Codex validation (run on staging.convite.ai)

> **Do not touch production.** Log in per `docs/validacion-codex-0a1.md`.

1. Log in as **coordinador** (`talos+convite-coordinador@downshiftit.com`).
2. Open **Envíos**: the `sale` / date field(s) read `dd/mm/yyyy`.
3. Open **Rutas** (and **Ajustes**): the **Temporada** control shows «Todo el año / Lluvias / Seca»,
   not `todo_el_ano`.
4. Scan the Mapa header season indicator for a raw enum.

**Pass = Colombian date order everywhere and human season labels everywhere; no raw enum visible.**
