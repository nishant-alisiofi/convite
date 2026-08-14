import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, enLista, pk, punto } from './_shared'
import { catalogoItems } from './catalogo'
import { comunidades, contactos, usuarios } from './core'
import { reportes } from './intake'
import {
  CANALES,
  ESTADOS_CAPACIDAD,
  ESTADOS_ENVIO,
  ESTADOS_PEDIDO,
  FUENTES_RUTA,
  FUENTES_UBICACION,
  MODOS,
  MODOS_FLUVIALES,
  TEMPORADAS,
  TIPOS_NODO,
} from './vocabulario'

// ── Supply ────────────────────────────────────────────────────────────────────────────

export const nodos = pgTable(
  'nodos',
  {
    id: pk(),
    comunidadId: uuid('comunidad_id')
      .notNull()
      .references(() => comunidades.id),
    nombre: text('nombre').notNull(),
    tipo: text('tipo').notNull(),
    responsableId: uuid('responsable_id').references(() => contactos.id),
    ubicacion: punto('ubicacion'),
    ubicacionFuente: text('ubicacion_fuente'),
    ubicacionPrecisionM: integer('ubicacion_precision_m'),
    activo: boolean('activo').notNull().default(true),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    uniqueIndex('nodos_comunidad_nombre_key').on(t.comunidadId, t.nombre),
    index('nodos_comunidad_idx').on(t.comunidadId),
    check('nodos_tipo_check', enLista('tipo', TIPOS_NODO)),
    check(
      'nodos_ubicacion_declarada_check',
      sql`(ubicacion is null and ubicacion_fuente is null)
          or (ubicacion is not null and ubicacion_fuente is not null and ubicacion_precision_m is not null)`,
    ),
    check(
      'nodos_ubicacion_fuente_check',
      sql`ubicacion_fuente is null or ${enLista('ubicacion_fuente', FUENTES_UBICACION)}`,
    ),
  ],
)

/**
 * Non-negotiable 2.3: inventory is never a promise. `contado_en` and `contado_por` are NOT
 * NULL because a stock figure with no last-count is worse than no figure at all — it sends
 * someone on a three-hour trip to an empty store. Every surface that shows `cantidad` must
 * show `contado_en` beside it and say that confirmation happens on arrival.
 */
export const existencias = pgTable(
  'existencias',
  {
    id: pk(),
    nodoId: uuid('nodo_id')
      .notNull()
      .references(() => nodos.id, { onDelete: 'cascade' }),
    codigoItem: char('codigo_item', { length: 2 })
      .notNull()
      .references(() => catalogoItems.codigo),
    cantidad: integer('cantidad').notNull().default(0),
    contadoEn: timestamp('contado_en', { withTimezone: true, mode: 'date' }).notNull(),
    contadoPor: uuid('contado_por')
      .notNull()
      .references(() => usuarios.id),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    uniqueIndex('existencias_nodo_item_key').on(t.nodoId, t.codigoItem),
    check('existencias_cantidad_check', sql`cantidad >= 0`),
  ],
)

// ── Demand ────────────────────────────────────────────────────────────────────────────

/**
 * A verified need, and the unit the matcher works on. `estado` names which of the three
 * sides is missing — that classification is the product (Section 1). `motivo` is a plain
 * Spanish sentence that appears verbatim in the UI, e.g.
 * «Hay 18 mercados en Tutunendo, pero nadie va para allá esta semana».
 */
