import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, enLista, pk } from './_shared'
import { ESTADOS_APADRINAMIENTO, RECURRENCIAS_APADRINAMIENTO, TIPOS_PADRINO } from './apadrinamiento'
import { comunidades, organizaciones, usuarios } from './core'
import { jornadas } from './territorio'

/**
 * PRD-31 (§21b) — the funded layer above jornadas.
 *
 * A jornada (PRD-30 / §22) is one occurrence. What an organisation *plans and funds* is a
 * programa: an objective, a target population, a cadence, a budget and a financiador, realised
 * by a set of jornadas over months. ASOREDIPARCHOCÓ's «plan de respuesta a 12 meses» and
 * Herencia's «Timbiquí Suena» are programas; an emergency shipment is neither, so a programa is
 * *not* the container in the navigation — it lives inside Agenda (§18).
 *
 * The jornada tables (jornadas / jornada_paradas) already exist (PRD-37, migration 0043). This
 * file only adds the layer above them: `jornadas.programa_id` is a plain uuid declared in
 * territorio.ts with the FK in migration 0045 (the same one-way-import trick comunidades.region_id
 * uses), so this module can import `jornadas` for its own FKs without a cycle.
 *
 * Everything is org-scoped like every operational table; the RLS floor, the audit trigger and the
 * `tocar` trigger live in db/migrations/0045_programas.sql, which drizzle-kit does not generate.
 * `pnpm db:check` diffs the two so the columns stay in step. COP is plain `bigint`; pg returns it
 * as a string, so the lib row-mappers convert with `Number()` (COP is far inside safe-integer).
 */

/**
 * §21b.1 Cadencia: how often the programa's jornadas recur. `semanal` is the «twelve weekly
 * sessions» of a formación; `unico` is a one-off. Text + check so a new rhythm is a one-line
 * ALTER, mirroring §5's vocabulary discipline.
 */
export const CADENCIAS_PROGRAMA = ['mensual', 'semanal', 'trimestral', 'unico'] as const

/**
 * A programa's lifecycle. `borrador` while it is being planned over the map (§21b.5), `activo`
 * once it is committed; the rest are terminal. Retired by state, never deleted — a funder report
 * has to survive a cancelled programa.
 */
export const ESTADOS_PROGRAMA = ['borrador', 'activo', 'pausado', 'completado', 'cancelado'] as const

export type CadenciaPrograma = (typeof CADENCIAS_PROGRAMA)[number]
export type EstadoPrograma = (typeof ESTADOS_PROGRAMA)[number]

/**
 * The programa itself (§21b.1). Objetivo · población objetivo · cadencia · duración · presupuesto
 * · financiador. Indicadores (coverage, attendance, delivery, completion) are *computed* from the
 * jornadas, the roster and the ledger — not stored — so they can never drift from the facts.
 */
export const programas = pgTable(
  'programas',
  {
    id: pk(),
    codigo: text('codigo').notNull(),
    /** Org-scoped like every operational table (0017 / 0030 / 0041). RLS binds reads/writes. */
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    titulo: text('titulo').notNull(),
    /** §21b.1: what change is intended, in one sentence. */
    objetivo: text('objetivo').notNull(),
    /** Free-text criteria («familias con partera», etc.). The *which communities* is the join
     * table below; this is the «how many families, on what criteria» half. */
    poblacionObjetivo: text('poblacion_objetivo'),
    familiasObjetivo: integer('familias_objetivo'),
    cadencia: text('cadencia').notNull(),
    fechaInicio: date('fecha_inicio'),
    fechaFin: date('fecha_fin'),
    /** §21b.1 Duración: whether the plan renews at the end of its window. */
    renueva: boolean('renueva').notNull().default(false),
    estado: text('estado').notNull().default('borrador'),
    /** §21b.1 Presupuesto: committed COP for the programa. Applied is summed off the ledger. */
    presupuestoComprometidoCop: bigint('presupuesto_comprometido_cop', { mode: 'number' })
      .notNull()
      .default(0),
    /** §21b.1 Financiador: who funds it, and what they need reported. */
    financiador: text('financiador'),
    financiadorReporte: text('financiador_reporte'),
    notas: text('notas'),
    /** Who created it (2.1). Signed against auth.uid() by the RLS insert policy. */
    creadoPor: uuid('creado_por').references(() => usuarios.id),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    uniqueIndex('programas_codigo_key').on(t.codigo),
    index('programas_organizacion_idx').on(t.organizacionId),
    index('programas_estado_idx').on(t.estado),
    check('programas_cadencia_check', enLista('cadencia', CADENCIAS_PROGRAMA)),
    check('programas_estado_check', enLista('estado', ESTADOS_PROGRAMA)),
    check('programas_familias_check', sql`familias_objetivo is null or familias_objetivo >= 0`),
    check('programas_presupuesto_check', sql`presupuesto_comprometido_cop >= 0`),
    check(
      'programas_fechas_check',
      sql`fecha_fin is null or fecha_inicio is null or fecha_fin >= fecha_inicio`,
    ),
  ],
)

