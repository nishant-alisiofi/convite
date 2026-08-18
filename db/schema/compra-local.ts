import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, enLista, pk } from './_shared'
import { catalogoItems } from './catalogo'
import { comunidades, contactos, organizaciones, usuarios } from './core'
import { pedidos } from './marketplace'

/**
 * PRD-9 — Funded local purchase, the third supply mode (PRD v3 §24 / §30).
 *
 * The first two supply modes move existing goods: counted node stock and individual in-kind
 * offers. This inverts the default — instead of shipping a thing in, **allocate funds to a
 * territorial responsible who buys in or near the municipality**. Less time, lower cost, local
 * economies strengthened, and for a river-cut community it is sometimes the only mode that arrives
 * in time. A `SIN_EXISTENCIA` demand the matcher cannot resolve from stock or offers becomes a
 * candidate for a purchase against a funding pool.
 *
 * It is not a payments integration (out of v1 scope) — it is a **traceability chain**. §24/§30
 * names the six steps, and this schema is that chain made into state a database enforces:
 *
 *   autorización → responsable → recibo → verificación → distribución → evidencia
 *
 *   * autorización + responsable  →  a `compras_locales` row created `AUTORIZADA`, with the
 *                                    deciding human (`autorizado_por`) and the territorial
 *                                    `responsable_id` who will buy. Immutable once recorded.
 *   * recibo                      →  `COMPRADA`, with `recibo_ref` and a `recibo` evidence row.
 *   * verificación                →  `VERIFICADA`, materials received checked by a person.
 *   * distribución                →  `DISTRIBUIDA`, handed out in/near the municipality.
 *   * evidencia (fotográfica)     →  `CERRADA`, with documentary/photographic `compra_local_evidencias`.
 *
 * The state machine cannot skip a step (checks below), the authorisation core cannot be edited
 * after the fact (the immutability trigger in 0049), and a funding pool refuses a purchase that
 * would breach its ceiling (the guardrail trigger, mirroring the M10 voice-spend caps). The RLS
 * floor, the triggers and the guardrail live in db/migrations/0049_compra_local_financiada.sql,
 * which drizzle-kit does not generate; `pnpm db:check` diffs the two.
 */

/**
 * The six-step chain as states. `COMPRADA` folds in the receipt (step 3), `CERRADA` the closing
 * evidence (step 6). Text + check so a new state is a one-line ALTER (Section 5).
 */
export const ESTADOS_COMPRA_LOCAL = [
  'AUTORIZADA',
  'COMPRADA',
  'VERIFICADA',
  'DISTRIBUIDA',
  'CERRADA',
  'CANCELADA',
] as const

/** What a piece of evidence is. `recibo` is the confirmation of purchase; the rest is the trail. */
export const TIPOS_EVIDENCIA_COMPRA = ['recibo', 'foto', 'documento', 'acta'] as const

export type EstadoCompraLocal = (typeof ESTADOS_COMPRA_LOCAL)[number]
export type TipoEvidenciaCompra = (typeof TIPOS_EVIDENCIA_COMPRA)[number]

// ── The budget guardrail: a pool with a ceiling and an alert threshold ──────────────────────

/**
 * A funding pool a purchase draws on (AC #4). `techo_cop` is the hard ceiling — the guardrail
 * trigger in 0049 refuses a purchase whose authorised amount would push the pool's committed
 * total past it, until the ceiling is raised. `umbral_alerta_cop` is the softer line a screen
 * warns at, the way M10 warns before the voice-spend cap rather than only at it.
 */
export const fondosCompra = pgTable(
  'fondos_compra',
  {
    id: pk(),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    nombre: text('nombre').notNull(),
    /** Hard ceiling in COP. New purchases are blocked once committed spend would exceed it. */
    techoCop: bigint('techo_cop', { mode: 'number' }).notNull(),
    /** Optional soft line a screen alerts at. ≤ the ceiling. */
    umbralAlertaCop: bigint('umbral_alerta_cop', { mode: 'number' }),
    activo: boolean('activo').notNull().default(true),
    creadoPor: uuid('creado_por').references(() => usuarios.id),
    notas: text('notas'),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('fondos_compra_organizacion_idx').on(t.organizacionId),
    check('fondos_compra_techo_check', sql`techo_cop > 0`),
    check(
      'fondos_compra_umbral_check',
      sql`umbral_alerta_cop is null or (umbral_alerta_cop > 0 and umbral_alerta_cop <= techo_cop)`,
    ),
  ],
)

// ── Local vendors: who, where, what they can supply ─────────────────────────────────────────

