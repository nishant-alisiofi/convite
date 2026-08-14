# Convite

Coordinación de ayuda humanitaria en la cuenca del Atrato, Chocó.

Convite is a three-sided marketplace: communities that need things, nodes that hold stock, and
people who are actually travelling. For every open request the matcher works out **which side is
missing** — `SIN_RUTA`, `SIN_EXISTENCIA`, `SIN_CAPACIDAD`, `LISTO` — because "12 esperan
transporte, 8 esperan donación, 3 están incomunicadas" is a set of phone calls, and "38
pendientes" is not.

User-facing copy is Spanish (Colombian). Code, comments and commits are English. Database tables
and columns are Spanish on purpose: they match the vocabulary the field team uses.

## Estado

**M1 — Foundation.** Schema, migrations, catalogue and a seeded basin of 13 communities around
Quibdó.

**M2 — Matching engine.** Pure resolver in `lib/matching/`, job queue in `lib/jobs/`, worker route
at `POST /api/jobs/correr`. `pnpm emparejar` runs one sweep and prints the board. Resolves against
`ofertas` as well as `existencias`, and perishables outrank everything (2.15).

**M3 — Auth and coordinator shell.** Supabase magic-link sign-in, an admin-managed staff
allowlist, RLS policies for all five roles, and the Tablero reading real data through RLS.

**Infra.** Live Supabase project `convite` (us-east-1, ref `kjwkvulmsjffzhuchwpy`). All 18
migrations applied, basin seeded, 116 tests green against the real database.

Next: M4 — the normalizer.

### Entrar por primera vez

```bash
pnpm invitar tu@correo.org admin          # solo el primer admin se crea por terminal
pnpm dev                                   # luego /entrar y llega el enlace mágico
```

A magic link proves you own an address; it does not make you staff. Without a row in
`invitaciones_staff` an authenticated session has no `usuarios` record and therefore reads
nothing (2.10).

### Quién puede qué

| | verificador | despachador | coordinador | admin | lectura |
|---|---|---|---|---|---|
| Verificar reportes | sus comunidades | — | ✓ | ✓ | — |
| Promover a pedido | sus comunidades | — | ✓ | ✓ | — |
| Capacidades y envíos | — | ✓ | ✓ | ✓ | — |
| Inventario y rutas | — | — | ✓ | ✓ | — |
| Crear centros, catálogo, comunidades | — | — | — | ✓ | — |
| Tablas base | por comunidad | ✓ | ✓ | ✓ | ninguna |

Separation of duties is the point: whoever confirms a need is real is not the one who decides
it gets skipped. Both directions are asserted in `tests/rls.db.test.ts` against the database,
not against the UI.

### El emparejador

`resolver(pedido, contexto)` is a pure function — no database, no clock, no network — that answers
which of the three sides is missing:

- **SIN_RUTA** — no open path this season, *or* the goods exist but are stranded on the other side
  of a closed leg. Different sentence for each, because they are different phone calls.
- **SIN_EXISTENCIA** — nowhere in the basin holds enough. Call a donor.
- **SIN_CAPACIDAD** — stock is in reach and nobody is travelling. Usually the binding constraint.
- **LISTO** — all three align, and a proposal is written for a human to confirm.

It never decrements stock, never commits a boat, never deactivates a route. Under scarcity two
requests can both come back LISTO against the same pallet: deciding who waits is a human decision
that gets logged in `decisiones_asignacion` (2.9), not something the engine resolves quietly.

`motivo` is the product surface — «Hay 180 mercados en Bodega Central Quibdó, pero nadie va para
Bellavista en los próximos 14 días» — and it names the stock's age whenever the count is old.

## Requisitos

- Node 20.9+
- pnpm 9 (`corepack enable pnpm`)
- A container runtime for local Postgres+PostGIS (Docker Desktop, OrbStack or Colima), **or** a
  Supabase/Neon `DATABASE_URL` with PostGIS available

## Arranque

