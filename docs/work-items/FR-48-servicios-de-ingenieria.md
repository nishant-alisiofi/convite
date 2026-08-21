# FR-48 — Servicios de ingeniería y evaluación técnica

- **Type:** FR
- **Tier:** 2 — Roadmap
- **Priority:** P3
- **Status:** ✅ Built + deployed (staging + prod) — pending Codex validation (extends PRD-29, does not duplicate it)
- **Source:** Field feedback from Chocó (Doña Marta), relayed by Nishant 2026-08-17. "Clear
  requirement for technical evaluations, engineering services, and on-ground engineering talent to
  assess infrastructure and oversee distribution."

## Problem / why

Some needs are not goods — they are **assessments**: is this bridge safe, does this water system
work, is this building habitable. The field needs to request a **technical/engineering
evaluation** of a community's infrastructure, assign it to someone with the skill, and track it to
a finding. Sebastián (Doña Marta's son, aspiring systems engineer) is a concrete example of the
on-ground technical talent this would coordinate.

> **Check first:** PRD-29 (evaluaciones y recuperación) may already model assessments. If so,
> **extend it** with an engineering/technical evaluation type + a technical-assignee, rather than
> creating a parallel system.

## Scope

**In:**
- A **technical/engineering evaluation** record for a community's infrastructure (type, e.g. agua
  / puente / vivienda / eléctrico), assignable to a technical contact, with status
  (solicitada → en curso → completada) and a findings/detalle field.
- Surface it in the relevant panel section (Mapa/Evaluaciones or Comunidades), org-scoped.

**Out:** CAD/engineering tooling, cost estimation engines, contractor marketplace.

## Acceptance criteria

1. A technical evaluation can be created for a community with a type and an assignee.
2. It tracks status to completion and records a findings note.
3. Reuses PRD-29's evaluaciones model where it fits; org-scoped under RLS.

## Validation approach (staging)

On `staging.convite.ai`, create a technical evaluation for a community, assign it, advance it to
completed with a finding; confirm it is scoped and visible in the right section.