export const proveedoresLocales = pgTable(
  'proveedores_locales',
  {
    id: pk(),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    nombre: text('nombre').notNull(),
    /** Where they are, when it maps to a known community. */
    comunidadId: uuid('comunidad_id').references(() => comunidades.id),
    /** The municipality, for a vendor near but not in a seeded community. */
    municipio: text('municipio'),
    /** Free text of what they can supply — the catalogue coupling is out of v1 scope. */
    suministra: text('suministra'),
    contacto: text('contacto'),
    /**
     * FR-44 — a local pharmacy: medicine already sitting in a community, not shipped in. Distinct
     * from an ordinary vendor only in that its stock is tracked structurally, item by item, in
     * `proveedor_existencias` rather than the free-text `suministra` above — meeting a medical
     * need locally is faster and cheaper than trucking supplies down the river. Out of v1 scope:
     * live POS/ERP integration and non-medical retail (WI scope note).
     */
    esFarmacia: boolean('es_farmacia').notNull().default(false),
    activo: boolean('activo').notNull().default(true),
    creadoPor: uuid('creado_por').references(() => usuarios.id),
    notas: text('notas'),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('proveedores_locales_organizacion_idx').on(t.organizacionId),
    // A pharmacy is "a supply source tied to a community" (FR-44 AC #1) — the tie is required,
    // not optional, for exactly the kind of vendor this WI is about.
    check(
      'proveedores_locales_farmacia_comunidad_check',
      sql`not es_farmacia or comunidad_id is not null`,
    ),
  ],
)

/**
 * FR-44 — a local pharmacy's medical stock, item by item: the structured twin of the free-text
 * `suministra` above. One row per (proveedor, item), same shape as `existencias` for node stock,
 * so Existencias/Compra local can read pharmacy stock the same way they read counted stock.
 * `organizacion_id` is denormalised from the parent (same pattern as `compras_locales`) so RLS
 * reads it directly rather than joining through `proveedores_locales` on every row check.
 */
