import { sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, enLista, pk } from './_shared'
import { comunidades, organizaciones, usuarios } from './core'
import { reportes } from './intake'
import { jornadas } from './territorio'

/**
 * PRD-29 — Assessments and recovery (levels 2–4, coverage, bill of materials).
 *
 * Level 1 (the `reporte`) is built elsewhere; this is levels 2–4:
 *
 *   Level 2 — a verified damage finding becomes a bill of materials (materiales + transporte +
 *             mano de obra en días + asistencia técnica), proposed from a template and adjusted
 *             by whoever does the asistencia técnica. This is the link that turns damage
 *             reporting into something Apadrinar (PRD-12) can price and fund.
 *   Level 3 — the assessment sweep: a surveyor records *every* in-scope item, not only those
 *             that reported (census-shaped). Provenance is a visitor with a date, and findings
 *             expire — an assessment is a claim made on a day, not a permanent truth.
 *   Level 4 — the territorial picture: coverage aggregated by vereda and municipality, which is
 *             the artifact a funder reads. Coverage is *assessed out of estimated total, with its
 *             date* — «forty of a hundred houses surveyed» is a different claim from «forty
 *             damaged houses».
 *
 * FR-48 — engineering/technical evaluations (agua, puente, vivienda, eléctrico…) reuse the same
 * `evaluaciones` row, shaped as a *ticket* instead of a sweep: a request for a técnico to assess
 * one piece of infrastructure, tracked through `estado` (solicitada → en curso → completada) with
 * `asignado_a` (the technical contact) and `detalle` (the finding, recorded on completion). A
 * ticket carries no `total_estimado` — it is not a census item — and that is exactly what tells
 * the census queries (`listarEvaluaciones`, `filasCobertura`) to leave it out of Level 4 coverage,
 * which stays a claim about surveyed items, never about open engineering requests.
 *
 * Four tables, all org-scoped exactly like the other operational tables (0017/0030/0041/0043):
 *   plantillas_evaluacion  — the multi-domain templates the assessment and the BoM are driven by
 *   evaluaciones           — either a sweep (a visit to a place, for a domain, on a date, that
 *                            estimated N in-scope items) or a technical-evaluation ticket
 *                            (FR-48: no total_estimado, tracked via `estado`)
 *   evaluacion_hallazgos   — the findings; each carries `via_de_respuesta`
 *                            (convite | derivacion | sin_via)
 *   hallazgo_bom           — the four-component repair estimate for a matchable finding
 *
 * The Drizzle mirror below is the typed surface application code reads; the RLS floor, the audit
 * trigger and the `tocar` trigger live in db/migrations/0044_evaluaciones_y_recuperacion.sql
 * (extended for FR-48 by db/migrations/0057_evaluaciones_servicios_de_ingenieria.sql), which
 * drizzle-kit does not generate. `pnpm db:check` diffs the two so the columns stay in step.
 */

/**
 * §21: assessments are multi-domain, driven by templates. `vivienda` (housing) is the one Level 2
 * is written for; the rest are the other mandates a census sweep records — education
 * infrastructure, health posts, water, environment, organisational capacity. Kept as text + check
 * so a new domain is a one-line ALTER (2.8 shape).
 */
export const DOMINIOS_EVALUACION = [
  'vivienda',
  'educacion',
  'salud',
  'agua',
  'ambiente',
  'organizacional',
  // FR-48: engineering/technical evaluation domains — infrastructure a técnico assesses that the
  // original census domains did not name (a bridge, an electrical system).
  'puente',
  'electrico',
] as const

/**
 * §6.2/§17.4: the response route a finding takes. `convite` is matchable — it can become a costed
 * repair the marketplace funds and dispatches. `derivacion` belongs to another organisation's
 * mandate: it is recorded and surfaced in the Derivaciones block, and it never enters despacho.
 * `sin_via` is recorded, never queued — need seen with no route to answer it, which is still worth
 * knowing (it is what makes coverage honest: an item assessed and found needing nothing still
 * counts as assessed).
 */
export const VIAS_DE_RESPUESTA = ['convite', 'derivacion', 'sin_via'] as const

/** Where a bill of materials came from: proposed from a template, or entered by hand. */
export const ORIGENES_BOM = ['plantilla', 'manual'] as const

