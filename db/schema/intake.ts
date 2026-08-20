import { sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, enLista, pk, punto } from './_shared'
import { catalogoItems } from './catalogo'
import { comunidades, contactos, organizaciones, usuarios } from './core'
import {
  CANALES,
  DIRECCIONES_MENSAJE,
  ESTADOS_MENSAJE,
  ESTADOS_REPORTE,
  FUENTES_UBICACION,
  MOTIVOS_SENSIBLE,
  TIPOS_ADJUNTO,
  TIPOS_REPORTE_REGISTRADO,
} from './vocabulario'

/**
 * A reporte is what a person told us. It is not yet a claim on anything: only a human
 * verification turns it into a `pedido` (Section 9.5, milestone M5 acceptance).
 */
export const reportes = pgTable(
  'reportes',
  {
    id: pk(),
    /** The number we read back to the reporter: «quedó registrado con el número 472». */
    folio: integer('folio').notNull().generatedAlwaysAsIdentity(),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    tipo: text('tipo').notNull(),
    canal: text('canal').notNull(),
    contactoId: uuid('contacto_id').references(() => contactos.id),
    comunidadId: uuid('comunidad_id').references(() => comunidades.id),
    codigoItem: char('codigo_item', { length: 2 }).references(() => catalogoItems.codigo),
    familias: integer('familias'),
    urgencia: smallint('urgencia'),
    severidad: smallint('severidad'),
    /** Free text or transcribed voice note when the catalogue item asks for detail. */
    detalleLibre: text('detalle_libre'),
    descripcion: text('descripcion'),
    ubicacion: punto('ubicacion'),
    ubicacionFuente: text('ubicacion_fuente'),
    ubicacionPrecisionM: integer('ubicacion_precision_m'),
    estado: text('estado').notNull().default('RECIBIDO'),
    verificadoPor: uuid('verificado_por').references(() => usuarios.id),
    verificadoEn: timestamp('verificado_en', { withTimezone: true, mode: 'date' }),
    /** Set when a coordinator marks this report a duplicate of an earlier one (Section 9.5). */
    reportePadreId: uuid('reporte_padre_id').references((): AnyPgColumn => reportes.id),
    /**
     * PRD-47: the registered lanchero who relayed this report, set only when `canal = 'relevo'`.
     * `comunidadId` above carries the origin community they relayed it for — together a verifier
     * sees the full chain (who relayed, for which community). Written only through
     * `registrar_reporte_relevo` (migration 0056), which also checks the lanchero is vetted for
     * that community via `lancheros_comunidades`.
     */
    relevoLancheroId: uuid('relevo_lanchero_id').references(() => contactos.id),
    /** Whatever the provider sent, untouched, so a parser bug is always recoverable. */
    payloadCrudo: jsonb('payload_crudo'),
    /**
     * PRD-49: a routing flag, never a diagnosis (v3 §27b.3) — set by a distress-term match at
     * intake or by hand by a verifier. Redaction of `detalleLibre`/`descripcion`/`ubicacion*`/
     * `contactoId` for a flagged report happens by PHYSICALLY MOVING those values out to
     * `reportesContenidoProtegido` (migration 0063) — the columns above read NULL for anyone,
     * including this row's own SELECT, once `sensible` is true. That is the enforcement; this
     * flag is what routes and displays as urgent.
     */
    sensible: boolean('sensible').notNull().default(false),
    /** `termino_detectado` (automated) or `manual` (a verifier flagged it). */
    sensibleMotivo: text('sensible_motivo'),
    /** Who flagged it by hand. NULL for an automated term match — there is no human to name. */
    sensibleMarcadoPor: uuid('sensible_marcado_por').references(() => usuarios.id),
    sensibleMarcadoEn: timestamp('sensible_marcado_en', { withTimezone: true, mode: 'date' }),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    uniqueIndex('reportes_folio_key').on(t.folio),
    index('reportes_estado_idx').on(t.estado),
    index('reportes_comunidad_idx').on(t.comunidadId),
    index('reportes_creado_idx').on(t.creadoEn),
    check('reportes_tipo_check', enLista('tipo', TIPOS_REPORTE_REGISTRADO)),
    // 0021: knowing the item is knowing the type, so the two cannot disagree.
    check(
      'reportes_sin_clasificar_sin_item_check',
      sql`tipo <> 'sin_clasificar' or codigo_item is null`,
    ),
    check('reportes_canal_check', enLista('canal', CANALES)),
    check('reportes_estado_check', enLista('estado', ESTADOS_REPORTE)),
    check(
      'reportes_ubicacion_fuente_check',
      sql`ubicacion_fuente is null or ${enLista('ubicacion_fuente', FUENTES_UBICACION)}`,
    ),
    check('reportes_urgencia_check', sql`urgencia is null or urgencia between 1 and 3`),
    check('reportes_severidad_check', sql`severidad is null or severidad between 1 and 3`),
    check('reportes_familias_check', sql`familias is null or familias > 0`),
    // Non-negotiable 2.2. A point with no declared source, or a source with no radius, is
    // a coordinate we have invented the precision of.
    check(
      'reportes_ubicacion_declarada_check',
      sql`(ubicacion is null and ubicacion_fuente is null)
          or (ubicacion is not null and ubicacion_fuente is not null and ubicacion_precision_m is not null)`,
    ),
    check(
      'reportes_gps_exacto_check',
      sql`ubicacion_fuente is distinct from 'gps' or ubicacion_precision_m = 0`,
    ),
    // Non-negotiable 2.1: verification is a human action, and it is recorded with a user id
    // and a timestamp or it did not happen.
    check(
      'reportes_verificacion_check',
      sql`(verificado_por is null and verificado_en is null)
          or (verificado_por is not null and verificado_en is not null)`,
    ),
    // Verifying and marking a duplicate are the same kind of judgement — a person read this
    // and decided — so both carry a name. Marking a duplicate is the more consequential
    // direction: it makes a need disappear rather than appear.
    check(
      'reportes_disposicion_check',
      sql`estado in ('RECIBIDO', 'CANCELADO') or verificado_por is not null`,
    ),
    check('reportes_duplicado_check', sql`estado <> 'DUPLICADO' or reporte_padre_id is not null`),
    // PRD-47: a relay always names its lanchero, and only a relay does (mirrors the
    // verificacion_check shape — the column and the channel that requires it move together).
    check(
      'reportes_relevo_lanchero_check',
      sql`(canal = 'relevo') = (relevo_lanchero_id is not null)`,
    ),
    // Attribution to an origin community is the point of a relay — it cannot be left blank.
    check('reportes_relevo_comunidad_check', sql`canal <> 'relevo' or comunidad_id is not null`),
    // PRD-49: a manual flag carries a name (2.1's «a judgement carries a name», same shape as
    // reportes_verificacion_check); an automated term match never has one to give.
    check(
      'reportes_sensible_motivo_check',
      sql`sensible_motivo is null or ${enLista('sensible_motivo', MOTIVOS_SENSIBLE)}`,
    ),
    check(
      'reportes_sensible_marcado_check',
      sql`(not sensible) = (sensible_motivo is null and sensible_marcado_en is null)`,
    ),
    check(
      'reportes_sensible_manual_check',
      sql`sensible_motivo is distinct from 'manual' or sensible_marcado_por is not null`,
    ),
    // The daily queue: what is waiting, worst first (Section 4.5).
    index('reportes_bandeja_idx')
      .on(sql`urgencia desc nulls last`, t.creadoEn)
      .where(sql`estado = 'RECIBIDO'`),
    // PRD-49 §6.3: the escalation surface — flagged reports, worst first, bypassing the
    // ordinary bandeja cadence.
    index('reportes_sensible_idx').on(t.creadoEn).where(sql`sensible`),
  ],
)