/**
 * §21b.1 «Población objetivo» / §21b.2 the feasibility input: which communities the programa
 * targets, and the families it estimates in each. The seasonal-feasibility calendar reads this
 * set and asks, per month, which of these communities is actually reachable and at what cost.
 * Cascades with its programa; comunidad_id is a plain reference so removing a programa never
 * reaches into the shared registry.
 */
export const programaComunidades = pgTable(
  'programa_comunidades',
  {
    id: pk(),
    programaId: uuid('programa_id')
      .notNull()
      .references(() => programas.id, { onDelete: 'cascade' }),
    comunidadId: uuid('comunidad_id')
      .notNull()
      .references(() => comunidades.id),
    familiasEstimadas: integer('familias_estimadas'),
    creadoEn: creadoEn(),
  },
  (t) => [
    uniqueIndex('programa_comunidades_par_key').on(t.programaId, t.comunidadId),
    index('programa_comunidades_programa_idx').on(t.programaId),
    index('programa_comunidades_comunidad_idx').on(t.comunidadId),
    check(
      'programa_comunidades_familias_check',
      sql`familias_estimadas is null or familias_estimadas >= 0`,
    ),
  ],
)

/**
 * §21b.3 Persistent roster: a `taller`/`formacion` programa carries the *same* participants
 * across its sessions — the first thing in Convite that tracks the same people across events.
 * `completado` is completion per cohort.
 *
 * The §22 rule binds hard: **record that someone attended, never what for.** There is deliberately
 * no «necesidad», «motivo» or «diagnóstico» column here — a roster is a list of names and sessions,
 * not a record of what anyone needed.
 */
export const programaParticipantes = pgTable(
  'programa_participantes',
  {
    id: pk(),
    programaId: uuid('programa_id')
      .notNull()
      .references(() => programas.id, { onDelete: 'cascade' }),
    nombre: text('nombre').notNull(),
    contacto: text('contacto'),
    completado: boolean('completado').notNull().default(false),
    completadoEn: timestamp('completado_en', { withTimezone: true, mode: 'date' }),
    notas: text('notas'),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('programa_participantes_programa_idx').on(t.programaId),
    // A completion flag without a date is not a completion record (same shape as 2.1 elsewhere).
    check(
      'programa_participantes_completado_check',
      sql`completado = false or completado_en is not null`,
    ),
  ],
)

/**
 * §21b.3 Attendance, per session. A session *is* a jornada, so attendance ties a participante to
 * a jornada — and records only **that** they attended (§22), never what for. One row per
 * participante per jornada.
 */
export const programaAsistencias = pgTable(
  'programa_asistencias',
  {
    id: pk(),
    participanteId: uuid('participante_id')
      .notNull()
      .references(() => programaParticipantes.id, { onDelete: 'cascade' }),
    jornadaId: uuid('jornada_id')
      .notNull()
      .references(() => jornadas.id, { onDelete: 'cascade' }),
    asistio: boolean('asistio').notNull().default(true),
    creadoEn: creadoEn(),
  },
  (t) => [
    uniqueIndex('programa_asistencias_par_key').on(t.participanteId, t.jornadaId),
    index('programa_asistencias_participante_idx').on(t.participanteId),
    index('programa_asistencias_jornada_idx').on(t.jornadaId),
  ],
)

