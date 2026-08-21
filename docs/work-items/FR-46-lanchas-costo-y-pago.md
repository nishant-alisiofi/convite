# FR-46 — Operación pagada de lanchas: costo y pago a lancheros

- **Type:** FR
- **Tier:** 2 — Roadmap
- **Priority:** P2
- **Status:** ✅ Built + deployed (staging + prod) — pending Codex validation
- **Source:** Field feedback from Chocó (Doña Marta), relayed by Nishant 2026-08-17. "Logistics
  must factor in river transportation costs and pay structure for local boat operators (lancheros)
  moving goods."

## Problem / why

In the Pacífico, the river is the road and the lancha is the truck. Moving goods costs money and
the lanchero must be paid. Today transport (PRD-8 traslados / ofertas-transporte) does not carry a
**cost** or an **operator-payment** record, so a leg by boat is untracked financially. This is the
logistics-cost twin of PRD-9's funded-local model.

## Scope

**In:**
- Add **boat/lancha** as a transport mode on a logistics leg (goods or people) and record a
  **cost** for the leg plus the **lanchero to be paid** (contact + amount + status pendiente/
  pagado).
- Surface leg cost + operator payment in the transport/logistics view (traslados / envíos).
- Reuse existing transport + contact models; a lanchero is a contact with a role.

**Out:** automated disbursement / real payment rails (record-keeping only, like PRD-9 tracks
funding without moving money itself), route optimisation.

## Acceptance criteria

1. A logistics leg can be marked as by boat with a recorded cost and the lanchero to be paid.
2. The operator payment carries a status (pendiente/pagado) and is visible in the logistics view.
3. Org-scoped under RLS; no PII widening.

## Validation approach (staging)

On `staging.convite.ai`, create a boat leg with a cost and a lanchero payment; confirm both appear
in the logistics view and the payment status can be advanced.
