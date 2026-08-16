# PRD-33 — Cold chain constraints + anticipatory supply

- **Type:** PRD
- **Tier:** 2 — Roadmap (PRD v3 Part IV)
- **Priority:** P2
- **Status:** Backlog
- **Source:** PRD v3 **§24** (the two supply capabilities other than funded local purchase, which is
  PRD-9). Also §27b.2b (anticipation), §30 (diabetes reordering, "anticiparnos al parto"). Sequence:
  §33 step 7. Open question: §34 (cold chain — what storage exists, which routes carry insulin).

## Problem / why

Two capabilities the medicine bank needs to work properly rather than lurch between stockouts:

1. **Cold chain constrains routing.** Insulin and injectables carry temperature and light constraints
   that make some open routes invalid — a six-hour open boat is not a path for insulin. Rutas has free
   notes but **no structured constraint**, and Catálogo has **no storage-requirement field** (§24).
2. **Anticipatory supply.** In `ordinario`, demand is largely predictable — a partera on losartán needs
   a refill monthly. **Propose the order before she asks** (§24). This is a **different resolver** from
   the reactive one, and it is what makes a medicine bank work.

## Scope

**In:**
- **Storage-requirement field on Catálogo** (e.g. `cadena_frio`, light-sensitive) — data, not code,
  editable in place per §15.
- **Structured route constraints on Rutas:** a route can be marked invalid for cold-chain items (or
  bounded by max open-transit time), so the matcher **excludes cold-chain-invalid routes** for items
  that require it. Free notes remain.
- **The matcher respects cold-chain constraints:** a cold-chain item is never routed over a route that
  cannot carry it; if none qualifies, it surfaces as a distinct stuck-state (not silently matched).
- **Anticipatory resolver:** for items with a **refill cadence** (set clinically or by the coordinator),
  propose the next order **before** the previous runs out — a proposal a person confirms (principle 7),
  distinct from the reactive matcher. Covers chronic treatment (losartán), diabetes supplies
  (consumption-based reordering, §30) and "anticiparnos al parto" (prenatal cadence, §30).

**Out:**
- **Funded local purchase** — PRD-9 (§24, the third supply mode).
- The clinical setting of a cadence (theirs) — Convite consumes a cadence, it does not prescribe one
  (§27b.1, §2). The telemedicine order interface that supplies cadence is FR-17 (§27b.2b).
- Real cold-storage hardware/telemetry at nodes (out — §34 is an open question about what exists).

## Acceptance criteria

1. A catalogue item can be flagged with a **storage requirement** (cold chain / light-sensitive),
   edited in place.
2. A route can carry a **structured cold-chain constraint**; the matcher **excludes** invalid routes
   for items that require cold chain, and surfaces "no viable cold-chain route" as its own stuck-state
   rather than proposing an invalid one.
3. An item with a refill **cadence** generates an **anticipatory order proposal** ahead of stockout;
   the proposal is confirmed by a person before it becomes a pedido.
4. The anticipatory resolver is **distinct** from the reactive matcher and does not fire for items with
   no cadence.

## Dependencies

- **Consumes** Rutas (§9, built) and Catálogo (§15, built) — adds fields/constraints.
- **Anticipation** is also invoked by FR-17 (§27b.2b) telemedicine fulfilment; keep one resolver.
- Cold-chain open questions tracked in §34 (storage at nodes, which routes carry insulin).

## Validation approach (future, on staging)

Flag an item as cold chain; mark a long open-boat route invalid for it; confirm the matcher refuses
that route and raises a distinct stuck-state; set a monthly cadence on a chronic item and confirm an
anticipatory proposal appears before stockout and requires human confirmation. Never validate on
production.
