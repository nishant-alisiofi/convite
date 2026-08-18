import { sql } from 'drizzle-orm'
import { boolean, char, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, pk } from './_shared'
import { catalogoItems } from './catalogo'
import { comunidades, organizaciones, usuarios } from './core'
import { nodos, pedidos, rutas } from './marketplace'

/**
 * PRD-33 (§24) — cold chain constraints and anticipatory supply.
 *
 * Two capabilities the medicine bank needs so it stops lurching between stockouts, both kept
 * out of the tables they constrain so the constraint is additive data, not a schema rewrite of
 * Catálogo, Rutas or Nodos (2.8: the catalogue is data, not code):
 *
 *   1. Cold chain. Insulin and injectables carry temperature/light constraints that make some
 *      open routes invalid — a six-hour open boat is not a path for insulin. An item declares
 *      its storage requirement; a route declares whether it can *carry* cold chain; a node
 *      declares whether it can *hold* it. The matcher (lib/matching) reads all three and
 *      excludes routes that cannot preserve the item, surfacing a distinct stuck-state rather
 *      than proposing an invalid route.
 *
 *   2. Anticipatory supply. In `ordinario`, demand is predictable — a partera on losartán needs
 *      a refill monthly — so the order is proposed BEFORE she asks. A subscription carries a
 *      refill cadence; a resolver distinct from the reactive matcher proposes the next order
 *      ahead of stockout, and a person confirms it before it becomes a pedido (2.1, principle 7).
 *
 * These are the two of §24's three supply capabilities that are not funded local purchase
 * (PRD-9). Real cold-storage hardware/telemetry at nodes is an open question (§34) and out of
 * scope here — `apta_cadena_frio` is a declared capability, not a sensor reading.
 */

// ── Cold chain: item requirement ──────────────────────────────────────────────────────────
//
// One row per catalogue item that carries a storage constraint. Absence of a row means an
// ordinary item with no constraint, which is every item the matcher saw before this shipped.

