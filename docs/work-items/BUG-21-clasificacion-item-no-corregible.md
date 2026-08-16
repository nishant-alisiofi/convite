# BUG-21 — Proposed item classification (`codigo_item`) is not correctable (D3)

- **Type:** BUG
- **Tier:** 1 — Defect on the live demo (PRD v3 Part III)
- **Priority:** P1 — correctness
- **Status:** Open
- **Source:** PRD v3 §Defects **D3**.

## What's wrong (PRD v3 · D3)

In **Verificación** the transcript can be corrected, but the **proposed `codigo_item`
(classification) cannot**. These are two separate errors: a perfect transcript can still carry the
wrong category (e.g. audio clearly says "agua potable" but the classifier proposed a medicine code).
The verifier can fix the words and still be forced to sign the wrong category.

## Why it matters

Verifying is supposed to produce a record a person read, believed, and signed (PRD v3 §6). If half the
record (the category that drives matching and the Tablero bucket) is uncorrectable, the human can't
actually make it right — the matcher then routes against a wrong category no one could fix.

## Fix / acceptance criteria

1. The verifier can **correct the proposed `codigo_item`** independently of the transcript — pick a
   different catalogue code before `Verificar y crear pedido`.
2. Transcript correction and classification correction are **two independent edits**; correcting one
   does not require or clobber the other.
3. Both the original proposed classification and the original transcript are **preserved** (the
   "machine's read is kept aside" invariant, PRD v3 §6); corrections are logged with who made them.
4. `sin clasificar` items keep refusing to guess (PRD v3 §6) — the classify action assigns a
   `codigo_item` through the same correctable path.

## Codex validation (run on staging.convite.ai)

> **Do not touch production.** Log in per `docs/validacion-codex-0a1.md`.

1. Log in as **verificador** (`talos+convite-verificador@downshiftit.com`), open **Verificación**.
2. Open an item with a proposed classification: change the category to a **different catalogue code**,
   save, and confirm it persists and flows to the created pedido with the corrected code.
3. Confirm the transcript can still be corrected **separately** in the same item.
4. Confirm the originally-proposed classification is still recorded (not lost) after correction.

**Pass = the verifier can change the item's category independently of the transcript, both originals
are preserved, and the corrected code drives the resulting pedido.**
