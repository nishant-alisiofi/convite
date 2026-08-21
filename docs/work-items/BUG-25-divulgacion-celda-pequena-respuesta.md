# BUG-25 — Small-cell disclosure on `/respuesta` (D7)

- **Type:** BUG
- **Tier:** 1 — Defect on the live demo (PRD v3 Part III)
- **Priority:** P0 — privacy correctness, and visible on the public page now
- **Status:** ✅ Fixed — deployed (staging + prod), pending Codex validation · fixed in the D1–D9 batch
- **Source:** PRD v3 §Defects **D7**. Principle: PRD v3 §4.8 «Show less in public, on purpose» / §17.

## What's wrong (PRD v3 · D7)

The public aggregate page **`/respuesta`** shows cells like **«Bajo Baudó · Salud · 1 en espera»**. In
a sparsely populated municipality, "one person waiting for Salud in Bajo Baudó" **approaches
identifying a household**. Two zones is also thin enough that zone + category narrows considerably.

## Why it matters

This is the public surface, in a territory with armed-actor presence. A single-count cell tied to a
zone and a category is small-cell disclosure — the same risk a census suppresses. It is the one defect
here that is a **safety** issue, not a UX one, and it is live on the public page.

## Fix / acceptance criteria

1. **Suppress any cell below a k threshold (3–5)** on `/respuesta` and roll the suppressed cells into
   an **«otras»** row, so no zone×category count below k is ever shown.
2. Guard the **combination** too: if reducing to two zones (or zone + category) narrows a group below
   k, aggregate/suppress it as well — not just single raw cells.
3. The withholding is **explained** in place (consistent with §17's "explain what is withheld and
   why") — the page says counts below a threshold are grouped to protect people, it does not silently
   drop them.
4. The threshold is a single documented constant so it can be tuned per territory.

## Codex validation (run on staging.convite.ai — public, no login)

> **Do not touch production.** Use `https://staging.convite.ai/respuesta`.

1. Open `/respuesta` unauthenticated.
2. Confirm **no cell shows a count below the threshold** (no «… · 1 en espera», no «… · 2 …» if k=3);
   small cells appear rolled into an «otras» row.
3. Confirm the page **explains** that low counts are grouped to protect households.
4. Adversarial check: try to narrow by zone + category and confirm you cannot resolve a group down to
   a near-identifying count.

**Pass = the public page never exposes a sub-threshold zone×category count, single or in combination,
and says why.**
