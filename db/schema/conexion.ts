import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, enLista, pk, punto } from './_shared'
import { comunidades, organizaciones } from './core'
import { FUENTES_UBICACION } from './vocabulario'

/**
 * §5.9 — Connection points (puntos de conexión).
 *
 * The place a person from a low- or no-signal community walks to in order to send a report
 * or receive an answer: a shop with a phone, a pier where the boats pass, a health post, a
 * community WiFi mast. Communities hold this knowledge in detail — where signal is, where it
 * works best, where a pin can be bought, where it is safe to *stay* for the length of a call
 * — and none of it is on an operator's coverage map.
 *
 * These are recorded SEPARATELY from supply nodes (`nodos`), on purpose and permanently. The
 * vision is explicit (§5.9): connectivity commerce is acceptable, goods commerce is not, and
 * whoever decides who receives donated goods must not also be the one selling connection to
 * the same people. One person may run both a `nodo` and a `punto_conexion`, but they are two
 * rows in two tables so that convergence is always visible — never a single merged record.
 *
 * A connection point is NOT judged by bandwidth. What matters is whether it is safe, whether
 * it is private (weighted most where the subject is health), whether one can stay, whether it
 * can be reached, whether there is power, and what it costs. Those six judgements are the
 * columns below. Reaching a point can itself cost travel, money and risk — an activity meant
 * to avoid a journey can require a journey first — so `notas` carries that honesty and the
 * "where can I go" surface states it plainly.
 */

/** How well a connection point does on a judged dimension. Not bandwidth — see the six columns. */
export const NIVELES_CONEXION = ['alto', 'medio', 'bajo', 'desconocido'] as const

/** What it costs to use a connection point. `gratuito` is free; `desconocido` is not yet asked. */
export const COSTOS_CONEXION = ['gratuito', 'bajo', 'medio', 'alto', 'desconocido'] as const

/** The physical shape of a point. `muelle` = pier, `tienda` = shop, `puesto_salud` = health post. */
export const TIPOS_PUNTO_CONEXION = [
  'tienda',
  'muelle',
  'puesto_salud',
  'punto_wifi',
  'antena',
  'vivienda',
  'otro',
] as const

export type NivelConexion = (typeof NIVELES_CONEXION)[number]
export type CostoConexion = (typeof COSTOS_CONEXION)[number]
export type TipoPuntoConexion = (typeof TIPOS_PUNTO_CONEXION)[number]

export const puntosConexion = pgTable(
  'puntos_conexion',
  {
    id: pk(),
    /**
     * The owning organisation. A direct column (like `usuarios`) rather than reached through a
     * community, because a connection point is often *outside* every community it serves — it is
     * the place people travel to, not a place they live. RLS scopes read and write to this.
     */
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    nombre: text('nombre').notNull(),
    tipo: text('tipo').notNull().default('otro'),

    // Where it is, on the same footing as every other located row (non-negotiable 2.2): a
    // point only exists on the map together with the source and precision of that point. A
    // NULL location is allowed — a point can be known by name before anyone pins it.
    ubicacion: punto('ubicacion'),
    ubicacionFuente: text('ubicacion_fuente'),
    ubicacionPrecisionM: integer('ubicacion_precision_m'),

    // ── Characteristics: what it is, not how good it is ────────────────────────────────────
    /** There is mobile signal here. The reason it is a connection point at all — but not the judge. */
    tieneSenal: boolean('tiene_senal').notNull().default(false),
    /** Community or private internet (a mesh, a satellite terminal, a paid WiFi) is available. */
    internetDisponible: boolean('internet_disponible').notNull().default(false),
    /** Saldo / data / pines can be bought here. §5.9: the scarcity has moved to connection. */
    vendePines: boolean('vende_pines').notNull().default(false),
    /** Someone runs it — a shopkeeper, an operator. `false` for an unstaffed mast or pier. */
    atendido: boolean('atendido').notNull().default(false),

    // ── The six judgements (§5.9): a point is judged by these, never by bandwidth ───────────
    /** Safety: is it safe to be here, and safe to be seen coming here. */
    seguridad: text('seguridad').notNull().default('desconocido'),
    /**
     * Privacy: can a call be made without being overheard. Weighted most heavily where the
     * subject is health — a maternal-health report made in earshot of a shop counter is a very
     * different thing from one made alone.
     */
    privacidad: text('privacidad').notNull().default('desconocido'),
    /** Whether one can *stay* for the length of a call, rather than pass through in a hurry. */
    permanencia: text('permanencia').notNull().default('desconocido'),
    /** Accessibility: how hard it is to reach — the road, the river, the walk. */
    accesibilidad: text('accesibilidad').notNull().default('desconocido'),
    /** Available power: can a phone be charged / kept alive for the call. */
    energia: text('energia').notNull().default('desconocido'),
    /** Cost: what using it costs the person. `gratuito` is free. */
    costo: text('costo').notNull().default('desconocido'),

    /**
     * The honest note. Reaching a point can cost travel, money and risk; this is where that is
     * written down for the coordinator reading "where can I go" — "2h en lancha", "solo en
     * marea alta", "el dueño cobra por llamada".
     */
    notas: text('notas'),

    activo: boolean('activo').notNull().default(true),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    uniqueIndex('puntos_conexion_org_nombre_key').on(t.organizacionId, t.nombre),
    index('puntos_conexion_org_idx').on(t.organizacionId),
    check('puntos_conexion_tipo_check', enLista('tipo', TIPOS_PUNTO_CONEXION)),
    check('puntos_conexion_seguridad_check', enLista('seguridad', NIVELES_CONEXION)),
    check('puntos_conexion_privacidad_check', enLista('privacidad', NIVELES_CONEXION)),
    check('puntos_conexion_permanencia_check', enLista('permanencia', NIVELES_CONEXION)),
    check('puntos_conexion_accesibilidad_check', enLista('accesibilidad', NIVELES_CONEXION)),
    check('puntos_conexion_energia_check', enLista('energia', NIVELES_CONEXION)),
    check('puntos_conexion_costo_check', enLista('costo', COSTOS_CONEXION)),
    // Same rule as `nodos`: a stored point must declare its source and precision, and a row
    // with no point declares neither. Non-negotiable 2.2 — no silent precision.
    check(
      'puntos_conexion_ubicacion_declarada_check',
      sql`(ubicacion is null and ubicacion_fuente is null)
          or (ubicacion is not null and ubicacion_fuente is not null and ubicacion_precision_m is not null)`,
    ),
    check(
      'puntos_conexion_ubicacion_fuente_check',
      sql`ubicacion_fuente is null or ${enLista('ubicacion_fuente', FUENTES_UBICACION)}`,
    ),
  ],
)

/**
 * Which communities a connection point serves. Many-to-many: one pier serves several riverside
 * settlements, and a community may reach signal through more than one point. This is the "where
 * can I go" join — given a community, its points; given a point, the communities it answers for.
 */
export const puntosConexionComunidades = pgTable(
  'puntos_conexion_comunidades',
  {
    puntoId: uuid('punto_id')
      .notNull()
      .references(() => puntosConexion.id, { onDelete: 'cascade' }),
    comunidadId: uuid('comunidad_id')
      .notNull()
      .references(() => comunidades.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('puntos_conexion_comunidades_key').on(t.puntoId, t.comunidadId),
    index('puntos_conexion_comunidades_comunidad_idx').on(t.comunidadId),
  ],
)
