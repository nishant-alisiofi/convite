# PRD-32 — Map as planning surface (draft-over-facts, area selection, assessment-recency layer)

- **Type:** PRD
- **Tier:** 2 — Roadmap (PRD v3 Part IV)
- **Priority:** P1 — "the most demo-able thing for a diagnostic partner" (§33 step 3b)
- **Status:** ✅ Built + deployed (staging + prod) — pending Codex validation
- **Source:** PRD v3 **§23**. Sequence: §33 steps 3b & 5. Builds on PRD-2 (the rendered map).

## Problem / why

The map renders the present; it does not yet **plan**. Planning an intervention is inherently spatial
and is the thing Herencia de Timbiquí is asking for (PRD v3 §23, §31). The smallest useful step — the
**assessment-recency layer + area selection** — is also the most demo-able piece for a diagnostic
partner (§33 step 3b).

## Scope

**In:**
- **No mode toggle (§23.1).** Do not build a "current state / planning" switch — modes are a real cost
  in an emergency. Planning is **a draft laid over the facts**, reusing the existing visual rule:
  **solid = fact** (open routes, counted stock, confirmed shipments, communities as registered);
  **dashed = draft** (proposed stops, the route being composed, coverage that would result).
- **Two entry points, one draft object (§23.2):**
  - *Supply-first* (already built): `Planear este viaje` on an offered transport in Envíos.
  - *Demand-first* (the gap): select an area on the map, see aggregate need, then ask who could serve
    it. Both produce a **draft jornada**; drafts are **saveable and there may be several**; nothing is
    committed until a person confirms (principle 7).
- **The draft carries a date, and the date picks the route (§23.3).** Resolve the **seasonal Rutas
  row from the draft's date, not today** — a draft dated in October costs what October costs. A route
  closed by a verified damage report stays closed in the draft and is flagged; never guess reopening.
- **Toggleable layers (§23.4):** pending requests · stock by node · route status · **assessment
  recency** · connection points · connectivity tier · communities in silence · last contact.
  **Assessment recency is the layer nobody else has** — communities shade by time since last surveyed,
  never-assessed rendered distinctly; that grey is the diagnostic team's next destination and the
  honest answer to "how do you know you're reaching everyone."
- **The selection panel (§23.5):** draw a polygon, or select by municipality / cuenca / agrupador. The
  panel returns communities + estimated families; pending requests by category and stuck-state;
  **assessment coverage and its age** (assessed / estimated total, never a bare count); which routes
  serve the area, open under which season; which communities have never been heard from; connection
  points inside it with safety/power ratings. From there: **`Armar una jornada`** — pick stops, order
  them, route graph returns travel time + cost for the draft's date, required vs offered capacity with
  the shortfall named. Output = a draft jornada with stops, requirements, and a manifest.
- **Plotting in two places (§23.6):** operational plotting is spatial and lives on the map; **reporting
  plotting** (coverage over time, delivered by category, spend vs commitment, response-time
  distribution) lives in **Informes** — mostly tables and simple bars, nothing sophisticated.

**Out:**
- On-device / offline routing (none — §26; a lanchero upriver is not choosing routes). Offline map
  tiles are PRD-13.
- The jornada entity + programa layer that consume drafts — PRD-30 / PRD-31.
- Assessment data itself — PRD-29 (this WI renders its recency/coverage).

## Acceptance criteria

1. Planning is a **dashed draft over the solid facts** — no mode toggle; solid vs dashed distinguishes
   fact vs draft without instruction.
2. Both **supply-first** and **demand-first** entry points produce the **same draft-jornada object**;
   multiple drafts can be held and saved; nothing commits without a person.
3. A draft **dated in a given season** resolves route time **and cost** from the matching seasonal
   Rutas row (not today's); a damage-closed route stays closed + flagged in the draft.
4. The **assessment-recency layer** shades communities by time since last survey, with never-assessed
   distinct; it toggles independently of the other §23.4 layers.
5. The **selection panel** (polygon / municipality / cuenca / agrupador) returns all §23.5 fields,
   including **coverage as assessed / estimated total with its age**, never a bare count.
6. `Armar una jornada` returns travel time + cost for the draft's date and names the capacity
   shortfall; output is a draft jornada with stops, requirements, and a manifest.
7. Reporting plots live in **Informes**, not on the operational map.

## Dependencies

- Builds on **PRD-2** (map) and Rutas seasonal data (§9, built). Renders **PRD-29** assessment
  data. Produces drafts consumed by **PRD-30** (jornadas) and the **PRD-31** planning flow (§21b.5).
- Region/agrupador selection relies on **PRD-37** (regiones + agrupador).

## Validation approach (future, on staging)

Select an area by polygon and by cuenca; confirm the panel returns need, coverage (assessed/total +
age), routes-by-season, silence, and connection points; build a draft jornada dated in a dry-season
month and confirm the cost matches the seca route row; toggle the assessment-recency layer and confirm
never-assessed renders distinctly. Never validate on production.
