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

**M8 — Mapa, editor de rutas, recogidas.** Coordinator map with precision-aware rendering, the
river-route editor, first-mile pickup clustering, and the season as an audited admin setting
instead of an environment variable. See [El mapa](#el-mapa) and [Las recogidas](#las-recogidas).

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

## El mapa

`/mapa` draws what the database knows about where things are, and nothing else.

**Precision is the whole feature.** A location renders as the shape its accuracy radius earns:
an exact fix is a point, a `centroide` is a dashed circle a kilometre across, a `referida` is a
dotted circle twice that. All thirteen seeded communities are centroids, so the honest map of this
basin today has **no pins on it at all**. The rule is driven by the stored radius rather than the
source name, so a row claiming `gps` while carrying a 1000 m error still draws as an area — shape
follows the number we actually hold. `lib/mapa/precision.ts`, asserted in `tests/mapa.test.ts`.

**Route lines are schematic.** Dashed connectors between endpoints, labelled with mode and time.
They do not trace the path, because we have no channel geometry: a `lancha` leg drawn straight
across land invents a route exactly the way a bare coordinate invents a location.

**There is no basemap, and that is deliberate for now.** The PRD's recommendation is MapLibre over
a Protomaps extract of Chocó, which would also work offline. Producing that extract needs the
`pmtiles` Go binary and a range-read against a global build; neither is set up here, so rather
than borrow a tiled basemap — an API key, an outbound request per screen, and still no landing
sites, since OSM has 13 ferry terminals in the entire basin — the map renders our own geography on
an empty background. Sources are asserted to be `geojson` only, so a tile source cannot reappear
unnoticed. Dropping an extract in later is a change to `fuentesYCapas()` in `lib/mapa/capas.ts`.

```bash
pnpm vista:mapa    # renders the map to .data/vista-mapa/index.html and prints the path
```

`/mapa` needs a Supabase session, which a local clone does not have. `vista:mapa` reads the same
rows through the same query and builds the same layers, so it is how you check the map without a
Supabase project. Serve the folder over http — ES modules and the MapLibre worker do not load from
`file://`.

## Las recogidas

First-mile pickup is a different problem from delivery: many stops a few hundred metres apart, over
roads, feeding one node. `recogidas_sugeridas()` (migration 0020) clusters offers by proximity with
`ST_ClusterDBSCAN` and returns **one ordered run** — six donations across three neighbourhoods come
back as six numbered stops, not six errands. Perishables lead, because cooked lunches set the
departure time for the whole trip (2.15).

It runs in Postgres rather than the browser because the coordinates never reach the browser: 0017
revoked `ofertas.ubicacion` from `authenticated`, and 2.16 is why. The function returns no address
and no coordinate — the address leaves the database only through `direccion_de_oferta()`, and only
for the driver assigned to collect it.

## Requisitos

- Node 22+ (`@supabase/supabase-js` 2.112 needs the native `WebSocket` that Node 20 lacks;
  Next.js polyfills it, so the app runs on 20 but plain scripts using the SDK crash)
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
scripts/          migrate · seed · reset · emparejar · vista-mapa
lib/              env validation (Zod)
lib/mapa/         precision → shape, circle geometry, map layers
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