export const pedidos = pgTable(
  'pedidos',
  {
    id: pk(),
    reporteId: uuid('reporte_id')
      .notNull()
      .references(() => reportes.id),
    comunidadId: uuid('comunidad_id')
      .notNull()
      .references(() => comunidades.id),
    codigoItem: char('codigo_item', { length: 2 })
      .notNull()
      .references(() => catalogoItems.codigo),
    familias: integer('familias').notNull(),
    urgencia: smallint('urgencia').notNull().default(1),
    estado: text('estado').notNull().default('ABIERTO'),
    motivo: text('motivo'),
    nodoSugerido: uuid('nodo_sugerido').references(() => nodos.id),
    /**
     * Set when the plan sources from an individual offer rather than counted node stock —
     * the plan then includes a pickup leg (Section 8, step 2). FK declared in SQL (0011)
     * to avoid a circular import with `ofertas`.
     */
    ofertaSugerida: uuid('oferta_sugerida'),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('pedidos_estado_idx').on(t.estado),
    index('pedidos_comunidad_idx').on(t.comunidadId),
    uniqueIndex('pedidos_reporte_key').on(t.reporteId),
    check('pedidos_estado_check', enLista('estado', ESTADOS_PEDIDO)),
    check('pedidos_familias_check', sql`familias > 0`),
    check('pedidos_urgencia_check', sql`urgencia between 1 and 3`),
  ],
)

// ── Movement ──────────────────────────────────────────────────────────────────────────

/**
 * The route graph. Section 7.3: rivers are not in Google Maps. Fluvial legs are always
 * entered by a human who knows the river, and the same pair may appear twice with
 * different `temporada` because river level changes travel time more than any other
 * variable — a leg navigable in `lluvias` can be impassable in `seca`.
 *
 * Edges are directed. Upstream and downstream are not the same trip.
 */
export const rutas = pgTable(
  'rutas',
  {
    id: pk(),
    origenId: uuid('origen_id')
      .notNull()
      .references(() => comunidades.id),
    destinoId: uuid('destino_id')
      .notNull()
      .references(() => comunidades.id),
    modo: text('modo').notNull(),
    minutos: integer('minutos'),
    distanciaM: integer('distancia_m'),
    costoEstimadoCop: bigint('costo_estimado_cop', { mode: 'number' }),
    temporada: text('temporada').notNull().default('todo_el_ano'),
    fuente: text('fuente').notNull().default('manual'),
    activa: boolean('activa').notNull().default(true),
    /** Why it was deactivated, who said so — never deactivate without one. */
    notas: text('notas'),
    /**
     * Section 9.3: closing a leg is a person's decision, never a consequence of a damage
     * report arriving. Closing MER→TAG cuts off Tagachí, Beté and Bellavista at once, so
     * the name and the timestamp are not paperwork.
     */
    desactivadaPor: uuid('desactivada_por').references(() => usuarios.id),
    desactivadaEn: timestamp('desactivada_en', { withTimezone: true, mode: 'date' }),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    uniqueIndex('rutas_tramo_key').on(t.origenId, t.destinoId, t.modo, t.temporada),
    index('rutas_origen_idx').on(t.origenId),
    index('rutas_destino_idx').on(t.destinoId),
    index('rutas_activa_idx').on(t.activa),
    check('rutas_modo_check', enLista('modo', MODOS)),
    check('rutas_temporada_check', enLista('temporada', TEMPORADAS)),
    check('rutas_fuente_check', enLista('fuente', FUENTES_RUTA)),
    check('rutas_no_bucle_check', sql`origen_id <> destino_id`),
    check('rutas_minutos_check', sql`minutos is null or minutos > 0`),
    // Section 7.3: Google has no river data. A fluvial leg claiming fuente='google' means
    // someone fell back to a straight line, which is meaningless when the real path is
    // 90 minutes upriver.
    check(
      'rutas_fluvial_manual_check',
      sql`fuente <> 'google' or modo not in (${sql.raw(MODOS_FLUVIALES.map((m) => `'${m}'`).join(', '))})`,
    ),
    // Same shape as `envios_despacho_check`: the state that matters cannot be reached
    // without a person and a timestamp attached to it (2.1).
    check(
      'rutas_desactivacion_check',
      sql`activa or (desactivada_por is not null and desactivada_en is not null)`,
    ),
  ],
)

