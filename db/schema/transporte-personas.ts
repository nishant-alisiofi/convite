import { sql } from 'drizzle-orm'
import {
  boolean,
  char,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, enLista, pk } from './_shared'
import { comunidades, organizaciones, usuarios } from './core'
import { reportes } from './intake'
import { capacidades } from './marketplace'

/**
 * PRD-8 — Transport of PEOPLE, not only goods (PRD v3 §25).
 *
 * The three-sided marketplace already moves supplies. This adds the distinct case of moving a
 * person: a partera out for surgery or a specialist, a patient to a health post, a community
 * member to a connection point. The record carries a *person*, not a quantity — but the match is
 * the same one the goods engine already makes: a person who needs to reach care is demand, and a
 * boat/road/plane going that way with a free seat is capacity. So the matcher reuses the capacity
 * path (`lib/traslados/emparejador.ts` over `capacidades` + the route `Grafo`), rather than a
 * second copy of the route logic. What differs is the unit — seats and a time window instead of
 * weight — and the privacy posture — a named person's travel is PII.
 *
 * §25 also names what a trip out of the basin actually costs: river, road, sometimes air, plus
 * **lodging, food, accompaniment and a RETURN leg**. Those are part of the unit, so they are
 * columns here, not an afterthought — «human accompaniment is part of the system, not a shortfall
 * of it» (principle 10).
 *
 * Privacy (Ley 1581, mirroring the public-view discipline in 0027 and the label discipline in
 * 0041): `persona_etiqueta` is the aggregated, safe label; `persona_nombre`, `persona_telefono`
 * and `motivo_detalle` are PII/health data, reachable only through the RLS floor (0048) and never
 * added to `mapa_publico`. The Drizzle mirror below is the typed surface; the RLS floor, the audit
 * trigger and the `tocar` trigger live in db/migrations/0048_transporte_de_personas.sql, which
 * drizzle-kit does not generate. `pnpm db:check` diffs the two so the columns stay in step.
 */

/**
 * Why a person is travelling. A category, never a diagnosis — the clinical detail, when there is
 * any, goes in `motivo_detalle` behind the RLS floor. Text + check so a new reason is a one-line
 * ALTER (Section 5), with `otro` so intake never has to reject a real trip to record it.
 */
export const MOTIVOS_TRASLADO = [
  'parto',
  'cirugia',
  'especialista',
  'urgencia',
  'control',
  'acompanamiento',
  'otro',
] as const

/**
 * The lifecycle of a person-transport request. It reuses the goods vocabulary where the shape is
 * identical (`SIN_RUTA`/`SIN_CAPACIDAD`/`LISTO`) and adds what only a person needs: a human
 * dispatch (2.1), a confirmed arrival by 4-digit code, and — when §25 applies — a RETURN leg with
 * its own dispatch and its own arrival code. Anything past `LISTO` cannot exist without a person
 * having pressed dispatch, the same invariant `envios` holds.
 */
export const ESTADOS_TRASLADO = [
  'SOLICITADO', // created via a channel, not yet run through the matcher
  'SIN_RUTA', // no path from origin to destination this season
  'SIN_CAPACIDAD', // reachable, but nobody with a free seat is going in the window
  'LISTO', // a going-that-way vehicle is proposed; awaiting a human dispatch
  'DESPACHADO', // a person allocated the seat and a manifest was produced (outbound)
  'EN_CAMINO', // outbound underway
  'LLEGO', // outbound arrival confirmed by the 4-digit code
  'REGRESO_DESPACHADO', // the return leg has been dispatched
  'REGRESADO', // return arrival confirmed — the person is home
  'CERRADO', // nothing left to do
  'CANCELADO',
] as const

export type MotivoTraslado = (typeof MOTIVOS_TRASLADO)[number]
export type EstadoTraslado = (typeof ESTADOS_TRASLADO)[number]

/** States a coordinator still acts on — the buckets a board would show as pending. */
export const ESTADOS_TRASLADO_PENDIENTE: readonly EstadoTraslado[] = [
  'SOLICITADO',
  'SIN_RUTA',
  'SIN_CAPACIDAD',
  'LISTO',
  'DESPACHADO',
  'EN_CAMINO',
  'REGRESO_DESPACHADO',
]

