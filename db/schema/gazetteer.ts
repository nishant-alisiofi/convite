import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, enLista, pk, punto } from './_shared'
import { comunidades, organizaciones, usuarios } from './core'
import { FUENTES_UBICACION, TIPOS_COMUNIDAD } from './vocabulario'

/**
 * PRD-35 (§29.3b) — the shared community gazetteer's correction desk.
 *
 * Communities are a common registry: every organisation reads the same rows, and the shared
 * fields (name, location, tier, agrupador, check-in interval) belong to no single org. The seed
 * plants them `verificado_en = NULL` on purpose — nothing counts as verified until the territory
 * says so — so the registry has to be *correctable by the territory* rather than only by whoever
 * first typed a village in.
 *
 * A proposal is that correction, made reviewable. Two shapes on one table:
 *
 *   * `correccion` — a fix to an EXISTING community (`comunidad_id` set): a better name, a real
 *     coordinate, or the flag that it does not exist / is a duplicate (`existe_real = false`).
 *   * `nueva`      — a proposal for a NEW community (`comunidad_id` null): name + municipality +
 *     an optional coordinate, matched by name and proximity against the registry before creation
 *     so «Bellavista» is not entered twice (the duplicate that makes the coordination layer
 *     worthless, §29.3b).
 *
 * Proposing writes only this table (an authenticated INSERT). *Accepting* one writes the shared
 * `comunidades` row and stamps `verificado_en` — a gazetteer edit authenticated cannot do
 * directly — so it goes through the SECURITY DEFINER `convite_resolver_propuesta_registro`,
 * gated to a coordinador/admin of the owning org (or a platform admin). The FKs are declared in
 * this mirror because the import is one-way (gazetteer → core), the same shape territorio.ts uses.
 */
export const registroPropuestas = pgTable(
  'registro_propuestas',
  {
    id: pk(),
    /** `correccion` fixes an existing community; `nueva` proposes one that is not in the registry. */
    tipoPropuesta: text('tipo_propuesta').notNull(),
    /** The community being corrected. NULL for a `nueva` proposal (there is no row yet). */
    comunidadId: uuid('comunidad_id').references(() => comunidades.id),
    /** The organisation making the proposal — the RLS scope. A proposal carries an author (2.1). */
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    propuestoPor: uuid('propuesto_por')
      .notNull()
      .references(() => usuarios.id),
    /** Proposed name — a correction to the name, or the name of the proposed new community. */
    nombrePropuesto: text('nombre_propuesto'),
    /** Municipality — required for a `nueva` proposal, unused for a `correccion`. */
    municipioPropuesto: text('municipio_propuesto'),
    /** Proposed community type for a `nueva` proposal (vereda, corregimiento, …). */
    tipoComunidadPropuesto: text('tipo_comunidad_propuesto'),
    /**
     * A proposed coordinate. Non-negotiable 2.2 — a stored point never travels without its
     * declared source and radius, so the three columns move together (the check below).
     */
    ubicacionPropuesta: punto('ubicacion_propuesta'),
    ubicacionFuente: text('ubicacion_fuente'),
    ubicacionPrecisionM: integer('ubicacion_precision_m'),
    /**
     * The existence half of a correction. NULL = the proposal says nothing about existence;
     * `false` = «this community is not real / is a duplicate», which on acceptance deactivates
     * the row rather than deleting it (never lose the audit trail).
     */
    existeReal: boolean('existe_real'),
    /** Why — a correction carries its reason, in the words of whoever noticed it (2.1). */
    motivo: text('motivo').notNull(),
    /** `pendiente` until a reviewer accepts or rejects it. */
    estado: text('estado').notNull().default('pendiente'),
    resueltoPor: uuid('resuelto_por').references(() => usuarios.id),
    resueltoEn: timestamp('resuelto_en', { withTimezone: true, mode: 'date' }),
    notaResolucion: text('nota_resolucion'),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('registro_propuestas_estado_idx').on(t.estado),
    index('registro_propuestas_comunidad_idx').on(t.comunidadId),
    index('registro_propuestas_organizacion_idx').on(t.organizacionId),
    check('registro_propuestas_tipo_check', enLista('tipo_propuesta', ['correccion', 'nueva'])),
    check('registro_propuestas_estado_valido_check', enLista('estado', ['pendiente', 'aceptada', 'rechazada'])),
    // A correccion points at a community and proposes at least one change; a nueva carries no
    // community id but must name the place and its municipality.
    check(
      'registro_propuestas_forma_check',
      sql`(tipo_propuesta = 'correccion'
             and comunidad_id is not null
             and (nombre_propuesto is not null or ubicacion_propuesta is not null or existe_real is not null))
          or (tipo_propuesta = 'nueva'
             and comunidad_id is null
             and nombre_propuesto is not null
             and municipio_propuesto is not null)`,
    ),
    check('registro_propuestas_motivo_check', sql`length(btrim(motivo)) > 0`),
    check(
      'registro_propuestas_tipo_comunidad_check',
      sql`tipo_comunidad_propuesto is null or ${enLista('tipo_comunidad_propuesto', TIPOS_COMUNIDAD)}`,
    ),
    // Non-negotiable 2.2: a point with no declared source, or a source with no radius, is a
    // coordinate we have invented the precision of.
    check(
      'registro_propuestas_ubicacion_declarada_check',
      sql`(ubicacion_propuesta is null and ubicacion_fuente is null)
          or (ubicacion_propuesta is not null and ubicacion_fuente is not null and ubicacion_precision_m is not null)`,
    ),
    check(
      'registro_propuestas_ubicacion_fuente_check',
      sql`ubicacion_fuente is null or ${enLista('ubicacion_fuente', FUENTES_UBICACION)}`,
    ),
    check(
      'registro_propuestas_precision_check',
      sql`ubicacion_precision_m is null or ubicacion_precision_m >= 0`,
    ),
    // 2.1: a resolution is somebody's decision, so it carries their name and its time together.
    check(
      'registro_propuestas_resolucion_check',
      sql`(estado = 'pendiente' and resuelto_por is null and resuelto_en is null)
          or (estado <> 'pendiente' and resuelto_por is not null and resuelto_en is not null)`,
    ),
  ],
)