export const adjuntos = pgTable(
  'adjuntos',
  {
    id: pk(),
    reporteId: uuid('reporte_id').references(() => reportes.id, { onDelete: 'cascade' }),
    /** FK to `entregas` is declared in SQL (0004) to avoid a circular module import here. */
    entregaId: uuid('entrega_id'),
    tipo: text('tipo').notNull(),
    /**
     * Non-negotiable 2.6: our own object storage key, never the provider URL. WhatsApp
     * media URLs expire in minutes.
     */
    storageKey: text('storage_key').notNull(),
    mime: text('mime'),
    bytes: bigint('bytes', { mode: 'number' }),
    duracionSeg: integer('duracion_seg'),
    hashSha256: text('hash_sha256'),
    /**
     * What speech-to-text heard. Never edited (2.12) — a correction lands in
     * `transcripcionCorregida`, so the machine's output stays available to judge the
     * provider by. Overwriting it destroys the only evidence of what the model produced.
     */
    transcripcion: text('transcripcion'),
    transcripcionConfianza: numeric('transcripcion_confianza', { precision: 4, scale: 3 }),
    /** What a person says was actually said. Read this when present, else `transcripcion`. */
    transcripcionCorregida: text('transcripcion_corregida'),
    corregidaPor: uuid('corregida_por').references(() => usuarios.id),
    corregidaEn: timestamp('corregida_en', { withTimezone: true, mode: 'date' }),
    /** Non-negotiable 2.5: no image is stored until its EXIF has been stripped. */
    exifRemovido: boolean('exif_removido').notNull().default(false),
    creadoEn: creadoEn(),
  },
  (t) => [
    index('adjuntos_reporte_idx').on(t.reporteId),
    index('adjuntos_entrega_idx').on(t.entregaId),
    check('adjuntos_tipo_check', enLista('tipo', TIPOS_ADJUNTO)),
    check('adjuntos_dueno_check', sql`num_nonnulls(reporte_id, entrega_id) = 1`),
    check('adjuntos_exif_check', sql`tipo <> 'foto' or exif_removido`),
    check(
      'adjuntos_no_url_proveedor_check',
      sql`storage_key !~* '^https?://'`,
    ),
    // 2.1: a correction is somebody's claim about what was said, so it carries their name.
    check(
      'adjuntos_correccion_check',
      sql`(transcripcion_corregida is null and corregida_por is null and corregida_en is null)
          or (transcripcion_corregida is not null and corregida_por is not null and corregida_en is not null)`,
    ),
  ],
)

