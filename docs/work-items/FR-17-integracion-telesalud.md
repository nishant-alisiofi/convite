# FR-17 — Telehealth-module integration

- **Type:** FR (open request — needs scoping before it becomes a PRD)
- **Tier:** 2 — Roadmap (from PRD v1.0)
- **Priority:** P3
- **Status:** Backlog
- **Source:** PRD v1.0 (telehealth-module integration). Partner context: ASOREDIPARCHOCÓ parteras
  (midwives) — health is core to their work.

## Problem / why

The first partner's users are **parteras** (midwives). Beyond supplies and transport, there is a
health dimension: a partera may need to reach a clinician, escalate a case, or receive guidance.
The vision names a **telehealth-module integration** — connecting a report/request to a
telehealth capability. This is an FR (not yet a PRD) because the shape, provider, clinical
responsibility, and regulatory posture are all open and must be scoped with the partner before
committing.

## Open questions to resolve before promoting to a PRD

1. **What is the integration?** Referral/hand-off to an existing telehealth service, or an
   in-Convite consult surface? (Strong prior: hand-off, not building clinical software.)
2. **Who holds clinical responsibility?** Convite coordinates logistics; it must not become an
   unlicensed medical provider.
3. **Data / regulatory:** health data + Ley 1581 + Colombian health regulation — needs legal +
   the retention policy (D9). What can be stored, shared, for how long?
4. **Trigger:** which report categories (e.g. `parto`, urgencia médica) route to telehealth, and
   does it tie into people-transport (PRD-8)?
5. **Provider:** is there a partner telehealth service in Chocó / Pacífico to integrate with?

## Provisional scope (subject to scoping)

**In (likely):** a report can be flagged as needing clinical attention and **handed off** to a
telehealth pathway; the hand-off is logged; person/health PII is RLS-scoped and retention-bound.
**Out (v1):** building clinical software; storing clinical records; any automated medical advice.

## Acceptance criteria (provisional)

1. A report can be routed to a telehealth pathway based on category, with a logged hand-off.
2. Health/PII is RLS-scoped and covered by the retention policy; never exposed publicly.
3. Clinical responsibility sits with a licensed provider, not Convite (documented in the flow).

## Next step

Scoping session with ASOREDIPARCHOCÓ + legal to answer the open questions, then promote to a PRD.
Do not build until scoped.