/**
 * FR-48: the lifecycle of a technical/engineering evaluation ticket. `solicitada` is where every
 * ticket starts (the DB default); it moves forward only, one step at a time — never back, never
 * skipped — enforced by `siguienteEstado`/`transicionValida` in lib/evaluaciones.ts. A census
 * sweep row also carries `estado` (schema-wide default `solicitada`) but the panel never surfaces
 * or advances it — sweeps are identified by having a `total_estimado`, tickets by not.
 */
export const ESTADOS_EVALUACION = ['solicitada', 'en_curso', 'completada'] as const

export type DominioEvaluacion = (typeof DOMINIOS_EVALUACION)[number]
export type ViaDeRespuesta = (typeof VIAS_DE_RESPUESTA)[number]
export type OrigenBom = (typeof ORIGENES_BOM)[number]
export type EstadoEvaluacion = (typeof ESTADOS_EVALUACION)[number]

/**
 * §21 / AC #1, #5: a template names a domain and proposes the baseline four components for a
 * repair at severity 2 (the reference severity — a verified `93` at severity 2 is the case the
 * PRD is written against). `generarBom` (lib/evaluaciones.ts) scales the baseline by the finding's
 * severity, and the técnico edits the result. Org-scoped: each organisation maintains its own
 * templates, and RLS binds reads/writes to the owner (0044).
 */
export const plantillasEvaluacion = pgTable(
  'plantillas_evaluacion',
  {
    id: pk(),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    dominio: text('dominio').notNull(),
    codigo: text('codigo').notNull(),
    nombre: text('nombre').notNull(),
    descripcion: text('descripcion'),
    /** Baseline materials cost at severity 2, in COP. `generarBom` scales this by severity. */
    materialesCop: bigint('materiales_cop', { mode: 'number' }).notNull().default(0),
    /** Baseline transport cost at severity 2, in COP. */
    transporteCop: bigint('transporte_cop', { mode: 'number' }).notNull().default(0),
    /** Baseline external technical-assistance cost at severity 2, in COP. */
    asistenciaTecnicaCop: bigint('asistencia_tecnica_cop', { mode: 'number' }).notNull().default(0),
    /** Baseline local-labour requirement at severity 2, in days. A supply side, not a cost. */
    manoDeObraDias: integer('mano_de_obra_dias').notNull().default(0),
    activa: boolean('activa').notNull().default(true),
    creadoPor: uuid('creado_por').references(() => usuarios.id),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    uniqueIndex('plantillas_evaluacion_codigo_key').on(t.organizacionId, t.codigo),
    index('plantillas_evaluacion_organizacion_idx').on(t.organizacionId),
    index('plantillas_evaluacion_dominio_idx').on(t.dominio),
    check('plantillas_evaluacion_dominio_check', enLista('dominio', DOMINIOS_EVALUACION)),
    check('plantillas_evaluacion_materiales_check', sql`materiales_cop >= 0`),
    check('plantillas_evaluacion_transporte_check', sql`transporte_cop >= 0`),
    check('plantillas_evaluacion_asistencia_check', sql`asistencia_tecnica_cop >= 0`),
    check('plantillas_evaluacion_mano_de_obra_check', sql`mano_de_obra_dias >= 0`),
  ],
)

/**
 * §21 Level 3 / AC #2, #3: one sweep is a visit to one community, for one domain, on a date. It
 * carries the provenance the findings inherit — the visitor and the date — and the expiry beyond
 * which the assessment is stale. `total_estimado` is the surveyor's estimate of in-scope items at
 * that place (the coverage denominator); the assessed count is the number of findings recorded
 * against the sweep (the numerator). Coverage is therefore *assessed out of estimated total, with
 * its date* (§21), and it is honest by construction: the denominator and the date both come from
 * the visit that produced them.
 *
 * Coverage is per (community, domain): the housing coverage of a vereda is a different claim from
 * its water coverage, so each sweep names its domain.
 *
 * FR-48: the same row also models a technical/engineering evaluation *ticket* — a request to
 * assess one piece of infrastructure, not a census. A ticket has no `total_estimado` (there is
 * nothing to count coverage against), `estado` tracks it solicitada → en curso → completada,
 * `asignado_a` names the técnico it is assigned to (light identity by name, the same posture as
 * `evaluador_nombre`), and `detalle` records the finding on completion. `total_estimado is null`
 * is what tells a sweep row from a ticket row apart everywhere this table is queried.
 */
