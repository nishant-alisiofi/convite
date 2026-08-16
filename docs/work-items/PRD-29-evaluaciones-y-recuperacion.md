# PRD-29 — Assessments and recovery (levels 2–4, coverage, bill of materials)

- **Type:** PRD
- **Tier:** 2 — Roadmap (PRD v3 Part IV)
- **Priority:** P1 — "the largest functional gap, and the thing Herencia de Timbiquí is asking for"
- **Status:** Backlog
- **Source:** PRD v3 **§21**. Partner: Fundación Herencia de Timbiquí (§31, their ask is the
  diagnostic — levels 3 & 4). Sequence: §33 step 4 (unblocks both Apadrinar and Herencia).

## Problem / why

Level 1 — the report — is built. **Levels 2–4 are not.** A verified damage report is information; it is
not yet part of the marketplace, and there is nothing to price a house against, so **Apadrinar has
nothing to fund** (PRD v3 §21, §13). Assessment is also **the only mechanism that finds need in
communities with no channel** — the census, not the inbox.

## Scope

**In:**
- **Level 2 — damage → bill of materials.** A verified `93` (vivienda afectada) at a severity proposes
  **materiales + transporte + mano de obra (días) + asistencia técnica**, template-driven and adjusted
  by whoever does the asistencia técnica. This is what turns damage reporting into a matchable unit.
- **Level 3 — the assessment sweep.** A surveyor records **every item in scope**, not only those that
  reported (census-shaped). Provenance = a visitor with a date; findings **expire**.
- **Level 4 — the territorial picture.** Aggregate by vereda and municipality — the artifact a funder
  reads and sponsorship prices against.
- **Coverage is the metric, not damage count:** *assessed out of estimated total*, **with its date**.
  "Forty of a hundred houses surveyed" ≠ "forty damaged houses."
- **Repair is a four-component match** — materiales + transporte + **mano de obra local** (a supply
  side, not a cost line) + asistencia técnica. Stuck-states extend accordingly.
- **Multi-domain, template-driven assessments:** housing, education infrastructure, health posts,
  water, environment, organisational capacity.
- **`via_de_respuesta` on every finding:** `convite` (matchable) · `derivacion` (another mandate) ·
  `sin_via` (recorded, never queued). Extend the existing **Derivaciones** block (§6.2) to the third
  value (§17.4).
- The offline **`evaluador`** role (§29.3): light login, offline assessment form with a sync queue and
  a coverage counter (offline capture rides PRD-13's field-device work).

**Out:**
- Clinical assessment / historia clínica (forbidden by §2).
- The map's **assessment-recency layer** and area selection — those are PRD-32 (§23.4–23.5); this WI
  produces the data that layer renders.
- Programa-level aggregation/reporting rhythm — PRD-31 (§21b).

## Acceptance criteria

1. A verified damage finding can be turned into a **bill of materials** (materiales, transporte, mano
   de obra en días, asistencia técnica) from a template, editable by the técnico.
2. A surveyor can run an **assessment sweep** recording every in-scope item; each finding carries a
   visitor + date provenance and an expiry.
3. **Coverage** is computed and shown as *assessed / estimated total* with its date, at vereda and
   municipality level (level 4).
4. Repair requirements produce a **four-component match**, with **mano de obra local** modelled as a
   supply side; unmet components flow to the Bandeja stuck-states.
5. Assessments are **multi-domain** via templates (≥ housing + one other domain demonstrated).
6. Every finding carries `via_de_respuesta` ∈ {`convite`, `derivacion`, `sin_via`}; `derivacion`
   findings appear in the extended Derivaciones block and never enter despacho.
7. A costed repair is consumable by Apadrinar/programa funding (PRD-12, PRD-31).

## Dependencies

- **Unblocks** PRD-12 (Apadrinar — «apadrina una partera y su casa» needs level 2 to price) and
  Herencia's diagnostic ask (§31).
- **Feeds** PRD-32 (map assessment-recency layer + selection-panel coverage) and PRD-31 (programa
  coverage indicators).
- **Territory schema** (regiones, PRD-37) scopes assessments by region/community.
- Offline capture for `evaluador` coordinates with **PRD-13** (offline bundles/sync).

## Validation approach (future, on staging)

Seed/enter a verified `93`; generate a bill of materials from a template and edit it; run a small
assessment sweep and confirm coverage renders as assessed/total with a date; confirm a `derivacion`
finding lands in Derivaciones and never in despacho; confirm a costed repair is fundable via Apadrinar.
Never validate on production.
