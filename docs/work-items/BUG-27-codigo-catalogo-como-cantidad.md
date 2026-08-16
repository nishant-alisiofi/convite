# BUG-27 — Catalogue code reads as a quantity in Inventario (D9)

- **Type:** BUG
- **Tier:** 1 — Defect on the live demo (PRD v3 Part III)
- **Priority:** P1 — visible on the demo Inventario
- **Status:** Open
- **Source:** PRD v3 §Defects **D9**. Related canonical behaviour: §8 (Inventario), §15 (Catálogo).

## What's wrong (PRD v3 · D9)

In **Inventario**, the two-digit catalogue code renders next to the item label as **«12 Agua potable»**,
which reads as a **quantity** ("12 units of potable water") against the PIDEN/EXISTENCIAS counts sitting
right beside it. The code and the counts are visually indistinguishable.

## Why it matters

Inventario is demand-vs-stock at a glance (PRD v3 §8): PIDEN (families, communities, orders) beside
EXISTENCIAS (totals per node). A code that looks like a count corrupts the one read the screen exists
for. This is on the demo Inventario now.

## Fix / acceptance criteria

1. The two-digit catalogue code is rendered **visually distinct** from any quantity — e.g. a styled
   code chip/badge or an explicit prefix — so «12 Agua potable» cannot be read as "12 of them".
2. The distinction holds everywhere the code appears beside counts (Inventario rows, and any header
   summary such as «8 artículos con pedidos abiertos …», PRD v3 §8).
3. The catalogue code itself is unchanged (still the two-digit code from §15) — only its presentation
   changes.

## Codex validation (run on staging.convite.ai)

> **Do not touch production.** Log in per `docs/validacion-codex-0a1.md`.

1. Log in as **coordinador** (`talos+convite-coordinador@downshiftit.com`), open **Inventario**.
2. Confirm each item's catalogue code is clearly a **code** (chip/prefix/distinct style), not a number
   that could be mistaken for the PIDEN/EXISTENCIAS counts beside it.
3. Confirm the PIDEN and EXISTENCIAS counts remain unambiguous.

**Pass = the catalogue code is never confusable with a quantity on Inventario.**
