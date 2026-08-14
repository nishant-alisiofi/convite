import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, enLista, pk } from './_shared'
import { usuarios } from './core'
import { ESTADOS_JOB, TEMPORADAS_OPERATIVAS } from './vocabulario'

/**
 * Section 3: the job queue is a table plus a worker route invoked by cron. No Redis, no
 * BullMQ in v1. Webhooks return 200 first and enqueue here (non-negotiable 2.7); the
 * matcher runs from here rather than inline in a request (Section 8).
 */
export const jobs = pgTable(
  'jobs',
  {
    id: pk(),
    tipo: text('tipo').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    estado: text('estado').notNull().default('pendiente'),
    intentos: integer('intentos').notNull().default(0),
    maxIntentos: integer('max_intentos').notNull().default(5),
    correrEn: timestamp('correr_en', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    /** Set while a worker holds the row, so a second worker skips it. */
    tomadoEn: timestamp('tomado_en', { withTimezone: true, mode: 'date' }),
    ultimoError: text('ultimo_error'),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('jobs_pendientes_idx').on(t.estado, t.correrEn),
    check('jobs_estado_check', enLista('estado', ESTADOS_JOB)),
  ],
)

/**
 * Section 11: log every mutation. Together with the `*_por` / `*_en` columns on the
 * domain tables this is what makes non-negotiable 2.1 auditable rather than aspirational.
 */
export const auditoria = pgTable(
  'auditoria',
  {
    id: pk(),
    actorId: uuid('actor_id').references(() => usuarios.id),
    accion: text('accion').notNull(),
    entidad: text('entidad').notNull(),
    entidadId: uuid('entidad_id'),
    antes: jsonb('antes'),
    despues: jsonb('despues'),
    creadoEn: creadoEn(),
  },
  (t) => [
    index('auditoria_entidad_idx').on(t.entidad, t.entidadId),
    index('auditoria_creado_idx').on(t.creadoEn),
  ],
)

/**
 * Settings a coordinator changes without a deploy.
 *
 * `temporada` is the one that matters today, and it is here rather than in the environment
 * because getting it wrong raises no error: `rutas.temporada` filters the reachability
 * graph, so the wrong season silently removes communities from every plan. Winandó has no
 * row at all in `seca`. A value with that reach needs a name attached to each change, which
 * is what the `auditar_configuracion()` trigger writes into `auditoria`.
 *
 * Read through `lib/temporada.ts`, which falls back to `CONVITE_TEMPORADA` when the row is
 * missing — a fresh clone still runs before anybody has opened the admin screen.
 */
export const configuracion = pgTable(
  'configuracion',
  {
    clave: text('clave').primaryKey(),
    valor: text('valor').notNull(),
    descripcion: text('descripcion'),
    /** Null only for the values the migration seeded. Every later write carries a person. */
    actualizadoPor: uuid('actualizado_por').references(() => usuarios.id),
    actualizadoEn: actualizadoEn(),
    creadoEn: creadoEn(),
  },
  () => [
    // A controlled vocabulary per key. Code branches on this value, so an unrecognised one
    // would fall through to a default and look like a working system with a wrong answer.
    check(
      'configuracion_temporada_check',
      sql`clave <> 'temporada' or ${enLista('valor', TEMPORADAS_OPERATIVAS)}`,
    ),
  ],
)