export const evaluaciones = pgTable(
  'evaluaciones',
  {
    id: pk(),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    comunidadId: uuid('comunidad_id')
      .notNull()
      .references(() => comunidades.id),
    dominio: text('dominio').notNull(),
    /** §22: the `evaluacion` jornada this sweep belongs to, when it was planned as one. */
    jornadaId: uuid('jornada_id').references(() => jornadas.id),
    /**
     * The visitor. Light identity by name — the offline `evaluador` login is §29.3 / PRD-13 and
     * out of this WI; here provenance is «a visitor with a date», recorded as text. NULL on a
     * FR-48 ticket until the visit that closes it actually happens.
     */
    evaluadorNombre: text('evaluador_nombre'),
    /** NULL on a FR-48 ticket until it has actually been visited. */
    fechaVisita: date('fecha_visita'),
    /**
     * In-scope items the surveyor estimates at this place (coverage denominator). NULL marks a
     * FR-48 technical-evaluation ticket rather than a census sweep — see the table doc comment.
     */
    totalEstimado: integer('total_estimado'),
    /** When the findings of this sweep go stale. A finding expires; it is not a permanent truth. */
    venceEn: date('vence_en'),
    /**
     * FR-48: the lifecycle of a technical-evaluation ticket. Defaults `solicitada` on every row;
     * a census sweep carries the default too but the panel never reads or advances it there.
     */
    estado: text('estado').notNull().default('solicitada'),
    /** FR-48: the technical contact/assignee, by name — the same light-identity posture above. */
    asignadoA: text('asignado_a'),
    /** FR-48: the finding/detail note, recorded as the ticket reaches `completada`. */
    detalle: text('detalle'),
    /** Who recorded the sweep (2.1). Signed against auth.uid() by the insert policy. */
    registradoPor: uuid('registrado_por').references(() => usuarios.id),
    notas: text('notas'),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('evaluaciones_organizacion_idx').on(t.organizacionId),
    index('evaluaciones_comunidad_idx').on(t.comunidadId),
    index('evaluaciones_dominio_idx').on(t.dominio),
    index('evaluaciones_jornada_idx').on(t.jornadaId),
    index('evaluaciones_estado_idx').on(t.estado),
    check('evaluaciones_dominio_check', enLista('dominio', DOMINIOS_EVALUACION)),
    check('evaluaciones_estado_check', enLista('estado', ESTADOS_EVALUACION)),
    check('evaluaciones_total_check', sql`total_estimado is null or total_estimado > 0`),
    // An assessment that expires before it happened is a data error.
    check('evaluaciones_vence_check', sql`vence_en is null or vence_en >= fecha_visita`),
  ],
)

/**
 * §21 / AC #2, #6: a finding. It comes from a sweep (Level 3, `evaluacion_id`), or from a verified
 * damage report (Level 2, `reporte_id`), or is entered directly against a community. Every finding
 * carries `via_de_respuesta`: `convite` (matchable → can be costed and funded), `derivacion`
 * (another mandate → surfaced in Derivaciones, never despacho), or `sin_via` (recorded, never
 * queued). A finding's provenance and expiry, when it belongs to a sweep, come from that sweep.
 */