export const proveedorExistencias = pgTable(
  'proveedor_existencias',
  {
    id: pk(),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    proveedorId: uuid('proveedor_id')
      .notNull()
      .references(() => proveedoresLocales.id, { onDelete: 'cascade' }),
    codigoItem: char('codigo_item', { length: 2 })
      .notNull()
      .references(() => catalogoItems.codigo),
    cantidad: integer('cantidad').notNull().default(0),
    contadoEn: timestamp('contado_en', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    contadoPor: uuid('contado_por')
      .notNull()
      .references(() => usuarios.id),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('proveedor_existencias_organizacion_idx').on(t.organizacionId),
    uniqueIndex('proveedor_existencias_proveedor_item_key').on(t.proveedorId, t.codigoItem),
    check('proveedor_existencias_cantidad_check', sql`cantidad >= 0`),
  ],
)

// ── The purchase + its traceability chain ───────────────────────────────────────────────────

/**
 * One funded purchase, walked through the six-step chain. The authorisation half
 * (`autorizado_por`, `autorizado_en`, `monto_autorizado_cop`, `fondo_id`, `responsable_id`) is
 * immutable once recorded — the immutability trigger in 0049 refuses to let those columns change,
 * so «logged with the deciding human and immutable after recording» (AC #3) is a database
 * invariant, not a convention. Later columns advance as the chain does.
 */
export const comprasLocales = pgTable(
  'compras_locales',
  {
    id: pk(),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    /** The pool this draws on. The guardrail trigger sums against its ceiling. */
    fondoId: uuid('fondo_id')
      .notNull()
      .references(() => fondosCompra.id),
    /** The demand it resolves — a `SIN_EXISTENCIA` pedido a purchase satisfies (AC #1). */
    pedidoId: uuid('pedido_id').references(() => pedidos.id),
    /** The local vendor, when one is on record. */
    proveedorId: uuid('proveedor_id').references(() => proveedoresLocales.id),
    /** Step 2: the territorial responsible who buys near the municipality (§30). */
    responsableId: uuid('responsable_id')
      .notNull()
      .references(() => contactos.id),
    comunidadId: uuid('comunidad_id').references(() => comunidades.id),
    concepto: text('concepto').notNull(),
    /** Step 1: the amount authorised, in COP. Immutable. The guardrail sums this against the pool. */
    montoAutorizadoCop: bigint('monto_autorizado_cop', { mode: 'number' }).notNull(),
    /** Step 3: the amount actually spent, recorded with the receipt. */
    montoRealCop: bigint('monto_real_cop', { mode: 'number' }),
    estado: text('estado').notNull().default('AUTORIZADA'),

    /** Step 1: the deciding human (2.1). Immutable. Signed against auth.uid() by the insert policy. */
    autorizadoPor: uuid('autorizado_por').references(() => usuarios.id),
    autorizadoEn: timestamp('autorizado_en', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    /** Step 3: the receipt reference (a document id, a filed number). */
    reciboRef: text('recibo_ref'),
    compradoPor: uuid('comprado_por').references(() => usuarios.id),
    compradoEn: timestamp('comprado_en', { withTimezone: true, mode: 'date' }),
    /** Step 4: verification the materials were received. */
    verificadoPor: uuid('verificado_por').references(() => usuarios.id),
    verificadoEn: timestamp('verificado_en', { withTimezone: true, mode: 'date' }),
    /** Step 5: distribution in/near the municipality. */
    distribuidoPor: uuid('distribuido_por').references(() => usuarios.id),
    distribuidoEn: timestamp('distribuido_en', { withTimezone: true, mode: 'date' }),
    /** Step 6: closed once the documentary/photographic evidence is on record. */
    cerradoPor: uuid('cerrado_por').references(() => usuarios.id),
    cerradoEn: timestamp('cerrado_en', { withTimezone: true, mode: 'date' }),

    notas: text('notas'),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('compras_locales_organizacion_idx').on(t.organizacionId),
    index('compras_locales_fondo_idx').on(t.fondoId),
    index('compras_locales_estado_idx').on(t.estado),
    index('compras_locales_pedido_idx').on(t.pedidoId),
    check('compras_locales_estado_check', enLista('estado', ESTADOS_COMPRA_LOCAL)),
    check('compras_locales_monto_check', sql`monto_autorizado_cop > 0`),
    check('compras_locales_monto_real_check', sql`monto_real_cop is null or monto_real_cop >= 0`),
    // Each step's who-and-when is both-or-neither (2.1 shape).
    check(
      'compras_locales_comprado_check',
      sql`(comprado_por is null) = (comprado_en is null)`,
    ),
    check(
      'compras_locales_verificado_check',
      sql`(verificado_por is null) = (verificado_en is null)`,
    ),
    check(
      'compras_locales_distribuido_check',
      sql`(distribuido_por is null) = (distribuido_en is null)`,
    ),
    check('compras_locales_cerrado_check', sql`(cerrado_por is null) = (cerrado_en is null)`),
    // The chain cannot skip a step: a later state requires every earlier step's evidence.
    check(
      'compras_locales_comprada_check',
      sql`estado not in ('COMPRADA', 'VERIFICADA', 'DISTRIBUIDA', 'CERRADA')
          or (recibo_ref is not null and comprado_por is not null)`,
    ),
    check(
      'compras_locales_verificada_check',
      sql`estado not in ('VERIFICADA', 'DISTRIBUIDA', 'CERRADA') or verificado_por is not null`,
    ),
    check(
      'compras_locales_distribuida_check',
      sql`estado not in ('DISTRIBUIDA', 'CERRADA') or distribuido_por is not null`,
    ),
    check('compras_locales_cerrada_check', sql`estado <> 'CERRADA' or cerrado_por is not null`),
  ],
)

/** Line items of a purchase: what, how much, at what cost (AC #2). */
export const compraLocalItems = pgTable(
  'compra_local_items',
  {
    id: pk(),
    compraId: uuid('compra_id')
      .notNull()
      .references(() => comprasLocales.id, { onDelete: 'cascade' }),
    codigoItem: char('codigo_item', { length: 2 })
      .notNull()
      .references(() => catalogoItems.codigo),
    cantidad: integer('cantidad').notNull(),
    costoCop: bigint('costo_cop', { mode: 'number' }),
    creadoEn: creadoEn(),
  },
  (t) => [
    index('compra_local_items_compra_idx').on(t.compraId),
    check('compra_local_items_cantidad_check', sql`cantidad > 0`),
    check('compra_local_items_costo_check', sql`costo_cop is null or costo_cop >= 0`),
  ],
)

/**
 * The documentary/photographic trail (steps 3 and 6): the receipt, the photos of materials
 * received, the distribution act. Append-only and immutable, like the rest of the audit trail —
 * an evidence row, once filed, is not edited or deleted (no update/delete grant in 0049).
 */
export const compraLocalEvidencias = pgTable(
  'compra_local_evidencias',
  {
    id: pk(),
    compraId: uuid('compra_id')
      .notNull()
      .references(() => comprasLocales.id, { onDelete: 'cascade' }),
    tipo: text('tipo').notNull(),
    /** Where the evidence lives — a stored file path/url or a filed reference. */
    referencia: text('referencia').notNull(),
    descripcion: text('descripcion'),
    subidoPor: uuid('subido_por').references(() => usuarios.id),
    creadoEn: creadoEn(),
  },
  (t) => [
    index('compra_local_evidencias_compra_idx').on(t.compraId),
    check('compra_local_evidencias_tipo_check', enLista('tipo', TIPOS_EVIDENCIA_COMPRA)),
  ],
)
