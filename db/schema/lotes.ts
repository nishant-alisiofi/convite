import { sql } from 'drizzle-orm'
import { check, date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, pk } from './_shared'
import { usuarios } from './core'
import { existencias } from './marketplace'

/**
 * FR-43 — expiry tracking for perishable lots of counted node stock (§24 adjacent, PRD v3).
 *
 * `existencias` is one row per (nodo, item): a single running count, never a batch. A
 * shipment of chronic medication and last month's leftover batch are the same `existencias`
 * row today, and neither carries a date. In a basin where a shipment can sit days waiting on
 * a boat, the coordinator needs to see what is closest to spoiling and move it first — which
 * needs a batch-level date, not one more column on the aggregate.
 *
 * So a lot is a subdivision of one `existencias` row: how much of a specific batch, and when
 * it expires. Lots do not have to sum to the parent's `cantidad` — a coordinator may log the
 * lot that matters (the one closest to expiry) without re-deriving the whole count, the same
 * spirit as `existencias.cantidad` itself being a count someone took, not a computed total.
 *
 * `fecha_caducidad` is nullable on purpose (non-negotiable 2.3 / BUG-23): a lot the coordinator
 * has counted but whose date is not known is recorded as unknown — «sin fecha» — never a guessed
 * date. Only `catalogo_items.perecedero` items are expected to carry one in practice, but nothing
 * here forces that at the database level; a lot with no date is simply not flagged or sorted by
 * urgency, which is the honest state.
 */
export const existenciaLotes = pgTable(
  'existencia_lotes',
  {
    id: pk(),
    existenciaId: uuid('existencia_id')
      .notNull()
      .references(() => existencias.id, { onDelete: 'cascade' }),
    cantidad: integer('cantidad').notNull(),
    /** Honest and optional (2.3, BUG-23). NULL reads «sin fecha», never a fabricated date. */
    fechaCaducidad: date('fecha_caducidad', { mode: 'date' }),
    contadoEn: timestamp('contado_en', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    contadoPor: uuid('contado_por')
      .notNull()
      .references(() => usuarios.id),
    notas: text('notas'),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('existencia_lotes_existencia_idx').on(t.existenciaId),
    // Sorting "soonest expiry first" is the whole point of the screen; index only the lots
    // that actually carry a date, mirroring `ofertas_perecedero_idx`.
    index('existencia_lotes_caducidad_idx')
      .on(t.fechaCaducidad)
      .where(sql`fecha_caducidad is not null`),
    check('existencia_lotes_cantidad_check', sql`cantidad > 0`),
  ],
)