/**
 * The thin side of the marketplace: somebody actually travelling. Almost always the
 * binding constraint, which is why `SIN_CAPACIDAD` is its own bucket rather than a footnote
 * under "pending".
 */
export const capacidades = pgTable(
  'capacidades',
  {
    id: pk(),
    contactoId: uuid('contacto_id')
      .notNull()
      .references(() => contactos.id),
    modo: text('modo').notNull(),
    origenNodoId: uuid('origen_nodo_id')
      .notNull()
      .references(() => nodos.id),
    hastaComunidadId: uuid('hasta_comunidad_id')
      .notNull()
      .references(() => comunidades.id),
    saleEn: timestamp('sale_en', { withTimezone: true, mode: 'date' }).notNull(),
    cupoFamilias: integer('cupo_familias').notNull(),
    estado: text('estado').notNull().default('OFRECIDA'),
    notas: text('notas'),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('capacidades_estado_idx').on(t.estado),
    index('capacidades_sale_idx').on(t.saleEn),
    check('capacidades_modo_check', enLista('modo', MODOS)),
    check('capacidades_estado_check', enLista('estado', ESTADOS_CAPACIDAD)),
    check('capacidades_cupo_check', sql`cupo_familias > 0`),
  ],
)

/**
 * Non-negotiable 2.1: the matcher proposes, a human commits. A row here with
 * `confirmado_por IS NULL` is a proposal and nothing more — it has not moved stock, has not
 * committed a boat, and can be discarded freely. Under scarcity, matching decides who
 * waits; that decision needs a name attached.
 */
