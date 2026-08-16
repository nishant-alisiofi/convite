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
