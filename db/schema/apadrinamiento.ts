import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, enLista, pk } from './_shared'
import { comunidades, organizaciones, usuarios } from './core'
import { entregas, pedidos } from './marketplace'

/**
 * PRD-12 — «Apadrina una partera». The funding side of the three-sided marketplace.
 *
 * A sponsor (`padrino`) earmarks funds to one beneficiary — a partera or her community, or a
 * shared pool — and that commitment is traced end to end: the earmark on `apadrinamientos`,
 * and every peso of it applied to a real `pedido`/`entrega` on `apadrinamiento_asignaciones`.
 * Committed minus applied is the balance a funded local purchase (PRD-9) can draw on.
 *
 * Privacy posture (Ley 1581, mirroring the public-view discipline in 0027): a sponsor is only
 * ever shown a consented, aggregated `beneficiario_etiqueta` — never the exact location, phone
 * or health detail of a partera. The DB refuses to let a sponsorship tied to a named community
 * go `activo` without consent captured first, so «no profile without consent» is an invariant,
 * not a UI courtesy.
 *
 * The Drizzle mirror below is the typed surface application code uses; the RLS floor, the audit
 * triggers and the `tocar` trigger live in db/migrations/0041_apadrinamiento.sql, which
 * drizzle-kit does not generate. `pnpm db:check` diffs the two so the columns stay in step.
 */

/** A sponsor is either a person or an institution. Shapes the label, nothing about access. */
export const TIPOS_PADRINO = ['individuo', 'organizacion'] as const

/** One-off gift or a recurring monthly commitment. Disbursement rails are out of v1 scope. */
export const RECURRENCIAS_APADRINAMIENTO = ['unico', 'mensual'] as const

/**
 * `activo` funds are committed and drawable; `pausado`/`completado`/`cancelado` are not. A
 * cancelled sponsorship is retired by state, never deleted — the trace has to survive it.
 */
export const ESTADOS_APADRINAMIENTO = ['activo', 'pausado', 'completado', 'cancelado'] as const

export const apadrinamientos = pgTable(
  'apadrinamientos',
  {
    id: pk(),
    /** Org-scoped like every operational table (0017 / 0030). RLS binds reads/writes to it. */
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    /**
     * The beneficiary community when the earmark names one; NULL means a shared pool with no
     * single partera behind it. A named community is the one that must carry consent before it
     * can be shown to a sponsor (see the `_consentida` check).
     */
    comunidadId: uuid('comunidad_id').references(() => comunidades.id),
    /**
     * The privacy-safe display name a sponsor sees — «Partera del Atrato medio», never a real
     * name, number or coordinate (Ley 1581 / 2.16). Required, so nothing forces a screen to
     * fall back to raw community identity to have something to show.
     */
    beneficiarioEtiqueta: text('beneficiario_etiqueta').notNull(),
    /** Lightweight sponsor identification (no login in v1, mirroring the donor model). */
    padrinoNombre: text('padrino_nombre').notNull(),
    padrinoContacto: text('padrino_contacto'),
    padrinoTipo: text('padrino_tipo').notNull().default('individuo'),
    /** What the money is earmarked for — «insumos de partería», «transporte», etc. */
    proposito: text('proposito').notNull(),
    /** Committed amount in COP. Applied amounts on `asignaciones` draw this down. */
    montoCop: bigint('monto_cop', { mode: 'number' }).notNull(),
    recurrencia: text('recurrencia').notNull().default('unico'),
    estado: text('estado').notNull().default('activo'),
    /** §Consent: captured from the partera before any profile reaches a sponsor. */
    consentimientoBeneficiario: boolean('consentimiento_beneficiario').notNull().default(false),
    consentimientoEn: timestamp('consentimiento_en', { withTimezone: true, mode: 'date' }),
    /** Who recorded it (2.1). Signed against auth.uid() by the insert policy. */
    creadoPor: uuid('creado_por').references(() => usuarios.id),
    notas: text('notas'),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('apadrinamientos_organizacion_idx').on(t.organizacionId),
    index('apadrinamientos_comunidad_idx').on(t.comunidadId),
    index('apadrinamientos_estado_idx').on(t.estado),
    check('apadrinamientos_monto_check', sql`monto_cop > 0`),
    check('apadrinamientos_tipo_check', enLista('padrino_tipo', TIPOS_PADRINO)),
    check('apadrinamientos_recurrencia_check', enLista('recurrencia', RECURRENCIAS_APADRINAMIENTO)),
    check('apadrinamientos_estado_check', enLista('estado', ESTADOS_APADRINAMIENTO)),
    // A consent flag without a timestamp is not a consent record (same shape as 2.1 elsewhere).
    check(
      'apadrinamientos_consentimiento_check',
      sql`consentimiento_beneficiario = false or consentimiento_en is not null`,
    ),
    // The invariant behind AC #2: an earmark tied to a named community cannot be shown to a
    // sponsor (i.e. be `activo`) until that partera has consented. A pool has no partera, so it
    // is unaffected.
    check(
      'apadrinamientos_consentida_check',
      sql`comunidad_id is null or estado <> 'activo' or consentimiento_beneficiario`,
    ),
  ],
)

/**
 * The trace: which real demand each peso of an earmark funded. Append-only and immutable
 * (mirrors `decisiones_asignacion` and `entregas`) — a funding decision, once recorded, is not
 * edited or deleted. `pedido_id` is the demand it paid for; `entrega_id` is the confirmed
 * delivery when the trace reaches all the way to arrival.
 */
export const apadrinamientoAsignaciones = pgTable(
  'apadrinamiento_asignaciones',
  {
    id: pk(),
    apadrinamientoId: uuid('apadrinamiento_id')
      .notNull()
      .references(() => apadrinamientos.id, { onDelete: 'cascade' }),
    pedidoId: uuid('pedido_id').references(() => pedidos.id),
    entregaId: uuid('entrega_id').references(() => entregas.id),
    /** Amount of the earmark applied here, in COP. Sum over a sponsorship ≤ its `monto_cop`. */
    montoAplicadoCop: bigint('monto_aplicado_cop', { mode: 'number' }).notNull(),
    concepto: text('concepto'),
    /** Who applied it (2.1). Signed against auth.uid() by the insert policy. */
    aplicadoPor: uuid('aplicado_por').references(() => usuarios.id),
    creadoEn: creadoEn(),
  },
  (t) => [
    index('apadrinamiento_asignaciones_apadrinamiento_idx').on(t.apadrinamientoId),
    index('apadrinamiento_asignaciones_pedido_idx').on(t.pedidoId),
    index('apadrinamiento_asignaciones_entrega_idx').on(t.entregaId),
    check('apadrinamiento_asignaciones_monto_check', sql`monto_aplicado_cop > 0`),
    // A funding application has to point at something it funded.
    check(
      'apadrinamiento_asignaciones_destino_check',
      sql`pedido_id is not null or entrega_id is not null`,
    ),
  ],
)