export const emparejamientos = pgTable(
  'emparejamientos',
  {
    id: pk(),
    pedidoId: uuid('pedido_id')
      .notNull()
      .references(() => pedidos.id, { onDelete: 'cascade' }),
    nodoId: uuid('nodo_id')
      .notNull()
      .references(() => nodos.id),
    capacidadId: uuid('capacidad_id').references(() => capacidades.id),
    /** Set when the goods come from an individual offer. FK declared in SQL (0011). */
    ofertaId: uuid('oferta_id'),
    cantidad: integer('cantidad').notNull(),
    propuestoEn: timestamp('propuesto_en', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    confirmadoPor: uuid('confirmado_por').references(() => usuarios.id),
    confirmadoEn: timestamp('confirmado_en', { withTimezone: true, mode: 'date' }),
    envioId: uuid('envio_id'),
  },
  (t) => [
    uniqueIndex('emparejamientos_pedido_capacidad_key').on(t.pedidoId, t.capacidadId),
    index('emparejamientos_pedido_idx').on(t.pedidoId),
    check('emparejamientos_cantidad_check', sql`cantidad > 0`),
    check(
      'emparejamientos_confirmacion_check',
      sql`(confirmado_por is null and confirmado_en is null)
          or (confirmado_por is not null and confirmado_en is not null)`,
    ),
    // A shipment cannot be attached to an unconfirmed proposal.
    check('emparejamientos_envio_check', sql`envio_id is null or confirmado_por is not null`),
  ],
)

export const envios = pgTable(
  'envios',
  {
    id: pk(),
    codigo: text('codigo').notNull(),
    modo: text('modo').notNull(),
    responsableId: uuid('responsable_id')
      .notNull()
      .references(() => contactos.id),
    origenNodoId: uuid('origen_nodo_id')
      .notNull()
      .references(() => nodos.id),
    salidaProgramada: timestamp('salida_programada', { withTimezone: true, mode: 'date' }),
    salidaReal: timestamp('salida_real', { withTimezone: true, mode: 'date' }),
    regresoReal: timestamp('regreso_real', { withTimezone: true, mode: 'date' }),
    cupoFamilias: integer('cupo_familias').notNull(),
    costoCombustibleCop: bigint('costo_combustible_cop', { mode: 'number' }),
    estado: text('estado').notNull().default('PLANEADO'),
    notas: text('notas'),
    /** Who pressed dispatch, and when (non-negotiable 2.1). */
    despachadoPor: uuid('despachado_por').references(() => usuarios.id),
    despachadoEn: timestamp('despachado_en', { withTimezone: true, mode: 'date' }),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    uniqueIndex('envios_codigo_key').on(t.codigo),
    index('envios_estado_idx').on(t.estado),
    check('envios_modo_check', enLista('modo', MODOS)),
    check('envios_estado_check', enLista('estado', ESTADOS_ENVIO)),
    check('envios_cupo_check', sql`cupo_familias > 0`),
    check(
      'envios_despacho_check',
      sql`estado = 'PLANEADO' or estado = 'CANCELADO' or despachado_por is not null`,
    ),
  ],
)

export const envioItems = pgTable(
  'envio_items',
  {
    id: pk(),
    envioId: uuid('envio_id')
      .notNull()
      .references(() => envios.id, { onDelete: 'cascade' }),
    pedidoId: uuid('pedido_id')
      .notNull()
      .references(() => pedidos.id),
    familiasAsignadas: integer('familias_asignadas').notNull(),
    ordenParada: integer('orden_parada').notNull().default(0),
  },
  (t) => [
    uniqueIndex('envio_items_key').on(t.envioId, t.pedidoId),
    check('envio_items_familias_check', sql`familias_asignadas > 0`),
  ],
)

/**
 * Section 9.7: the receiving leader reads back a 4-digit code by WhatsApp, SMS or phone.
 * The paper manifest signature is the offline fallback, reconciled later.
 */
export const entregas = pgTable(
  'entregas',
  {
    id: pk(),
    envioId: uuid('envio_id')
      .notNull()
      .references(() => envios.id, { onDelete: 'cascade' }),
    pedidoId: uuid('pedido_id')
      .notNull()
      .references(() => pedidos.id),
    codigoConfirmacion: char('codigo_confirmacion', { length: 4 }).notNull(),
    confirmado: boolean('confirmado').notNull().default(false),
    confirmadoPorId: uuid('confirmado_por_id').references(() => contactos.id),
    confirmadoCanal: text('confirmado_canal'),
    confirmadoEn: timestamp('confirmado_en', { withTimezone: true, mode: 'date' }),
    familiasAtendidas: integer('familias_atendidas'),
    observaciones: text('observaciones'),
    creadoEn: creadoEn(),
  },
  (t) => [
    uniqueIndex('entregas_envio_codigo_key').on(t.envioId, t.codigoConfirmacion),
    uniqueIndex('entregas_envio_pedido_key').on(t.envioId, t.pedidoId),
    check('entregas_codigo_check', sql`codigo_confirmacion ~ '^[0-9]{4}$'`),
    check(
      'entregas_canal_check',
      sql`confirmado_canal is null or ${enLista('confirmado_canal', CANALES)}`,
    ),
    check(
      'entregas_confirmacion_check',
      sql`not confirmado or (confirmado_en is not null and confirmado_canal is not null)`,
    ),
  ],
)

/**
 * Non-negotiable 2.9: when supply is insufficient, record which rule was applied, who
 * confirmed it, and which requests were deferred. A deferred community with nobody to argue
 * with is how the reporter network dies.
 */
export const decisionesAsignacion = pgTable(
  'decisiones_asignacion',
  {
    id: pk(),
    envioId: uuid('envio_id')
      .notNull()
      .references(() => envios.id, { onDelete: 'cascade' }),
    reglaAplicada: text('regla_aplicada').notNull(),
    confirmadoPor: uuid('confirmado_por')
      .notNull()
      .references(() => usuarios.id),
    confirmadoEn: timestamp('confirmado_en', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    pedidosAtendidos: jsonb('pedidos_atendidos').notNull().default(sql`'[]'::jsonb`),
    pedidosPostergados: jsonb('pedidos_postergados').notNull().default(sql`'[]'::jsonb`),
    nota: text('nota'),
  },
  (t) => [index('decisiones_envio_idx').on(t.envioId)],
)
