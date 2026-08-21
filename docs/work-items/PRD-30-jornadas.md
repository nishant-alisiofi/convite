# PRD-30 — Jornadas (the scheduling container over the same matching)

- **Type:** PRD
- **Tier:** 2 — Roadmap (PRD v3 Part IV)
- **Priority:** P2
- **Status:** ✅ Built + deployed (staging + prod) — pending Codex validation
- **Source:** PRD v3 **§22**. Vocabulary: §18 (jornada = one occurrence, at a place, on a date).
  Sequence: §33 step 6 (jornadas, then programas §21b).

## Problem / why

A health brigade, a distribution, a youth encounter, an assessment sweep: **people and things arrive
at a place, on a date, for a community that must be told in advance** (PRD v3 §22). None of that fits
in a shipment. And it matters beyond features: **jornadas keep the network alive between disasters** —
a disaster-only platform goes dormant, reporters stop answering, and when the next earthquake comes
nobody remembers the number.

## Scope

**In:**
- A **jornada** entity = one occurrence, at a place, on a date, with a type and a payload:
  | Type | Payload |
  |---|---|
  | `distribucion` | Goods |
  | `brigada` | People with skills |
  | `taller` / `formacion` | Facilitator and materials |
  | `evaluacion` | Surveyor and a template |
  | `obra` | Materials, labour, technical assistance |
- **A container over the existing matching engine — the engine does not change.** A jornada's unmet
  requirements are the only thing that flows to the Bandeja stuck-state board.
- **Communities are told in advance** — a jornada has a place/date and the affected communities.
- **Tasks, not only matches:** some gaps are phone calls (finding a dentist for a brigada); the
  Bandeja holds both (PRD v3 §22, and PRD-28).
- Historical jornadas render (the territory seed plants Herencia's past jornadas so «al abrir el mapa
  vean su propio trabajo» — see PRD-38 / PRD-37).
- **Schema note:** the `jornadas` + `jornada_paradas` tables are delivered by **PRD-37** (territory &
  registry schema), because the seed needs them before this full feature ships; this WI builds the
  feature logic/UI on top of them.

**Out:**
- The **programa** layer above jornadas (objective, budget, cadence, seasonal-feasibility calendar) —
  PRD-31 (§21b).
- **Persistent rosters** for `taller`/`formacion` (participants tracked across sessions) — that is
  §21b.3, built in PRD-31.
- **Citas** (one person, one slot) — FR-17 (§27b.2); same container logic, different WI.
- Delivering curriculum/content (out of scope per §2 — organising the class is ours, the curriculum is
  not).

## Acceptance criteria

1. A jornada can be created with type, place, date, affected communities, and a type-appropriate
   payload; its five types are supported.
2. A jornada's **unmet requirements flow to the Bandeja stuck-states**; met requirements do **not**
   dilute the board (PRD v3 §22 constraint).
3. The Bandeja can hold a jornada **task** (e.g. "conseguir odontólogo") distinct from a match.
4. **Attendance records that someone attended, never what for** (§22 / §21b.3 constraint).
5. Seeded historical jornadas (Herencia) are readable and render on the map/agenda.
6. Jornadas appear under **Agenda** in the §18 navigation (PRD-28).

## Dependencies

- **Schema:** `jornadas` / `jornada_paradas` from **PRD-37**.
- **Nav home:** Agenda section from **PRD-28**.
- **Parent layer:** **PRD-31** (programas) contains jornadas; **PRD-32** (map planning) produces draft
  jornadas via `Armar una jornada` (§23.5).
- Region scoping via **PRD-37** (regiones).

## Validation approach (future, on staging)

Create one jornada of each type; confirm unmet requirements appear in the Bandeja while met ones do
not; add a task item and confirm it is actionable; confirm a seeded Herencia historical jornada is
visible. Never validate on production.
