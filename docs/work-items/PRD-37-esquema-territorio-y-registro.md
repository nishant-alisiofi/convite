# PRD-37 — Territory & registry schema (regiones, community verification, org ceiling/aval, jornadas tables)

- **Type:** PRD (schema-enabling)
- **Tier:** 2 — Roadmap (PRD v3 Part IV) · schema prerequisite for the real territory seed
- **Priority:** P1 — unblocks PRD-38 (the real registry seed) and several Part IV features
- **Status:** Backlog
- **Source:** The schema the real seed `db/seed/territorio.sql` requires that does **not exist yet**,
  plus PRD v3 §14 (verificado_en / silence), §29.3b (shared registry, aval), §29.4 (techo_permisos),
  §21b/§22 (jornadas), §7/§9 (map/routes).

## Problem / why

The real territory seed (`db/seed/territorio.sql`, wired by **PRD-38**) inserts into schema that is
not present yet. Rather than scatter these columns across the feature WIs (whose full logic lands
later), this WI delivers **the bare schema as one early migration** so the community registry can be
seeded on day one and the feature WIs build their logic on top. **This WI is schema only** — no
enforcement, no UI; that lives in the feature WIs cited below.

> **Engineering owns all schema/migrations** (root CLAUDE.md). This WI specifies *what* the seed and
> features need; the engineering agent designs the migration, reviews the generated SQL, updates the
> ERD, and runs it. Product does not touch `db/`, schema, or migrations.

## Scope

**In — new schema the seed requires:**
- **`regiones`** table: `id`, `nombre`, `departamento`, `tipo` (e.g. `mixta`/`rural`), `activa`. Seed
  rows: Chocó, Pacífico caucano, Valle del Cauca.
- **`comunidades.region_id`** — FK to `regiones` (communities are seeded per region).
- **`comunidades.verificado_en`** — nullable timestamp, **default NULL**. Semantics (§14, §29.3b):
  *nothing seeded counts as verified until someone from the territory confirms it.* Surfaced later as
  an "unverified" state by the registry/Comunidades UI (PRD-35 / PRD-28); this WI only adds the column.
- **`organizaciones.techo_permisos`** — `jsonb` capability ceiling (§29.4). Enforcement logic is
  **PRD-16**; this WI adds the column so the seed can set a minimal ceiling.
- **`organizaciones.aval_motivo`** — text vouch note (§29.3b). Vouching logic is **PRD-35**; this WI
  adds the column so the seed can record «Semilla inicial. Techo pendiente de acuerdo.»
- **`jornadas`** table: `codigo`, `tipo`, `organizacion_id`, `titulo`, `region_id`, `fecha_inicio`,
  `fecha_fin`, `estado` (incl. `historico`), `familias_atendidas`, `notas`.
- **`jornada_paradas`** table: `jornada_id`, `comunidad_id`, `orden`, `notas`. Jornada feature logic is
  **PRD-30**; the tables live here because the seed plants Herencia's historical jornadas before that
  feature ships (so the map isn't empty on day one).

**Verify-before-rebuild (should already exist per Part II — engineering confirms, does NOT recreate):**
- `comunidades`: `codigo`, `nombre`, `tipo`, `municipio`, `agrupador`, `ubicacion` (PostGIS point),
  `familias_estimadas`, `tier_conectividad`, `intervalo_chequeo_dias`, `activa`, `organizacion_id`
  (§7, §14).
- `rutas`: `origen_id`, `destino_id`, `modo`, `minutos`, `temporada`, `notas`, `activa` (§9 — seasonal
  rows already stored). **`rutas.fuente`** (e.g. `'manual'`) — confirm it exists; add if missing.
- `nodos` (`nombre`, `tipo`, `comunidad_id`, `activo`); `catalogo_items` (`codigo`, `familia`,
  `familia_label`, `item_label`, `tipo`, `pide_detalle`, `urgencia_min`, `entregable`, `orden`) — §8,
  §15; `organizaciones` (`tipo`, `activo`); PostGIS + pgcrypto extensions (PRD-2).

**Out:**
- All enforcement/UI on these columns/tables: capability-ceiling enforcement (**PRD-16**), vouching
  (**PRD-35**), jornada feature (**PRD-30**), verified-badge surfacing (**PRD-28**/**PRD-35**).
- Loading the seed data — **PRD-38**.

## Acceptance criteria

1. A migration adds `regiones`, `comunidades.region_id`, `comunidades.verificado_en` (nullable, default
   NULL), `organizaciones.techo_permisos` (jsonb), `organizaciones.aval_motivo` (text), and the
   `jornadas` + `jornada_paradas` tables, matching the columns `db/seed/territorio.sql` inserts.
2. `drizzle-kit generate` produces an **empty** migration afterwards (no drift); the ERD doc is updated.
3. The columns/tables in "verify-before-rebuild" are confirmed present (or added if genuinely missing),
   with **no destructive recreation** of existing `comunidades`/`rutas`/`nodos`/`catalogo_items` data.
4. `db/seed/territorio.sql` **parses and runs cleanly** against the migrated schema (verified in PRD-38).

## Dependencies

- **Blocks PRD-38** (the seed cannot run until this schema exists).
- **Feeds** PRD-16 (techo_permisos), PRD-35 (aval_motivo + shared registry), PRD-30 (jornadas), PRD-28
  (region/verified surfacing), PRD-31/PRD-32 (region + jornadas).

## Validation approach (future, on staging)

After the migration, confirm `drizzle-kit generate` is empty, the ERD is updated, and `territorio.sql`
loads with no error (this is PRD-38's acceptance). Confirm no existing community/route data was
dropped. Never run `drizzle-kit push` against staging/production; migrations only. Never validate on
production.
