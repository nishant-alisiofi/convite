# PRD-12 — Sponsorship: "apadrina una partera"

- **Type:** PRD
- **Tier:** 2 — Roadmap (from PRD v1.0)
- **Priority:** P2
- **Status:** Backlog
- **Source:** PRD v1.0 (sponsorship — "apadrina una partera"; three-sided marketplace, funding
  side). First partner: ASOREDIPARCHOCÓ (1,600 parteras; pilot = 50).

## Problem / why

The funding side of the three-sided marketplace: a sponsor (individual or org) commits recurring
or one-off support to a specific partera (or a pool), funding her supplies/transport/local
purchases. This is a public-facing acquisition surface *and* a funding pool feeding PRD-9 (funded
local purchase). It must respect the same privacy posture — a sponsor sees an appropriate,
consented representation of the partera, never raw PII/location.

## Scope

**In:**
- A **sponsorship** offering: a sponsor commits funds to a named partera or a pool; recurring or
  one-off.
- A **partera profile** appropriate for a public/sponsor audience — consented, aggregated,
  **never** exact location, phone, or health detail (Ley 1581; mirror the public-view k-anonymity
  discipline).
- Funds flow into a **funding pool** that PRD-9 draws on; sponsor sees impact at an aggregate,
  privacy-safe level.
- Consent capture from the partera before any profile is shown to sponsors.

**Out (v1):** payment rails / disbursement (needs entity + processor — see PRD.md D2/plan);
tax-receipting; sponsor accounts with logins (start with lightweight identification, mirror the
donor model in `docs/tipos-de-usuario-y-accesos.md`).

## Acceptance criteria

1. A sponsor can commit support to a partera or pool (one-off or recurring) with lightweight
   identification.
2. Any partera profile shown to a sponsor is **consented** and privacy-safe — no exact location,
   phone, or health detail; k-anonymity discipline holds.
3. Committed funds register in a funding pool consumable by PRD-9.
4. A sponsor sees impact only at an aggregate, privacy-safe level.

## Validation approach (future, on staging)

As an unauthenticated visitor, walk the sponsorship surface; confirm no PII/coordinates are ever
exposed (adversarial probe as with the M12 public view); commit a test sponsorship; confirm it
lands in the funding pool and that impact is shown only in aggregate. Never validate on
production.

---

## PRD v3 update (2026-08-15) — §13 (built, canonical) + two gaps (§21b.4, §21)

**§13 records Apadrinar as BUILT and canonical** — this is the current behaviour, not a spec to
re-derive: the padrino sees **a label, never the name/phone/location**; a named partera appears **only
after consent**; **three totals** (comprometido · aplicado · disponible para compras); registration
takes a beneficiary **label** («Partera del Atrato medio»), optional community, sponsor, type,
recurrence, purpose, amount, and a **consent checkbox mandatory when a named community is selected**;
**empty community = fondo común** (the correct default). Preserve all of this exactly.

**Two gaps remain (v3), both dependencies, not core Apadrinar:**
- **§21b.4 — sponsor a *programa*, not only a beneficiary.** Apadrinamientos must also fund a
  **programa** — how «apadrina una partera y su casa» scales into «financia el banco de medicamentos
  por seis meses». Same consent rules (label + programa, never a name); programa-level totals mirror
  the three already built. Built in **PRD-31** (programas); this WI's funding model feeds it.
- **§21 — nothing to price yet.** A sponsor cannot fund a house until someone has **costed** it: level
  2 (bill of materials, **PRD-29**) is the missing link. Apadrinar is otherwise built; §21 level 2
  unblocks «apadrina una partera y su casa».

Status: core sponsorship built; **programa-funding (PRD-31)** and **house-pricing via §21 (PRD-29)**
are the outstanding pieces. Cross-ref PRD-9 (funding pool), PRD-29, PRD-31.