export const evaluacionHallazgos = pgTable(
  'evaluacion_hallazgos',
  {
    id: pk(),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    /** The sweep this finding was recorded in (Level 3), if any. Cascades with the sweep. */
    evaluacionId: uuid('evaluacion_id').references(() => evaluaciones.id, { onDelete: 'cascade' }),
    /** The verified damage report this finding was raised from (Level 2), if any. */
    reporteId: uuid('reporte_id').references((): AnyPgColumn => reportes.id),
    comunidadId: uuid('comunidad_id')
      .notNull()
      .references(() => comunidades.id),
    dominio: text('dominio').notNull(),
    descripcion: text('descripcion').notNull(),
    /** Damage severity, 1–3, mirroring `reportes.severidad`. Null for a non-damage finding. */
    severidad: smallint('severidad'),
    viaDeRespuesta: text('via_de_respuesta').notNull().default('convite'),
    /** The organisation/mandate a `derivacion` finding belongs to. Required iff via = derivacion. */
    derivacionDestino: text('derivacion_destino'),
    /** Who recorded it (2.1). Signed against auth.uid() by the insert policy. */
    registradoPor: uuid('registrado_por').references(() => usuarios.id),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('evaluacion_hallazgos_organizacion_idx').on(t.organizacionId),
    index('evaluacion_hallazgos_evaluacion_idx').on(t.evaluacionId),
    index('evaluacion_hallazgos_reporte_idx').on(t.reporteId),
    index('evaluacion_hallazgos_comunidad_idx').on(t.comunidadId),
    index('evaluacion_hallazgos_via_idx').on(t.viaDeRespuesta),
    check('evaluacion_hallazgos_dominio_check', enLista('dominio', DOMINIOS_EVALUACION)),
    check('evaluacion_hallazgos_severidad_check', sql`severidad is null or severidad between 1 and 3`),
    check('evaluacion_hallazgos_via_check', enLista('via_de_respuesta', VIAS_DE_RESPUESTA)),
    // A derivación names the mandate it goes to; anything else carries no destino.
    check(
      'evaluacion_hallazgos_derivacion_check',
      sql`(via_de_respuesta = 'derivacion' and derivacion_destino is not null)
          or (via_de_respuesta <> 'derivacion' and derivacion_destino is null)`,
    ),
  ],
)

/**
 * §21 / AC #1, #4, #7: the four-component repair estimate for one matchable finding. Materiales,
 * transporte and asistencia técnica are costs in COP; mano de obra local is a *supply side* — days
 * of local labour required, matched by days committed, never a peso line. Each component tracks
 * what is required and what is covered, so an unmet component is legible (AC #4: it feeds the
 * Bandeja stuck-states). The fundable amount a sponsor prices against (AC #7) is the sum of the
 * three COP components; `saldoFundableCop` (lib) is what Apadrinar/programa funding still needs to
 * cover. One BoM per finding (unique `hallazgo_id`).
 */
export const hallazgoBom = pgTable(
  'hallazgo_bom',
  {
    id: pk(),
    hallazgoId: uuid('hallazgo_id')
      .notNull()
      .references(() => evaluacionHallazgos.id, { onDelete: 'cascade' }),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    origen: text('origen').notNull().default('manual'),
    /** The template the estimate was proposed from, if any. */
    plantillaId: uuid('plantilla_id').references(() => plantillasEvaluacion.id),
    materialesCop: bigint('materiales_cop', { mode: 'number' }).notNull().default(0),
    transporteCop: bigint('transporte_cop', { mode: 'number' }).notNull().default(0),
    asistenciaTecnicaCop: bigint('asistencia_tecnica_cop', { mode: 'number' }).notNull().default(0),
    manoDeObraDias: integer('mano_de_obra_dias').notNull().default(0),
    /** Covered materials funding, in COP (e.g. drawn from an Apadrinamiento). */
    materialesCubiertoCop: bigint('materiales_cubierto_cop', { mode: 'number' }).notNull().default(0),
    transporteCubiertoCop: bigint('transporte_cubierto_cop', { mode: 'number' }).notNull().default(0),
    asistenciaTecnicaCubiertoCop: bigint('asistencia_tecnica_cubierto_cop', { mode: 'number' })
      .notNull()
      .default(0),
    /** Local labour committed against the requirement, in days (the supply match). */
    manoDeObraCubiertaDias: integer('mano_de_obra_cubierta_dias').notNull().default(0),
    editadoPor: uuid('editado_por').references(() => usuarios.id),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    uniqueIndex('hallazgo_bom_hallazgo_key').on(t.hallazgoId),
    index('hallazgo_bom_organizacion_idx').on(t.organizacionId),
    index('hallazgo_bom_plantilla_idx').on(t.plantillaId),
    check('hallazgo_bom_origen_check', enLista('origen', ORIGENES_BOM)),
    check('hallazgo_bom_materiales_check', sql`materiales_cop >= 0 and materiales_cubierto_cop >= 0`),
    check('hallazgo_bom_transporte_check', sql`transporte_cop >= 0 and transporte_cubierto_cop >= 0`),
    check(
      'hallazgo_bom_asistencia_check',
      sql`asistencia_tecnica_cop >= 0 and asistencia_tecnica_cubierto_cop >= 0`,
    ),
    check(
      'hallazgo_bom_mano_de_obra_check',
      sql`mano_de_obra_dias >= 0 and mano_de_obra_cubierta_dias >= 0`,
    ),
  ],
)