```bash
cp .env.example .env      # DATABASE_URL ya apunta al docker local
pnpm install
pnpm db:up                # Postgres 16 + PostGIS 3.4 en el puerto 5433
pnpm db:migrate
pnpm db:seed
pnpm test
```

`pnpm db:reset` drops the schema and redoes all three. It refuses to run against anything that is
not obviously a local database.

Against Supabase instead of docker: set `DATABASE_URL` to the pooler connection string and skip
`db:up`. The migrations are written to be no-ops where Supabase already provides the object
(`anon`/`authenticated`/`service_role`, `auth.uid()`).

## Estructura

```
db/schema/        Drizzle schema — the typed mirror used by application code
db/migrations/    Hand-authored SQL — what actually runs
db/seed/          Seed data: catalogue, communities, route graph, demo operation
scripts/          migrate · seed · reset
lib/              env validation (Zod)
tests/            pure seed-integrity tests + DB tests (skipped without DATABASE_URL)
app/              Next.js 15 App Router (placeholder until M3)
```

### Por qué las migraciones son SQL a mano

Most of this schema is things drizzle-kit does not generate: PostGIS geometry columns and GiST
indexes, partial unique indexes, `nulls not distinct`, views, triggers, and the RLS floor. So
`db/migrations/*.sql` is the source of truth for the database and `db/schema/*.ts` is the typed
mirror the app queries through. `pnpm db:check` diffs the two so drift is visible rather than
silent.

## Lo que la base de datos hace cumplir

The non-negotiables are constraints, not conventions. `tests/esquema.db.test.ts` proves each one
against a live database:

| Regla | Cómo se hace cumplir |
|---|---|
| 2.1 Un humano confirma | `verificado_por`/`verificado_en`, `despachado_por`, `confirmado_por` con checks de pareja |
| 2.2 Nunca inventar una coordenada | `ubicacion_fuente` + `ubicacion_precision_m` obligatorios junto a cada punto; `gps` exige radio 0 |
| 2.3 El inventario no es promesa | `contado_en` y `contado_por` son NOT NULL |
| 2.4 Lo público va agregado | RLS en todas las tablas; `anon` solo lee `mapa_publico` |
| 2.5 Sin EXIF | `check (tipo <> 'foto' or exif_removido)` |
| 2.6 Almacenamiento propio | `check (storage_key !~* '^https?://')` |
| 2.7 Idempotencia | índice único parcial sobre `(proveedor, proveedor_mensaje_id)` |
| 2.8 El catálogo es dato | tabla `catalogo_items`, sin enums ni `switch` sobre códigos |
| 2.9 El racionamiento se registra | `decisiones_asignacion` |
| 2.10 La comunidad no inicia sesión | `contactos` (teléfono) frente a `usuarios` (auth) |

## El grafo de rutas

```
road/trocha            río Atrato (aguas abajo →)
SFI ─ TUT ─┐
PAC ───────┤
YUT ─ GUY ─┴─ QBD ──▶ BTA ──▶ MER ──▶ TAG ──▶ BET ──▶ BLL
               │              └──▶ WIN  (solo en lluvias)
               └──▶ PAI  (río Quito)
```

Google Maps has no river data — no route, no travel time, no seasonality — so every fluvial leg is
`fuente='manual'` with times from someone who knows the river, and `distancia_m` stays null rather
than holding a straight line nobody can travel. `MER→TAG` is the chokepoint: closing that one leg
cuts off Tagachí, Beté and Bellavista at once.

## Datos sembrados: qué es real y qué no

- **Coordinates are approximate.** Gazetteer centroids, not surveyed points and not GPS pins —
  hence `ubicacion_fuente='centroide'` with a 1000 m radius on every community. The map must draw
  dashed circles, never dots, until the field team replaces them with pins.
- **Travel times are plausible, not measured.** They came from nobody who has run the river.
  Replace them before anyone plans a trip on them.
- **Phone numbers are synthetic** and deliberately not dialable.
- **`usuarios` ids are placeholders** until Supabase Auth lands in M3, where `usuarios.id` must
  equal the auth uid.
