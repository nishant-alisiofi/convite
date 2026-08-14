import { sql } from 'drizzle-orm'
import {
  boolean,
  char,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, enLista, pk, punto } from './_shared'
import { catalogoItems } from './catalogo'
import { contactos } from './core'
import { capacidades, nodos } from './marketplace'
import {
  ESTADOS_OFERTA,
  ESTADOS_RECOGIDA,
  ESTADOS_VOLUNTARIO,
  FUENTES_UBICACION,
  TIPOS_LABOR,
} from './vocabulario'

/**
 * Supply held by individuals, as distinct from counted node stock.
 *
 * In the first week of a response this is where the goods actually are: private houses,
 * not warehouses. A matcher reading only `existencias` will report "nobody has this" on a
 * page that lists eight people who do — the single most consequential bug observed in a
 * live deployment, and why Section 8 forbids returning SIN_EXISTENCIA without checking here.
 */
export const ofertas = pgTable(
  'ofertas',
  {
    id: pk(),
    contactoId: uuid('contacto_id')
      .notNull()
      .references(() => contactos.id),
    /** Non-negotiable 2.12: never overwritten, whatever the classifier later decides. */
    textoOriginal: text('texto_original').notNull(),
    /** Null while unclassified — «Muchas cosas!! De todo!!!» is a phone call, not a guess. */
    codigoItem: char('codigo_item', { length: 2 }).references(() => catalogoItems.codigo),
    /** Null when the sender never stated one. «🍲 90» is not ninety of anything. */
    cantidad: integer('cantidad'),
    unidad: text('unidad'),
    confianza: numeric('confianza', { precision: 3, scale: 2 }),
    requiereAclaracion: boolean('requiere_aclaracion').notNull().default(false),
    ubicacion: punto('ubicacion'),
    /** Non-negotiable 2.16 — as sensitive as a community location. RLS, not UI, hides it. */
    direccionTexto: text('direccion_texto'),
    ubicacionFuente: text('ubicacion_fuente'),
    ubicacionPrecisionM: integer('ubicacion_precision_m'),
    perecedero: boolean('perecedero').notNull().default(false),
    venceEn: timestamp('vence_en', { withTimezone: true, mode: 'date' }),
    necesitaRecogida: boolean('necesita_recogida').notNull().default(true),
    estado: text('estado').notNull().default('SIN_CLASIFICAR'),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('ofertas_estado_item_idx').on(t.estado, t.codigoItem),
    index('ofertas_perecedero_idx')
      .on(t.venceEn)
      .where(sql`perecedero and estado = 'DISPONIBLE'`),
    index('ofertas_aclaracion_idx').on(t.creadoEn).where(sql`requiere_aclaracion`),
    check('ofertas_estado_check', enLista('estado', ESTADOS_OFERTA)),
    check('ofertas_cantidad_check', sql`cantidad is null or cantidad > 0`),
    check('ofertas_confianza_check', sql`confianza is null or confianza between 0 and 1`),
    check(
      'ofertas_clasificacion_check',
      sql`codigo_item is not null or estado in ('SIN_CLASIFICAR', 'RETIRADA')`,
    ),
    check('ofertas_perecedero_check', sql`not perecedero or vence_en is not null`),
    check(
      'ofertas_ubicacion_fuente_check',
      sql`ubicacion_fuente is null or ${enLista('ubicacion_fuente', FUENTES_UBICACION)}`,
    ),
    check(
      'ofertas_ubicacion_declarada_check',
      sql`(ubicacion is null and ubicacion_fuente is null)
          or (ubicacion is not null and ubicacion_fuente is not null and ubicacion_precision_m is not null)`,
    ),
  ],
)

/** Capacity that does not move: volunteers match to nodes, not to requests (Section 9.6). */
export const voluntarios = pgTable(
  'voluntarios',
  {
    id: pk(),
    contactoId: uuid('contacto_id')
      .notNull()
      .references(() => contactos.id),
    nodoId: uuid('nodo_id')
      .notNull()
      .references(() => nodos.id),
    tipoLabor: text('tipo_labor').notNull(),
    disponibleDesde: timestamp('disponible_desde', { withTimezone: true, mode: 'date' }).notNull(),
    disponibleHasta: timestamp('disponible_hasta', { withTimezone: true, mode: 'date' }).notNull(),
    estado: text('estado').notNull().default('OFRECIDO'),
    creadoEn: creadoEn(),
  },
  (t) => [
    index('voluntarios_nodo_idx').on(t.nodoId, t.disponibleDesde),
    check('voluntarios_labor_check', enLista('tipo_labor', TIPOS_LABOR)),
    check('voluntarios_estado_check', enLista('estado', ESTADOS_VOLUNTARIO)),
    check('voluntarios_ventana_check', sql`disponible_hasta > disponible_desde`),
  ],
)

/** First mile: scattered addresses collected into one node, over roads (Section 9.5). */
export const recogidas = pgTable(
  'recogidas',
  {
    id: pk(),
    ofertaId: uuid('oferta_id')
      .notNull()
      .references(() => ofertas.id, { onDelete: 'cascade' }),
    nodoDestinoId: uuid('nodo_destino_id')
      .notNull()
      .references(() => nodos.id),
    capacidadId: uuid('capacidad_id').references(() => capacidades.id),
    ordenParada: integer('orden_parada').notNull().default(0),
    estado: text('estado').notNull().default('PLANEADA'),
    recogidoEn: timestamp('recogido_en', { withTimezone: true, mode: 'date' }),
    creadoEn: creadoEn(),
  },
  (t) => [
    uniqueIndex('recogidas_oferta_key').on(t.ofertaId).where(sql`estado <> 'CANCELADA'`),
    check('recogidas_estado_check', enLista('estado', ESTADOS_RECOGIDA)),
    check('recogidas_recogida_check', sql`estado <> 'RECOGIDA' or recogido_en is not null`),
  ],
)
