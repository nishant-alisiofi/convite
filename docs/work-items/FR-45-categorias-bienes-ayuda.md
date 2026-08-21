# FR-45 — Categorías de bienes de ayuda (alimentos / medicinas / construcción)

- **Type:** FR
- **Tier:** 2 — Roadmap
- **Priority:** P2
- **Status:** ✅ Built + deployed (staging + prod) — pending Codex validation
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

1. Every deliverable relief good that **belongs** to one of the three named families
   (alimentos / medicinas / construcción) carries that `familia_ayuda`; the three families are
   **complete and correct for their members** (no food/medicine/construction good left blank).
2. Goods in **other** relief-goods families (albergue/abrigo, agua-saneamiento-higiene, niñez)
   are tracked by the catalogue's own `familia` / `familia_label` and are **not** force-fit into
   the three — mislabelling a blanket as "construcción" is the fabrication rule 2.12 / BUG-23
   forbids. **Damage reports** (`tipo='dano'`, non-deliverable) are not relief goods and correctly
   carry no `familia_ayuda`.
3. Existencias/Inventario and Informes/Coordinación can filter/summarise by the three families.
4. Intake normalisation places a recognised food/medicine/construction item in the right family.

> **Correction (2026-08-19):** the original criterion 1 ("every catalogue item resolves to one
> of three") was too strict — the catalogue legitimately has more relief-goods families than the
> three the field named, plus non-goods damage reports. The field ask ("distinct tracking for
> food, medicine, construction") is met when those three are first-class, complete and filterable;
> forcing the rest in would violate the anti-fabrication rule. Codex should read a blank
> `familia_ayuda` on shelter/WASH/niñez/daños items as correct, not a defect.

## Validation approach (staging)

On `staging.convite.ai`, filter Inventario by each family and confirm items partition correctly;
confirm an intake item lands in the expected family.
