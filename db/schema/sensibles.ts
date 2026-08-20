import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { creadoEn, enLista, pk, punto } from './_shared'
import { contactos, organizaciones } from './core'
import { reportes } from './intake'
import { ESTADOS_ALERTA_PROTECCION, FUENTES_UBICACION } from './vocabulario'

/**
 * PRD-49 — sensitive-disclosure handling (Supplement v4 §3, §6.3).
 *
 * The mechanism, in one paragraph: a report can be flagged `sensible` (reportes.sensible,
 * migration 0063) — a routing decision, never a diagnosis (v3 §27b.3), set by a distress-term
 * match at intake or by hand by a verifier. The instant it is flagged, its identifying content
 * is PHYSICALLY MOVED out of `reportes`/`adjuntos` into the tables below, which carry their own
 * RLS floor — read only by `verificador_vulnerable`, ceiling-gated per organisation
 * (`techo_permisos.acceso_sensible`) and scoped to that membership's communities, exactly like a
 * `verificador`'s territory. Every other role — general coordinador included — reads the same
 * `reportes` row everyone else does and finds those columns NULL. That is the enforcement: it
 * holds regardless of which screen or query touches `reportes`, because the content is not
 * there to read, not because a query remembered to hide it.
 */

/**
 * The un-redacted payload of a flagged report: exactly the columns Scope §2 names — detail,
 * location, contact. One row per flagged report, written only by `convite_marcar_reporte_sensible`
 * (SECURITY DEFINER, migration 0063) or by the intake path itself (which never lets the PII touch
 * `reportes` at all when the term match fires before the insert). No INSERT/UPDATE/DELETE grant to
 * `authenticated` at all — the only door in is the function.
 */
export const reportesContenidoProtegido = pgTable(
  'reportes_contenido_protegido',
  {
    reporteId: uuid('reporte_id')
      .primaryKey()
      .references(() => reportes.id, { onDelete: 'cascade' }),
    detalleLibre: text('detalle_libre'),
    descripcion: text('descripcion'),
    ubicacion: punto('ubicacion'),
    ubicacionFuente: text('ubicacion_fuente'),
    ubicacionPrecisionM: integer('ubicacion_precision_m'),
    contactoId: uuid('contacto_id').references(() => contactos.id),
    creadoEn: creadoEn(),
  },
  (t) => [
    check(
      'reportes_contenido_protegido_ubicacion_fuente_check',
      sql`ubicacion_fuente is null or ${enLista('ubicacion_fuente', FUENTES_UBICACION)}`,
    ),
  ],
)

/**
 * The distress-term configuration itself. **Partner data — empty by design.** Choosing what
 * triggers the flag is a partner/clinically-informed decision (Red de Mujeres / ASOREDIPARCHOCÓ),
 * never an engineering default (PRD-49 Out-of-scope). Zero active rows means the matcher never
 * fires — no false triggers — and the mechanism needs nothing more than an INSERT to go live once
 * the partner list arrives.
 */
export const terminosRiesgo = pgTable(
  'terminos_riesgo',
  {
    id: pk(),
    /** Lowercase, trimmed — matched case-insensitively against inbound text. */
    termino: text('termino').notNull(),
    activo: boolean('activo').notNull().default(true),
    notas: text('notas'),
    creadoEn: creadoEn(),
  },
  (t) => [index('terminos_riesgo_activo_idx').on(t.activo)],
)

/**
 * Protection-lead contacts per organisation. **Partner data — empty by design.** Designating who
 * the protection leads are is a partner/founder decision (PRD-49 Out-of-scope, echoing v3 §34's
 * "who holds org_admin"). The escalation mechanism is built and wired against this table with
 * zero rows; it fires nothing until a partner org has at least one `activo` contact.
 */
export const contactosProteccion = pgTable(
  'contactos_proteccion',
  {
    id: pk(),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    nombre: text('nombre').notNull(),
    /** E.164. */
    telefono: text('telefono').notNull(),
    canalPreferido: text('canal_preferido').notNull().default('whatsapp'),
    activo: boolean('activo').notNull().default(true),
    creadoEn: creadoEn(),
  },
  (t) => [
    index('contactos_proteccion_organizacion_idx').on(t.organizacionId),
    check('contactos_proteccion_canal_check', enLista('canal_preferido', ['whatsapp', 'sms'])),
    check(
      'contactos_proteccion_telefono_e164_check',
      sql`telefono ~ '^\\+[1-9][0-9]{7,14}$'`,
    ),
  ],
)

/**
 * The escalation signal (§6.3): one row per attempt to reach a protection lead about a flagged
 * report, written in the same transaction that flags it — so the signal exists the instant the
 * report is flagged, never waiting on the ordinary bandeja cadence. `contactoProteccionId` is
 * nullable: a report can be flagged (and escalated in the sense of "bypasses the queue") with
 * zero configured contacts, it just has nowhere to send until one exists. The payload sent is
 * folio + tipo only (PRD-34 §28.1's discretion rule) — never read the disclosure content off this
 * table, because it was never written here.
 */
export const alertasProteccion = pgTable(
  'alertas_proteccion',
  {
    id: pk(),
    reporteId: uuid('reporte_id')
      .notNull()
      .references(() => reportes.id, { onDelete: 'cascade' }),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    contactoProteccionId: uuid('contacto_proteccion_id').references(() => contactosProteccion.id),
    /** Denormalized so the sender never has to re-read the (possibly redacted) report row. */
    folio: integer('folio').notNull(),
    canal: text('canal').notNull().default('whatsapp'),
    estado: text('estado').notNull().default('pendiente'),
    enviadoEn: timestamp('enviado_en', { withTimezone: true, mode: 'date' }),
    error: text('error'),
    creadoEn: creadoEn(),
  },
  (t) => [
    index('alertas_proteccion_reporte_idx').on(t.reporteId),
    index('alertas_proteccion_pendiente_idx')
      .on(t.creadoEn)
      .where(sql`estado = 'pendiente'`),
    check('alertas_proteccion_canal_check', enLista('canal', ['whatsapp', 'sms'])),
    check('alertas_proteccion_estado_check', enLista('estado', ESTADOS_ALERTA_PROTECCION)),
  ],
)
