import { sql } from 'drizzle-orm'
import { geometry, timestamp, uuid } from 'drizzle-orm/pg-core'

/** Primary key used everywhere except `usuarios`, whose id is the Supabase auth uid. */
export const pk = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`)

export const creadoEn = () =>
  timestamp('creado_en', { withTimezone: true, mode: 'date' }).notNull().defaultNow()

export const actualizadoEn = () =>
  timestamp('actualizado_en', { withTimezone: true, mode: 'date' }).notNull().defaultNow()

/**
 * WGS84 point. Stored as geometry(Point,4326) so PostGIS distance/containment work.
 * Never populate one of these without also setting the matching `ubicacion_fuente`
 * and `ubicacion_precision_m` (non-negotiable 2.2).
 */
export const punto = (name: string) => geometry(name, { type: 'point', mode: 'xy', srid: 4326 })

/** `check` helper: value must be one of a controlled vocabulary. */
export const enLista = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`)
