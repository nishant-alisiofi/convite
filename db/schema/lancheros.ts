import { sql } from 'drizzle-orm'
import { bigint, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, enLista, pk } from './_shared'
import { comunidades, contactos, organizaciones, usuarios } from './core'
import { envios } from './marketplace'
import { trasladosPersona } from './transporte-personas'
import { ESTADOS_PAGO_LANCHERO } from './vocabulario'

/**
 * FR-46 — boat-leg cost + lanchero payment (record-keeping only, migration 0056).
 *
 * The river is the road and the lancha is the truck: boat is already a transport mode, what was
 * missing was a financial record. `pagos_lanchero` attaches to exactly one leg — a goods shipment
 * (`envios`) or a person trip (`traslados_persona`, 0048) — and carries two figures: what the leg
 * cost overall, and what is owed to the lanchero specifically. No disbursement, the same posture
 * `compras_locales` (PRD-9, 0049) already established for funding without moving money.
 *
 * The RLS floor, the audit trigger and the touch trigger live in
 * db/migrations/0056_lanchas_y_relevo.sql, which drizzle-kit does not generate. `pnpm db:check`
 * diffs the two so the columns and checks stay in step.
 */
export const pagosLanchero = pgTable(
  'pagos_lanchero',
  {
    id: pk(),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    /** Exactly one of these two — the leg this payment belongs to. */
    envioId: uuid('envio_id').references(() => envios.id),
    trasladoPersonaId: uuid('traslado_persona_id').references(() => trasladosPersona.id),
    /** The lanchero to be paid. Any contact may be named — FR-46 does not require the vetted role. */
    lancheroContactoId: uuid('lanchero_contacto_id')
      .notNull()
      .references(() => contactos.id),
    /** What the leg cost overall (fuel, tolls, whatever the coordinator was told). Optional. */
    costoTotalCop: bigint('costo_total_cop', { mode: 'number' }),
    /** What is owed to the lanchero specifically — the amount `estadoPago` tracks. */
    montoLancheroCop: bigint('monto_lanchero_cop', { mode: 'number' }).notNull(),
    estadoPago: text('estado_pago').notNull().default('pendiente'),
    /** Who marked it paid, and when (non-negotiable 2.1) — mirrors every despacho check here. */
    pagadoPor: uuid('pagado_por').references(() => usuarios.id),
    pagadoEn: timestamp('pagado_en', { withTimezone: true, mode: 'date' }),
    notas: text('notas'),
    creadoPor: uuid('creado_por').references(() => usuarios.id),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('pagos_lanchero_organizacion_idx').on(t.organizacionId),
    index('pagos_lanchero_envio_idx').on(t.envioId),
    index('pagos_lanchero_traslado_idx').on(t.trasladoPersonaId),
    index('pagos_lanchero_estado_idx').on(t.estadoPago),
    check('pagos_lanchero_leg_check', sql`num_nonnulls(envio_id, traslado_persona_id) = 1`),
    check('pagos_lanchero_costo_check', sql`costo_total_cop is null or costo_total_cop >= 0`),
    check('pagos_lanchero_monto_check', sql`monto_lanchero_cop > 0`),
    check('pagos_lanchero_estado_check', enLista('estado_pago', ESTADOS_PAGO_LANCHERO)),
    check(
      'pagos_lanchero_pago_check',
      sql`(estado_pago = 'pagado') = (pagado_por is not null and pagado_en is not null)`,
    ),
  ],
)

/**
 * PRD-47 — which communities a registered lanchero's route covers (migration 0056).
 *
 * The vetting boundary: a lanchero relays a report only for a community on their own route, which
 * `registrar_reporte_relevo` checks against this table. Same many-to-many "coverage" shape
 * `puntos_conexion_comunidades` (0040) already uses — no surrogate id, no timestamps, a composite
 * natural key.
 */
export const lancherosComunidades = pgTable(
  'lancheros_comunidades',
  {
    lancheroContactoId: uuid('lanchero_contacto_id')
      .notNull()
      .references(() => contactos.id, { onDelete: 'cascade' }),
    comunidadId: uuid('comunidad_id')
      .notNull()
      .references(() => comunidades.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('lancheros_comunidades_key').on(t.lancheroContactoId, t.comunidadId),
    index('lancheros_comunidades_comunidad_idx').on(t.comunidadId),
  ],
)
