# FR-44 — Inventario de farmacias locales

- **Type:** FR
- **Tier:** 2 — Roadmap
- **Priority:** P3
- **Status:** ✅ Built + deployed (staging + prod) — pending Codex validation
- **Source:** Field feedback from Chocó (Doña Marta), relayed by Nishant 2026-08-17. "Integrate or
  track local pharmacy inventory directly to leverage existing community medical supplies."

## Problem / why

Medicine already sitting in a community's pharmacy is faster and cheaper than shipping it in.
Convite should be able to see local pharmacy stock so a need can be met locally — this is the
supply-side twin of **PRD-9 (compra local financiada)**: buy/allocate from a local pharmacy
instead of trucking supplies down the river.

## Scope

**In:**
- Represent a **local pharmacy** as a supply source/location tied to a community (a kind of
  proveedor/punto de existencias).
- Track its medical inventory (item + quantity), visible in Existencias and usable by Compra
  local (PRD-9) as a local fulfilment option for medical needs.
- Respect RLS + the existing supply model; a pharmacy is org-scoped.

**Out:** live POS/ERP integration with real pharmacies, payments/settlement (Compra local owns
the funding flow), non-medical retail.

## Acceptance criteria

1. A local pharmacy can be recorded as a supply source attached to a community, with medical
   items + stock.
2. Its stock appears in Existencias and is offered as a local-fulfilment option for a matching
   medical need (ties into Compra local / matching).
3. All of it is org-scoped under RLS.

## Validation approach (staging)

On `staging.convite.ai`, register a local pharmacy with a couple of medicines in stock; confirm
it shows in Existencias and is surfaced when a matching medical need exists.
