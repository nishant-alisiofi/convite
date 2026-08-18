# FR-45 — Categorías de bienes de ayuda (alimentos / medicinas / construcción)

- **Type:** FR
- **Tier:** 2 — Roadmap
- **Priority:** P2
- **Status:** In progress
- **Source:** Field feedback from Chocó (Doña Marta), relayed by Nishant 2026-08-17. "Ensure
  distinct tracking for: food & essential provisions; medical supplies & medicines; construction
  materials."

## Problem / why

The field thinks in families of goods, and reporting/needs must too: food, medicine, construction.
The catalogue may already carry a category; this WI guarantees the **three families are
first-class** and that inventory, needs, and reports can be filtered/summarised by them.

## Scope

**In:**
- Confirm/extend `catalogo` so every item belongs to one of the three families
  (**alimentos / medicinas / construcción**) — reuse the existing category field if present, add
  it if not (backfill existing items).
- Filter + summarise by family in Existencias/Inventario and in Informes (demand-vs-stock).
- Keep it consistent with the normalizer/lexicon so intake maps an item to its family.

**Out:** deep sub-taxonomies beyond the three families; per-item regulatory metadata.

## Acceptance criteria

1. Every catalogue item resolves to one of the three families; existing items are backfilled.
2. Existencias/Inventario and Informes can filter/summarise by family.
3. Intake normalisation places a recognised item in the right family.

## Validation approach (staging)

On `staging.convite.ai`, filter Inventario by each family and confirm items partition correctly;
confirm an intake item lands in the expected family.
