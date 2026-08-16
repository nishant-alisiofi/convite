import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, enLista, pk } from './_shared'
import { organizaciones, usuarios } from './core'
import { ESTADOS_OFERTA_TRANSPORTE, MODOS } from './vocabulario'

/**
 * FR-18 (§29.3b) — transport capacity OFFERED by an aportante. Typed mirror of migration 0051.
 * The applied schema is the hand-authored SQL there (the table, its RLS, and the aportante
 * self-signup function); this is the Drizzle view application code reads and `pnpm db:check`
 * diffs against.
 *
 * The supply side of transport: an aportante says "I can move N families around this corridor",
 * and it carries NOTHING that could point at a vulnerable household — no comunidad, no nodo, no
 * coordinate, no household address, only a coarse free-text coverage area. The vetted,
 * address-seeing side of transport (`transportista_avalado` + `convite_conduce_hacia`, 0048) is a
 * different, untouched tier. Distinct from `capacidades` (0004), which is the dispatch-side record
 * bound to a nodo and a comunidad.
 */
export const ofertasTransporte = pgTable(
  'ofertas_transporte',
  {
    id: pk(),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    /** One of MODOS — the same transport modes as `capacidades`. */
    modo: text('modo').notNull(),
    /**
     * Coarse coverage corridor (municipality / river), free text. Never a coordinate or a
     * household address — the aportante tier touches no community data (§29.3b).
     */
    areaCobertura: text('area_cobertura').notNull(),
    /** The "seats" analogue, in families, matching `capacidades.cupo_familias`. */
    cupoFamilias: integer('cupo_familias').notNull(),
    disponibleDesde: timestamp('disponible_desde', { withTimezone: true, mode: 'date' }),
    disponibleHasta: timestamp('disponible_hasta', { withTimezone: true, mode: 'date' }),
    notas: text('notas'),
    estado: text('estado').notNull().default('OFRECIDA'),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('ofertas_transporte_organizacion_idx').on(t.organizacionId),
    index('ofertas_transporte_usuario_idx').on(t.usuarioId),
    index('ofertas_transporte_estado_idx').on(t.estado),
    check('ofertas_transporte_modo_check', enLista('modo', MODOS)),
    check('ofertas_transporte_estado_check', enLista('estado', ESTADOS_OFERTA_TRANSPORTE)),
    check('ofertas_transporte_cupo_check', sql`cupo_familias > 0`),
    check(
      'ofertas_transporte_ventana_check',
      sql`disponible_hasta is null or disponible_desde is null or disponible_hasta > disponible_desde`,
    ),
  ],
)
