# BUG-23 — False precision on perishable expiry timestamps (D5)

- **Type:** BUG
- **Tier:** 1 — Defect on the live demo (PRD v3 Part III)
- **Priority:** P2
- **Status:** Open
- **Source:** PRD v3 §Defects **D5**.

## What's wrong (PRD v3 · D5)

In **Recogidas**, a perishable stop shows **«vence sáb, 04:23 p. m.»** — a computed timestamp leaking
into a human-facing field. Nobody promised 4:23; the precision is an artefact of the calculation, not
a real deadline.

## Why it matters

Convite's honesty principles say we render precision honestly and never imply certainty we don't have
(cf. the map's precision legend, PRD v3 §7, and «Inventory is never a promise», principle 6). A
minute-precise expiry on a hand-entered perishable is exactly the false precision those principles
reject. It also invites someone to treat 4:23 as a hard cutoff and skip the stop at 4:30.

## Fix / acceptance criteria

1. Perishable expiry renders as a **coarse human phrasing**: día + franja del día — «sábado en la
   tarde» (mañana / tarde / noche), not a computed `HH:MM`.
2. The underlying timestamp may still drive **ordering** (perishables first, PRD v3 §10) — only the
   **display** is rounded.
3. Audit any other place a computed timestamp leaks into a human field (Inventario `contado hace N
   días` is already coarse and correct — this is about clock-time leaks specifically).

## Codex validation (run on staging.convite.ai)

> **Do not touch production.** Log in per `docs/validacion-codex-0a1.md`.

1. Log in as **coordinador** (`talos+convite-coordinador@downshiftit.com`), open **Recogidas**.
2. Find a perishable stop: its expiry badge reads like «sábado en la tarde», **not** «sáb, 04:23 p. m.».
3. Confirm perishables still sort ahead of non-perishables in the run order (the rounding didn't break
   ordering).

**Pass = no minute-precise expiry clock-time is shown to a human; perishables still order first.**
