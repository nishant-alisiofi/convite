# FR-43 — Seguimiento de caducidad de perecederos + alertas

- **Type:** FR
- **Tier:** 2 — Roadmap
- **Priority:** P2
- **Status:** In progress
- **Source:** Field feedback from Chocó (Doña Marta), relayed by Nishant 2026-08-17. "Need
  automated alerts or sorting for items with upcoming expiration dates to prioritize rapid
  distribution."

## Problem / why

Perishable relief goods (food, some medicines) spoil. In a basin where a shipment may sit days
waiting on a boat, the coordinator needs to see what is about to expire and push it out first.
Today inventory has no expiry concept, so nothing surfaces "distribute this now."

Respect **BUG-23** (false precision on perishables): expiry is an honest **date** the coordinator
enters, not a fabricated precise metric. If unknown, it is unknown — no invented number.

## Scope

**In:**
- An optional **`fecha_caducidad`** (expiry date) on inventory lots for items flagged perishable
  in the catalogue (`catalogo`/`cadena-frio`).
- Existencias/Inventario **sorts/flags** perishable lots by soonest expiry; a lot within a
  configurable window (e.g. ≤ N days) is visibly flagged; expired lots are clearly marked.
- Optional coordinator alert (in-panel signal, reusing the Bandeja/Silencio pattern) for lots
  crossing the window.

**Out:** automated disposal/write-off, temperature logging (that is cold-chain, PRD-33),
fabricated shelf-life estimates.

## Acceptance criteria

1. A perishable inventory lot can carry an expiry date; a non-perishable item does not force one.
2. Inventario surfaces perishable lots sorted by soonest expiry, with a clear flag for those
   within the window and for expired lots.
3. No invented precision: a lot with an unknown expiry shows "sin fecha", never a guessed date.

## Validation approach (staging)

On `staging.convite.ai`, add a perishable lot with an expiry a few days out and one already past;
confirm Inventario sorts/flags them correctly and an expired lot is marked.
