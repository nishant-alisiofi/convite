import { bigint, pgView, text } from 'drizzle-orm/pg-core'

/**
 * Non-negotiable 2.4: the public view is aggregated by design. Counts only — no
 * coordinates, no community names, no phone numbers, no household data. A live map of
 * vulnerable households next to transport schedules is targeting information in a
 * territory with armed actor presence.
 *
 * The view body lives in db/migrations/0006_mapa_publico.sql. It is declared here as an
 * existing view so application code can query it through Drizzle; `anon` is granted SELECT
 * on this and on nothing else (db/migrations/0007_rls.sql).
 */
export const mapaPublico = pgView('mapa_publico', {
  municipio: text('municipio').notNull(),
  agrupador: text('agrupador'),
  familiaLabel: text('familia_label').notNull(),
  pendientes: bigint('pendientes', { mode: 'number' }).notNull(),
  atendidos: bigint('atendidos', { mode: 'number' }).notNull(),
}).existing()
