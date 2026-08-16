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

---

## PRD v3 update (2026-08-15) — §27b substantially scopes this: Convite is the fulfilment half

PRD v3 **§27b** answers most of the open questions above and reframes the ask: **Convite is NOT the
telehealth platform — it is the fulfilment half**, and that is a larger, clearer role than
"integration." The ASOREDIPARCHOCÓ chain is `PARTERA → REGISTRO → TELECONSULTA → SEGUIMIENTO MÉDICO →
BANCO DE MEDICAMENTOS → ENTREGA EN EL TERRITORIO` — **the last two steps are ours.** This WI stays an
FR (partner + legal specifics and §34's who-holds-org_admin / allocation-policy remain open), but it is
now scoped enough to build the supply half; §27b.4 says the medicine bank **works before the
telemedicine platform exists.**

**§27b.1 — the boundary: an order, never a record.** Their platform sends a **supply instruction**:
`{ beneficiario_ref, codigo_item, cantidad, cadencia, vigencia_hasta }`. Never a diagnosis, history, or
prescription document. `beneficiario_ref` is opaque or a **label** (the Apadrinar pattern, PRD-12).
Convite returns **delivery confirmation and nothing else** — it can prove **arrival**, never
**adherence** (blurring that turns a logistics system into a health record, which §2 forbids).

**§27b.2 — agendamiento (the flow they actually named as their primary need):** getting reports from
the field and being able to **contact people back**. A reporte enters by any channel (built) → verified
(built) → **routed to agenda instead of supply** → find a window where **she is reachable AND someone
can attend** → propose by her channel → confirm/retry → send the connection mode → asiste / no asiste /
reagenda. **A jornada is many people at a place; a cita is one person at a time** — same container
logic, same notification/attendance discipline, **same engine that schedules classes** (§21b.3 roster).
- **Finding the window is the hard part:** the intersection of the clinician's availability with **her
  reachability** — from `puntos_conexion` (PRD-10), her **learned activity window** (§20/PRD-15), and
  her **link quality**. A platform books 2pm Tuesday; Convite knows she is reachable Thursday mornings
  at the school where there is power and she can stay an hour.
- **Join method degrades with connectivity:** good data → Meet; weak data → WhatsApp voice; signal, no
  data → plain phone; nothing at home → **at a connection point** in a working window (scheduled around
  the tide, per the point's notes); not resolvable remotely → **referral + a trip (PRD-8/§25)**.
- **The proposal must survive her being offline (principle 4):** proposals **do not expire in hours**
  (hold + re-propose on next inbound); **confirmation is one word** («… Responda SI»); **discretion
  applies** (never «cita médica» or the condition on a shared screen — the time and nothing else);
  reminders respect the activity window + spend caps; **three missed windows escalate to a person**.
- **Templates:** `cita_propuesta · cita_confirmada · cita_recordatorio · cita_reagendada` (all utility).

**§27b.2b — fulfilment, anticipation, referral:** the prescription becomes a **`pedido` against
`existencias`**, matched/dispatched like any item with the 4-digit confirmation code; a chronic
treatment's refill cadence drives **anticipatory ordering** before stockout (PRD-33/§24); escalation
**moves the person** (PRD-8/§25).

**§27b.3 — what Convite does NOT do:** consultation, clinical records, diagnosis, the risk *semáforo*,
prescribing, adherence assessment. All theirs, all a regulatory regime we do not enter.

**§27 — services (schema now, feature later):** goods need transport, services need connectivity; both
are the scarce middle. Two resolvers, one board: `SIN_RUTA/SIN_EXISTENCIA/SIN_CAPACIDAD` (goods) ‖
`SIN_CONECTIVIDAD/SIN_PROVEEDOR/SIN_HORARIO` (services) — quantity depletes, availability renews. **Do
the small schema now to avoid a painful retrofit:** add **availability windows to `puntos_conexion`**
and a **capability type to the catalogue**.

**Provisional acceptance (supersedes the three above once promoted):**
1. Convite accepts a **supply instruction** (`beneficiario_ref, codigo_item, cantidad, cadencia,
   vigencia_hasta`), never a clinical record, and returns delivery confirmation only.
2. A verified report can be **routed to agenda** and scheduled as a **cita** against the intersection of
   provider availability and the partera's reachability (connection point + activity window + link
   quality), with the degrading join method.
3. Proposals survive being offline (no hours-expiry, re-propose, one-word confirm, discretion, 3-miss
   escalation); the four cita templates exist (utility).
4. A prescription becomes a **pedido** fulfilled from the medicine bank with a 4-digit code;
   anticipatory reorder fires on cadence (PRD-33); escalation triggers people-transport (PRD-8).
5. `puntos_conexion` gains **availability windows** and the catalogue gains a **capability type** now.
6. Works **without** a telemedicine platform: a coordinator can enter a chronic-treatment requirement
   manually today and Convite sources, routes, delivers, confirms.

Cross-ref **PRD-8** (§25 referral trips), **PRD-33** (§24 anticipation), **PRD-10** (puntos_conexion),
**PRD-15** (§20 activity window), **PRD-30/PRD-31** (shared citas/roster + jornada engine), **PRD-12**
(label/consent pattern).
