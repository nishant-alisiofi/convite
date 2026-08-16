# PRD-39 · Unify demo activity onto the real community registry

- **Type:** PRD · **Priority:** P1 · **Tier:** 1 (finishes PRD-38)
- **Source:** PRD-38 reconciliation gap + Codex-visible duplication
- **Status:** Fix in progress (engineering)
- **Depends on / follows:** PRD-38 (territory registry wired), PRD-37 (schema)

## Problem
PRD-38 loaded the real registry (63 communities, long codes like `CH-QUI-TAG`) but did
NOT re-point the demo activity's community rows (short codes `QBD`/`TAG`/`BLL`), because
~20 `.db.test.ts` files hardcode the short codes and pin demo array lengths. Result on
**staging**: registry (63) + demo (19) coexist = **82 communities with ~14 real-place
duplicates** (two Quibdós, two Bellavistas…). Production is unaffected (registry only,
no `db:seed`). The org and catalogue dimensions were already unified in PRD-38.

## Acceptance
- Staging has **one** community set — the real registry (no duplicate real places).
- All demo activity (reportes, pedidos, ofertas, mensajes, verification queue, dispatch,
  voice notes) references the registry communities (mapped from demo short-codes to their
  real registry equivalents by place/municipio).
- The verifier demo scoping (was `TAG,MER,BET`) resolves to the registry equivalents so
  the verificador demo still shows only its communities.
- Every panel page still renders populated; `pnpm test` green (the ~20 tests updated to
  registry codes/counts); prod stays registry-only and clean.

## Codex validation (staging.convite.ai)
1. Comunidades — confirm no duplicate real places (one Quibdó, one Bellavista, etc.).
2. Mapa — no overlapping duplicate markers/circles.
3. Tablero/Verificación/Recogidas still populated, referencing real communities.
