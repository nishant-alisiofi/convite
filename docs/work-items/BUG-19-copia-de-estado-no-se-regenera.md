# BUG-19 — State-dependent copy not regenerated on transition (D1)

- **Type:** BUG
- **Tier:** 1 — Defect on the live demo (PRD v3 Part III)
- **Priority:** P0
- **Status:** ✅ Fixed — deployed (staging + prod), pending Codex validation · fixed in the D1–D9 batch
- **Source:** PRD v3 §Defects **D1**. Visible in the current demo.

## What's wrong (PRD v3 · D1)

On the **Tablero**, Paimadó sits under **En camino · Ya salieron** while its `motivo` string still
reads **«Confirme para despachar»**. The motivo is generated for the `LISTO` state and is **not
regenerated when the row transitions** to `EN_CAMINO`. The board then contradicts itself: the bucket
says the shipment left, the sentence says it is waiting for a confirmation.

## Why it matters

The `motivo` strings are the product (PRD v3 §5) — they turn a count into a phone call. A motivo that
lies about the state is worse than no motivo: a coordinator acts on the sentence, not the bucket. This
is visible on the demo Tablero right now, so it undercuts the exact thing the demo is meant to show.

## Fix / acceptance criteria

1. The `motivo` is **regenerated on every state transition**, not only when the row is first created
   in `LISTO`. A row in `EN_CAMINO` shows an "en camino" motivo (e.g. «Ya salió …»), never
   «Confirme para despachar».
2. **Audit every state-dependent string** across all five buckets (`Listos para despachar`,
   `Esperan transporte`, `Esperan donación`, `Incomunicadas`, `En camino`) — each bucket's motivo
   matches the row's current state. No stale copy survives a transition.
3. The load-bearing motivo patterns in PRD v3 §5 (node + staleness + gap in one sentence) are
   preserved; this fix regenerates them, it does not simplify them.

## Codex validation (run on staging.convite.ai)

> **Do not touch production.** Log in per `docs/validacion-codex-0a1.md`.

1. Log in as **coordinador** (`talos+convite-coordinador@downshiftit.com`), open **Tablero**.
2. Find a row under **En camino** (Paimadó if seeded there): its motivo describes it as already
   dispatched — it does **not** say «Confirme para despachar» or any other `LISTO`-state text.
3. Spot-check each of the five buckets: every visible motivo is consistent with the bucket the row
   is in.
4. If a row can be transitioned during the walk, confirm its motivo updates on transition (before ≠
   after), and capture both states as evidence.

**Pass = no row shows a motivo that belongs to a different state than the bucket it sits in.**