/**
 * §21b.4 Programa-level sponsorship: an apadrinamiento can fund a **programa** — «financia el banco
 * de medicamentos por seis meses» — not just a beneficiary. Same consent posture as PRD-12: the
 * sponsor is only ever shown `etiqueta` (a label) and the programa, never a partera's name. Kept
 * as its own table so PRD-12's `apadrinamientos` is untouched; programa totals mirror Apadrinar's
 * comprometido · aplicado · disponible, summed here and off the ledger below.
 */
export const programaApadrinamientos = pgTable(
  'programa_apadrinamientos',
  {
    id: pk(),
    programaId: uuid('programa_id')
      .notNull()
      .references(() => programas.id, { onDelete: 'cascade' }),
    /** The label the sponsor sees — «el banco de medicamentos», never a real name (Ley 1581). */
    etiqueta: text('etiqueta').notNull(),
    padrinoNombre: text('padrino_nombre').notNull(),
    padrinoContacto: text('padrino_contacto'),
    padrinoTipo: text('padrino_tipo').notNull().default('individuo'),
    montoCop: bigint('monto_cop', { mode: 'number' }).notNull(),
    recurrencia: text('recurrencia').notNull().default('unico'),
    estado: text('estado').notNull().default('activo'),
    consentimiento: boolean('consentimiento').notNull().default(false),
    consentimientoEn: timestamp('consentimiento_en', { withTimezone: true, mode: 'date' }),
    creadoPor: uuid('creado_por').references(() => usuarios.id),
    notas: text('notas'),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('programa_apadrinamientos_programa_idx').on(t.programaId),
    index('programa_apadrinamientos_estado_idx').on(t.estado),
    check('programa_apadrinamientos_monto_check', sql`monto_cop > 0`),
    check('programa_apadrinamientos_tipo_check', enLista('padrino_tipo', TIPOS_PADRINO)),
    check(
      'programa_apadrinamientos_recurrencia_check',
      enLista('recurrencia', RECURRENCIAS_APADRINAMIENTO),
    ),
    check('programa_apadrinamientos_estado_check', enLista('estado', ESTADOS_APADRINAMIENTO)),
    // A consent flag without a timestamp is not a consent record (same shape as PRD-12).
    check(
      'programa_apadrinamientos_consent_check',
      sql`consentimiento = false or consentimiento_en is not null`,
    ),
  ],
)

/**
 * §21b.1/§21b.4 the spend ledger: how much of a programa's budget has been applied, and to what.
 * `aplicado` (AC2) is the sum over this table; `restante` is the committed budget minus it. An
 * application may name the sponsorship whose money it draws (`apadrinamiento_id`, AC5) and/or the
 * jornada it paid for (`jornada_id`). Append-only and immutable, mirroring
 * `apadrinamiento_asignaciones` — a funding decision, once recorded, is not edited or deleted.
 */
export const programaAplicaciones = pgTable(
  'programa_aplicaciones',
  {
    id: pk(),
    programaId: uuid('programa_id')
      .notNull()
      .references(() => programas.id, { onDelete: 'cascade' }),
    apadrinamientoId: uuid('apadrinamiento_id').references(() => programaApadrinamientos.id),
    jornadaId: uuid('jornada_id').references(() => jornadas.id),
    montoAplicadoCop: bigint('monto_aplicado_cop', { mode: 'number' }).notNull(),
    concepto: text('concepto'),
    /** Who applied it (2.1). Signed against auth.uid() by the RLS insert policy. */
    aplicadoPor: uuid('aplicado_por').references(() => usuarios.id),
    creadoEn: creadoEn(),
  },
  (t) => [
    index('programa_aplicaciones_programa_idx').on(t.programaId),
    index('programa_aplicaciones_apadrinamiento_idx').on(t.apadrinamientoId),
    index('programa_aplicaciones_jornada_idx').on(t.jornadaId),
    check('programa_aplicaciones_monto_check', sql`monto_aplicado_cop > 0`),
  ],
)