/**
 * Every inbound and outbound message. The partial unique index on the provider message id
 * is non-negotiable 2.7: providers retry, so the insert is the idempotency check.
 */
export const mensajes = pgTable(
  'mensajes',
  {
    id: pk(),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    proveedor: text('proveedor').notNull().default('whatsapp_cloud'),
    proveedorMensajeId: text('proveedor_mensaje_id'),
    direccion: text('direccion').notNull(),
    canal: text('canal').notNull(),
    telefono: text('telefono'),
    contactoId: uuid('contacto_id').references(() => contactos.id),
    reporteId: uuid('reporte_id').references(() => reportes.id),
    cuerpo: text('cuerpo'),
    plantilla: text('plantilla'),
    estado: text('estado'),
    costoUsd: numeric('costo_usd', { precision: 10, scale: 5 }),
    payload: jsonb('payload'),
    creadoEn: creadoEn(),
  },
  (t) => [
    // UNIQUE (proveedor, proveedor_mensaje_id) WHERE proveedor_mensaje_id IS NOT NULL
    uniqueIndex('mensajes_proveedor_id_key')
      .on(t.proveedor, t.proveedorMensajeId)
      .where(sql`proveedor_mensaje_id is not null`),
    index('mensajes_telefono_idx').on(t.telefono),
    index('mensajes_creado_idx').on(t.creadoEn),
    check('mensajes_direccion_check', enLista('direccion', DIRECCIONES_MENSAJE)),
    check('mensajes_canal_check', enLista('canal', CANALES)),
    check('mensajes_estado_check', sql`estado is null or ${enLista('estado', ESTADOS_MENSAJE)}`),
  ],
)

/**
 * Section 6.5: per-contact conversation state. Flows are capped at 3–4 exchanges — each
 * round trip costs the person battery and, since Meta began charging for service messages,
 * money.
 */
export const conversaciones = pgTable(
  'conversaciones',
  {
    id: pk(),
    contactoId: uuid('contacto_id')
      .notNull()
      .references(() => contactos.id, { onDelete: 'cascade' }),
    flujo: text('flujo').notNull(),
    paso: text('paso').notNull(),
    payloadParcial: jsonb('payload_parcial').notNull().default(sql`'{}'::jsonb`),
    expiraEn: timestamp('expira_en', { withTimezone: true, mode: 'date' }).notNull(),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    // One live flow per contact; a new flow replaces the old one.
    uniqueIndex('conversaciones_contacto_key').on(t.contactoId),
    index('conversaciones_expira_idx').on(t.expiraEn),
  ],
)