export const trasladosPersona = pgTable(
  'traslados_persona',
  {
    id: pk(),
    /** Org-scoped like every operational table (0017 / 0030). RLS binds reads/writes to it. */
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    /**
     * The intake record this came from, when it arrived through a channel (AC #1). NULL when a
     * coordinator entered it directly on the panel.
     */
    reporteId: uuid('reporte_id').references(() => reportes.id),

    // ── Who travels (PII posture) ─────────────────────────────────────────────────────────
    /**
     * The privacy-safe label — «Partera del Atrato medio». Required, so no screen has to fall
     * back to the real name to have something to show (same discipline as `beneficiario_etiqueta`).
     */
    personaEtiqueta: text('persona_etiqueta').notNull(),
    /** The named person. PII: readable only behind the RLS floor, never in the public view. */
    personaNombre: text('persona_nombre'),
    personaTelefono: text('persona_telefono'),
    /** Seats needed: the person plus anyone accompanying them. The matcher's `cupo` analogue. */
    personas: integer('personas').notNull().default(1),
    /** Why they travel — a category (see MOTIVOS_TRASLADO), never a diagnosis. */
    motivoCategoria: text('motivo_categoria').notNull(),
    /** Optional clinical/context note. Sensitive: behind the RLS floor like the name. */
    motivoDetalle: text('motivo_detalle'),
    necesidadAccesibilidad: text('necesidad_accesibilidad'),

    // ── The trip ──────────────────────────────────────────────────────────────────────────
    origenComunidadId: uuid('origen_comunidad_id')
      .notNull()
      .references(() => comunidades.id),
    destinoComunidadId: uuid('destino_comunidad_id')
      .notNull()
      .references(() => comunidades.id),
    /** The outbound window: earliest and latest a departure still serves this person. */
    ventanaDesde: timestamp('ventana_desde', { withTimezone: true, mode: 'date' }).notNull(),
    ventanaHasta: timestamp('ventana_hasta', { withTimezone: true, mode: 'date' }).notNull(),

    // ── What §25 says the trip actually needs ─────────────────────────────────────────────
    requiereAlojamiento: boolean('requiere_alojamiento').notNull().default(false),
    requiereAlimentacion: boolean('requiere_alimentacion').notNull().default(false),
    requiereAcompanamiento: boolean('requiere_acompanamiento').notNull().default(false),
    /** The RETURN leg — the half a goods shipment never has. §25. */
    requiereRegreso: boolean('requiere_regreso').notNull().default(false),
    regresoVentanaDesde: timestamp('regreso_ventana_desde', { withTimezone: true, mode: 'date' }),
    regresoVentanaHasta: timestamp('regreso_ventana_hasta', { withTimezone: true, mode: 'date' }),

    // ── State + the matcher's proposal ────────────────────────────────────────────────────
    estado: text('estado').notNull().default('SOLICITADO'),
    motivo: text('motivo'),
    /**
     * The outbound vehicle the matcher proposed / a human confirmed (2.1). A proposal is a row
     * with `despachado_por IS NULL`; it has committed no seat.
     */
    capacidadId: uuid('capacidad_id').references(() => capacidades.id),
    /** Same for the return leg, when there is one. */
    regresoCapacidadId: uuid('regreso_capacidad_id').references(() => capacidades.id),

    // ── The human dispatch + arrival confirmation (outbound) ──────────────────────────────
    /** Who allocated the seat, and when (non-negotiable 2.1). */
    despachadoPor: uuid('despachado_por').references(() => usuarios.id),
    despachadoEn: timestamp('despachado_en', { withTimezone: true, mode: 'date' }),
    /** 4-digit code the receiving end reads back to confirm arrival (§9.7 shape). */
    codigoLlegada: char('codigo_llegada', { length: 4 }),
    llegadaConfirmadaEn: timestamp('llegada_confirmada_en', { withTimezone: true, mode: 'date' }),
    llegadaConfirmadaCanal: text('llegada_confirmada_canal'),

    // ── The human dispatch + arrival confirmation (return) ────────────────────────────────
    regresoDespachadoPor: uuid('regreso_despachado_por').references(() => usuarios.id),
    regresoDespachadoEn: timestamp('regreso_despachado_en', { withTimezone: true, mode: 'date' }),
    codigoRegreso: char('codigo_regreso', { length: 4 }),
    regresoConfirmadoEn: timestamp('regreso_confirmado_en', { withTimezone: true, mode: 'date' }),

    creadoPor: uuid('creado_por').references(() => usuarios.id),
    notas: text('notas'),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('traslados_persona_organizacion_idx').on(t.organizacionId),
    index('traslados_persona_estado_idx').on(t.estado),
    index('traslados_persona_origen_idx').on(t.origenComunidadId),
    index('traslados_persona_destino_idx').on(t.destinoComunidadId),
    check('traslados_persona_estado_check', enLista('estado', ESTADOS_TRASLADO)),
    check('traslados_persona_motivo_check', enLista('motivo_categoria', MOTIVOS_TRASLADO)),
    check('traslados_persona_personas_check', sql`personas > 0`),
    check('traslados_persona_no_bucle_check', sql`origen_comunidad_id <> destino_comunidad_id`),
    check('traslados_persona_ventana_check', sql`ventana_hasta >= ventana_desde`),
    // A return leg is not a real plan without a window to travel back in (§25).
    check(
      'traslados_persona_regreso_ventana_check',
      sql`not requiere_regreso
          or (regreso_ventana_desde is not null and regreso_ventana_hasta is not null
              and regreso_ventana_hasta >= regreso_ventana_desde)`,
    ),
    // Same shape as `envios_despacho_check`: nothing past LISTO exists without a person and a
    // timestamp attached to the decision (2.1).
    check(
      'traslados_persona_despacho_check',
      sql`estado in ('SOLICITADO', 'SIN_RUTA', 'SIN_CAPACIDAD', 'LISTO', 'CANCELADO')
          or (despachado_por is not null and despachado_en is not null)`,
    ),
    // A return can only be dispatched for a trip that asked for one.
    check(
      'traslados_persona_regreso_pedido_check',
      sql`regreso_despachado_por is null or requiere_regreso`,
    ),
    check('traslados_persona_codigo_llegada_check', sql`codigo_llegada is null or codigo_llegada ~ '^[0-9]{4}$'`),
    check('traslados_persona_codigo_regreso_check', sql`codigo_regreso is null or codigo_regreso ~ '^[0-9]{4}$'`),
    // An arrival cannot be confirmed without the code it is confirmed against.
    check(
      'traslados_persona_llegada_check',
      sql`llegada_confirmada_en is null or codigo_llegada is not null`,
    ),
    check(
      'traslados_persona_regreso_llegada_check',
      sql`regreso_confirmado_en is null or codigo_regreso is not null`,
    ),
  ],
)
