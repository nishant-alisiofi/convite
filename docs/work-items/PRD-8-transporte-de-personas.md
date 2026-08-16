# PRD-8 — Transport of people (not just goods)

- **Type:** PRD
- **Tier:** 2 — Roadmap (from PRD v1.0)
- **Priority:** P2
- **Status:** Backlog
- **Source:** PRD v1.0 (three-sided marketplace; transport of PEOPLE, not only supplies).

## Problem / why

v1 moves supplies from centers/donors to communities. The vision adds a distinct need: moving
**people** — a partera to a birth, a patient to a health post, a community member to a connection
point. This is a different match (a person + origin + destination + time window, with capacity =
seats, not weight/volume) and a different consent/privacy posture (a named person's travel).

## Scope

**In:**
- A **people-transport request** type: origin, destination, when, who (headcount / named person),
  reason category (e.g. médico, parto), and any accessibility need.
- Matching against transport capacity expressed in **seats** and a time window, reusing the
  transporter vetting + `convite_conduce_hacia` window (see `docs/tipos-de-usuario-y-accesos.md`).
- Human-decided dispatch (a person allocates, as with goods), manifest, 4-digit confirmation on
  arrival.
- Privacy: a person's identity/health reason is PII — RLS-scoped like household data; retention
  policy applies (D9).

**Out (v1):** automated allocation; medical triage/telehealth logic (see FR-17); ambulance/formal
EMS integration.

## Acceptance criteria

1. A people-transport request can be created via the same channels/normalizer, carrying origin,
   destination, time window, headcount, and reason category.
2. The matcher proposes transport by **seat capacity + window**, distinct from goods matching.
3. Dispatch requires a human allocation decision (logged, immutable), produces a manifest, and
   arrival is confirmed by a 4-digit code.
4. Person/health data is RLS-scoped and covered by the retention policy; the public view never
   exposes it.

## Validation approach (future, on staging)

Seed a people-transport request; as coordinador, confirm it appears distinctly from goods, is
matched by seats+window, dispatched with a human decision, and confirmed by code. As a role
without scope, confirm the person's PII is not visible. Never validate on production.

---

## PRD v3 update (2026-08-15) — §25 confirms and expands this

PRD v3 **§25** ("Transport of people") reaffirms this WI and adds detail: parteras travel out for
**surgery and specialist care**, needing **river, road, sometimes air, plus lodging, food,
accompaniment and a return leg** — the record carries a person, not a quantity, but the same matching
logic applies. Add these to scope: **lodging · food · accompaniment · return leg** as part of the
people-transport unit.

It is also **clinically triggered**: §27b.2b ("moving the person when remote is not enough") routes
here when a teleconsultation escalates — triggered clinically (by the partner/telemedicine side),
fulfilled by Convite. Cross-ref **FR-17** (§27b) for the referral trigger. "Human accompaniment is
part of the system, not a shortfall of it" (principle 10).
