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
    /** Whatever the provider sent, untouched, so a parser bug is always recoverable. */
    payloadCrudo: jsonb('payload_crudo'),
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
    check(
      'reportes_verificado_completo_check',
      sql`estado <> 'VERIFICADO' or verificado_por is not null`,
    ),
    check('reportes_duplicado_check', sql`estado <> 'DUPLICADO' or reporte_padre_id is not null`),
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
    transcripcion: text('transcripcion'),
    transcripcionConfianza: numeric('transcripcion_confianza', { precision: 4, scale: 3 }),
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
