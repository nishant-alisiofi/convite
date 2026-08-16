# PRD-38 — Wire the real territory seed (`db/seed/territorio.sql`)

- **Type:** PRD
- **Tier:** 2 — Roadmap (PRD v3 Part IV) · community-registry data
- **Priority:** P1
- **Status:** Backlog
- **Source:** The real territory reference data in `db/seed/territorio.sql` (Chocó / ASOREDIPARCHOCÓ +
  Pacífico caucano / Fundación Herencia de Timbiquí). Partners: §30, §31.
- **Depends on:** **PRD-37** (territory & registry schema) — hard blocker. See the dependency chain
  below.

## Problem / why

`db/seed/territorio.sql` is real territory reference data — 3 regions, ~65 communities (31 Chocó
cabeceras, 12 Quibdó corregimientos, 3 Cauca cabeceras, ~17 river communities), the ASOREDIPARCHOCÓ
response-plan catalogue, nodes, ~40 hand-entered routes (seasonal, directional), and Herencia's
historical jornadas. It currently **cannot run**: it inserts into schema that does not exist yet. This
WI wires it so the seed loads cleanly once the schema lands.

**Why it matters:** it is the honest-data foundation of the whole product. Every seeded row carries
`verificado_en = NULL` — **nothing counts as verified until someone from the territory confirms it**
(the seed's own header). Coordinates are deliberately approximate so *the people who know the
territory correct them, rather than us pretending to be right*. And Herencia's historical jornadas are
seeded so that **when they open the map they see their own work, not an empty screen** (§31).

## The dependency chain (build schema first, then seed)

```
PRD-37  (schema)                         →  PRD-38  (this WI: run the seed)
  · regiones + comunidades.region_id
  · comunidades.verificado_en (default NULL)
  · organizaciones.techo_permisos (jsonb)   ← ceiling logic later: PRD-16 §29.4
  · organizaciones.aval_motivo (text)       ← vouching logic later: PRD-35 §29.3b
  · jornadas + jornada_paradas tables       ← jornada feature later: PRD-30 §22
```

The seed only needs the **schema** from PRD-37, not the feature logic in PRD-16 / PRD-30 / PRD-35 — so
it is unblockable as soon as PRD-37's migration lands, ahead of those features. Do **not** run the seed
before PRD-37; the inserts will fail on missing tables/columns.

## Scope

**In:**
- Wire `db/seed/territorio.sql` into the seed tooling so it **runs cleanly** end-to-end against the
  PRD-37 schema (regiones → organizaciones → catálogo → comunidades → nodos → rutas → jornadas →
  jornada_paradas), respecting FK order and the PostGIS/pgcrypto extensions the file expects.
- Keep it **idempotent / re-runnable** (or clearly one-shot with documented preconditions), so a
  re-seed does not duplicate the registry.
- Confirm every insert's columns match PRD-37 (regiones, region_id, verificado_en, techo_permisos,
  aval_motivo, jornadas/jornada_paradas) and the verify-existing columns (agrupador,
  tier_conectividad, intervalo_chequeo_dias, familias_estimadas, rutas.temporada/fuente/modo/minutos/
  notas, nodos, catalogo_items).

**Environment (important):**
- **This real registry data is appropriate for BOTH staging AND production** — it is the community
  registry (regions, communities, catalogue, nodes, routes, historical jornadas), **not** demo test
  data. It is analogous to reference/lookup data, not to test rows.
- This is **unlike** the demo `db:seed` reports/pedidos (fabricated reportes, transcripts, pedidos for
  the demo), which are **staging-only** and must never touch production per the "never test in
  production" policy. Keep the two seeds **separate**: `territorio.sql` = registry (staging + prod);
  demo report/pedido seed = staging only.

**Out:**
- The schema migration itself — **PRD-37** (engineering owns migrations).
- Any feature that renders this data (map jornadas → PRD-30/PRD-32; verified badges → PRD-28/PRD-35;
  ceiling enforcement → PRD-16). The seed lands the rows; the features surface them.
- Correcting the approximate coordinates/routes — that is the whole point of the field workshop, not a
  build task; `verificado_en = NULL` is intentional.

## Acceptance criteria

1. With **PRD-37's** schema applied, `db/seed/territorio.sql` **runs to completion with zero errors**
   (all inserts succeed in FK order; extensions present).
2. After seeding: 3 regiones; both partner organisaciones with a minimal `techo_permisos` and the
   `aval_motivo` seed note; the full catalogue; the Chocó + Cauca communities each with `region_id`,
   `ubicacion`, tier/interval, and **`verificado_en = NULL`**; nodes; the seasonal/directional routes;
   and Herencia's 3 historical jornadas with their jornada_paradas.
3. The seed is **re-runnable without duplicating** the registry (documented behaviour).
4. It is documented that `territorio.sql` is **registry data valid for staging and production**, kept
   separate from the **staging-only** demo report/pedido seed.
5. No demo/test reportes or pedidos are introduced by this seed (registry only).

## Validation approach (future, on staging)

Apply PRD-37, run the seed on staging, and confirm the row counts above and that every community has
`verificado_en = NULL`. Open Comunidades/Mapa (once PRD-28/PRD-32 render it) and confirm the territory
and Herencia's historical jornadas appear. Re-run the seed and confirm no duplication. Never run the
seed's demo counterpart on production; the registry seed may later be applied to production as
reference data with founder approval. Never validate on production.
