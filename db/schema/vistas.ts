import { bigint, pgView, text } from 'drizzle-orm/pg-core'

/**
 * Non-negotiable 2.4: the public view is aggregated by design. Counts only — no
 * coordinates, no community names, no phone numbers, no household data. A live map of
 * vulnerable households next to transport schedules is targeting information in a
 * territory with armed actor presence.
 *
 * The view body lives in db/migrations/0019_mapa_publico_sin_agrupador.sql, which supersedes
 * the original in 0006. It is declared here as an existing view so application code can
 * query it through Drizzle; `anon` is granted SELECT on this and on nothing else
 * (db/migrations/0007_rls.sql).
 *
 * Grouped by municipality only. PRD decision D6 removed `agrupador`: a sub-municipal
 * grouping narrows a count to a stretch of river with a handful of settlements on it, which
 * is the thing 2.4 exists to prevent.
 */
export const mapaPublico = pgView('mapa_publico', {
  municipio: text('municipio').notNull(),
  familiaLabel: text('familia_label').notNull(),
  pendientes: bigint('pendientes', { mode: 'number' }).notNull(),
  atendidos: bigint('atendidos', { mode: 'number' }).notNull(),
}).existing()