export const catalogoRequisitosAlmacenamiento = pgTable(
  'catalogo_requisitos_almacenamiento',
  {
    codigoItem: char('codigo_item', { length: 2 })
      .primaryKey()
      .references(() => catalogoItems.codigo),
    /** Requires refrigeration end to end — the flag the matcher gates routing on. */
    cadenaFrio: boolean('cadena_frio').notNull().default(false),
    /** Degrades in light. Recorded for completeness of the constraint model (§24). */
    sensibleLuz: boolean('sensible_luz').notNull().default(false),
    /**
     * Longest the item tolerates in open transit before it spoils, in minutes. Null = no time
     * bound (cold chain still enforced by route/node aptitude). For insulin this is the window
     * that rules out the long river legs — the «six-hour open boat».
     */
    maxMinutosTransito: integer('max_minutos_transito'),
    notas: text('notas'),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  () => [
    check(
      'catalogo_requisitos_max_minutos_check',
      sql`max_minutos_transito is null or max_minutos_transito > 0`,
    ),
  ],
)

// ── Cold chain: route restriction ─────────────────────────────────────────────────────────
//
// One row per route (leg) that has been assessed for cold chain. Absence = not assessed = not
// apt (fail-closed): an unassessed open boat never carries insulin. Only read for cold-chain
// items, so it is invisible to every existing match.
//
// RLS (0058): read is scoped to an organisation that owns either endpoint community of the
// route (plus a platform-admin read) — a route has no single owning org of its own. Originally
// shipped role-only; tightened after a staging security review found any organisation could
// read another's cold-chain routing data. Write is intentionally left role-only, matching
// `rutas_coordina` (0017): a route is shared infrastructure, coordinated by whichever org is
// moving something along it.

export const rutasRestriccionCadenaFrio = pgTable('rutas_restriccion_cadena_frio', {
  rutaId: uuid('ruta_id')
    .primaryKey()
    .references(() => rutas.id, { onDelete: 'cascade' }),
  /** Whether this leg can carry a cold-chain item — refrigerated or a short covered run. */
  aptaCadenaFrio: boolean('apta_cadena_frio').notNull().default(false),
  notas: text('notas'),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
})

// ── Cold chain: node capability ───────────────────────────────────────────────────────────
//
// One row per node that can hold cold chain (has cold storage). Absence = cannot (fail-closed).
// §34 (what storage actually exists at nodes) is open; this is a declared capability flag, not
// telemetry.
//
// RLS (0058): read is scoped through `nodo_id -> nodos.comunidad_id -> comunidades.organizacion_id`
// (plus a platform-admin read) — the same chain the write policy already used. Originally
// shipped role-only on read; tightened after a staging security review found any organisation
// could read another's node cold-storage capability.

export const nodosAlmacenamientoFrio = pgTable('nodos_almacenamiento_frio', {
  nodoId: uuid('nodo_id')
    .primaryKey()
    .references(() => nodos.id, { onDelete: 'cascade' }),
  /** Whether this node can hold a cold-chain item until it moves. */
  aptaCadenaFrio: boolean('apta_cadena_frio').notNull().default(false),
  notas: text('notas'),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
})

// ── Anticipatory supply: the subscription ─────────────────────────────────────────────────
//
// A predictable recurring need — a chronic treatment, diabetes supplies, prenatal cadence
// (§30). Org-scoped like every operational table (0017 / 0030). `cadencia_dias` is the refill
// interval; a null cadence means the anticipatory resolver never fires for it (a need tracked
// but not on a clock). `beneficiario_ref` is the opaque label of §27b.1 — never a name or a
// clinical record; Convite consumes a cadence, it does not prescribe one (§27b.1, §2).

export const suministrosAnticipados = pgTable(
  'suministros_anticipados',
  {
    id: pk(),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    comunidadId: uuid('comunidad_id')
      .notNull()
      .references(() => comunidades.id),
    /** Opaque beneficiary label (§27b.1) — «Partera del Atrato medio», never PII. */
    beneficiarioRef: text('beneficiario_ref'),
    codigoItem: char('codigo_item', { length: 2 })
      .notNull()
      .references(() => catalogoItems.codigo),
    familias: integer('familias').notNull(),
    /** Refill interval in days. Null = no cadence: anticipation never fires (AC4). */
    cadenciaDias: integer('cadencia_dias'),
    /** Propose this many days before the next refill is due. */
    diasAnticipacion: integer('dias_anticipacion').notNull().default(7),
    /** When it was last supplied. Null = never; the base for the first proposal is `creado_en`. */
    ultimoSuministroEn: timestamp('ultimo_suministro_en', { withTimezone: true, mode: 'date' }),
    /** The order is only valid until here (from the telemedicine order, §27b.1). Null = open. */
    vigenciaHasta: timestamp('vigencia_hasta', { withTimezone: true, mode: 'date' }),
    /** Who set it (2.1). Signed against auth.uid() by the insert policy. */
    creadoPor: uuid('creado_por').references(() => usuarios.id),
    activo: boolean('activo').notNull().default(true),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('suministros_anticipados_organizacion_idx').on(t.organizacionId),
    index('suministros_anticipados_comunidad_idx').on(t.comunidadId),
    index('suministros_anticipados_item_idx').on(t.codigoItem),
    check('suministros_anticipados_familias_check', sql`familias > 0`),
    check(
      'suministros_anticipados_cadencia_check',
      sql`cadencia_dias is null or cadencia_dias > 0`,
    ),
    check('suministros_anticipados_anticipacion_check', sql`dias_anticipacion >= 0`),
  ],
)

// ── Anticipatory supply: the proposal ─────────────────────────────────────────────────────
//
// What the anticipatory resolver proposes for one refill due date. Idempotent per due date, so
// re-running never duplicates. A proposal is nothing until a person confirms it (2.1): only
// then does it carry a `confirmado_por` and a `pedido_id` for the demand it became.

export const propuestasAnticipadas = pgTable(
  'propuestas_anticipadas',
  {
    id: pk(),
    suministroId: uuid('suministro_id')
      .notNull()
      .references(() => suministrosAnticipados.id, { onDelete: 'cascade' }),
    /** The refill due date this proposal is for. */
    propuestoParaEn: timestamp('propuesto_para_en', { withTimezone: true, mode: 'date' }).notNull(),
    /** The confirming person (2.1, principle 7). Null while it is only a proposal. */
    confirmadoPor: uuid('confirmado_por').references(() => usuarios.id),
    confirmadoEn: timestamp('confirmado_en', { withTimezone: true, mode: 'date' }),
    /** The pedido this became on confirmation. Null until confirmed. */
    pedidoId: uuid('pedido_id').references(() => pedidos.id),
    creadoEn: creadoEn(),
  },
  (t) => [
    uniqueIndex('propuestas_anticipadas_suministro_fecha_key').on(t.suministroId, t.propuestoParaEn),
    index('propuestas_anticipadas_suministro_idx').on(t.suministroId),
    // Same shape as emparejamientos: a confirmation is a person and a timestamp, or neither.
    check(
      'propuestas_anticipadas_confirmacion_check',
      sql`(confirmado_por is null and confirmado_en is null)
          or (confirmado_por is not null and confirmado_en is not null)`,
    ),
    // A proposal only becomes a pedido once a person has confirmed it.
    check(
      'propuestas_anticipadas_pedido_check',
      sql`pedido_id is null or confirmado_por is not null`,
    ),
  ],
)
