# BUG-20 — Correction field pre-filled below the confidence threshold (D2)

- **Type:** BUG
- **Tier:** 1 — Defect on the live demo (PRD v3 Part III)
- **Priority:** P1 — correctness, not polish (PRD v3 §33)
- **Status:** ✅ Fixed — deployed (staging + prod), pending Codex validation · fixed in the D1–D9 batch
- **Source:** PRD v3 §Defects **D2**. Visible in the current demo (all seeded transcripts are 55–62%).

## What's wrong (PRD v3 · D2)

Every transcript shown in **Verificación** is at 55–62% confidence, and the `¿Qué dice en realidad?`
correction field arrives **pre-filled with the machine's guess**. At that confidence a tired verifier
clicks `Guardar corrección` without reading — the guess becomes the record. That is a rubber stamp, not
a correction.

## Why it matters

The whole verification screen exists so a human reads, believes, and signs (PRD v3 §6). Pre-filling a
low-confidence guess defeats it: the machine's error is laundered into a "human-verified" value. This
is the difference between a correction and a rubber stamp (PRD v3 §D2).

## Fix / acceptance criteria

1. Define a confidence **threshold**. **Below threshold, the correction field is left blank** so the
   verifier must transcribe what they hear. **At or above threshold, pre-fill** the machine's text as
   today.
2. The threshold and the behaviour are consistent everywhere audio is verified (WhatsApp voice notes,
   IVR recordings, radio clips).
3. Load-bearing copy is preserved: «Lo que oyó la máquina se conserva aparte; la corrección no lo
   borra.» (PRD v3 §6). The original transcript is never overwritten regardless of the field state.

## Codex validation (run on staging.convite.ai)

> **Do not touch production.** Log in per `docs/validacion-codex-0a1.md`.

1. Log in as **verificador** (`talos+convite-verificador@downshiftit.com`), open **Verificación**.
2. Open an audio item showing a **low** confidence (the seeded 55–62% items): the
   `¿Qué dice en realidad?` field is **empty**, not pre-filled with the machine's guess.
3. If a higher-confidence item exists (or one can be seeded), confirm its correction field **is**
   pre-filled.
4. Confirm the original machine transcript is still shown separately and is not erased by entering a
   correction.

**Pass = below the threshold the correction field is blank; at/above it, it is pre-filled; the
original is always preserved.**
