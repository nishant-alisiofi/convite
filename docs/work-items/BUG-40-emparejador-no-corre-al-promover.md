# BUG-40 · Matcher not run when a report is promoted to a pedido

- **Type:** BUG · **Priority:** P1 · **Tier:** 1 (live demo)
- **Source:** Codex validation pass 1 (2026-08-16), `.forge/artifacts/validate/2026-08-15.md`
- **Status:** ✅ Fixed — deployed (staging + prod), pending Codex validation (`emparejarPedido` runs on promotion)
- **Related:** M7 (verification → pedido), the matcher (`lib/matching/*`)

## Problem
Promoting a report from Verificación to a `pedido` increments the Tablero total, but
the new pedido never appears in a missing-side group (SIN_RUTA / SIN_EXISTENCIA /
SIN_CAPACIDAD / LISTO / EN_CAMINO). The matcher is not run on the newly-created
pedido, so it lands with no resolved state and shows nowhere on the board.

## Acceptance
- After promotion, the new pedido is resolved by the matcher and appears in the
  correct Tablero group with a human-readable `motivo`.
- No matcher logic is duplicated — the existing resolver/persistence path is reused.
- "The matcher proposes; a person commits" is preserved (promotion gives the pedido a
  *state*, it does not auto-dispatch).

## Codex validation (staging.convite.ai)
1. Sign in as coordinador; in Verificación, promote a RECIBIDO report to a pedido.
2. Open the Tablero; confirm the new pedido appears in a missing-side group with a
   motivo — not merely an incremented total.
